// The import queue: games waiting for analysis, analysed one at a time while
// the engine is otherwise idle. Lives outside the saved state (and backups)
// under its own storage key, because PGNs are bulky and the queue is transient.
import { app } from './app-context.js';
import { engine } from './engine.js';
import { analyseGame } from './analyse.js';
import { fetchLichessNew, fetchChessComNew, selectNew } from './sync.js';
import { describeGame } from './pgn.js';
import { toast } from './ui.js';
import { scheduleDeepAnalysis } from './deep.js';
import { mergeNewGames } from './session.js';
import { syncRatings } from './rating-sync.js';
import { needsDebrief } from './debrief.js';
import { ledgerFrom, recordLedger, MAX_LEDGER } from './ledger.js';

const KEY = 'rankup-queue';
const MAX_QUEUE = 12;
const SYNC_GAP_MS = 10 * 60000; // do not poll the sites more often than this
const FOREGROUND_GAP_MS = 60000; // opening the app checks for a game you just finished, at most once a minute

let queue = load();
let current = null; // { item, progress }
let running = false;
let lastSync = 0;
let lastSuccess = 0; // the last sync that reached every linked site
let syncing = false;
const listeners = new Set();
const ledgerListeners = new Set();
// Games reviewed since the queue last emptied: reported once, together.
let batch = { games: 0, found: 0, last: null };

function load() {
  try {
    const q = JSON.parse(app.storage?.getItem(KEY) || '[]');
    return Array.isArray(q) ? q.filter(i => i && typeof i.pgn === 'string' && (i.colour === 'w' || i.colour === 'b')) : [];
  } catch {
    return [];
  }
}

function persist() {
  try {
    app.storage?.setItem(KEY, JSON.stringify(queue));
  } catch {}
}

function notify() {
  for (const fn of listeners) fn(snapshot());
}

/** Watch the queue; returns an unsubscribe function. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Be told when a sync added games to the ledger (Today redraws the stop line). */
export function onLedgerChange(fn) {
  ledgerListeners.add(fn);
  return () => ledgerListeners.delete(fn);
}

/** When the ledger was last brought up to date with every linked site, in ms; 0 if never. */
export function lastSyncAt() {
  return lastSuccess;
}

export function snapshot() {
  return {
    pending: queue.length,
    items: queue.map(i => ({ key: i.key, source: i.source, label: label(i) })),
    current: current ? { label: label(current.item), progress: current.progress } : null,
    syncing,
  };
}

function label(item) {
  const d = describeGame(item.pgn);
  return `${d.white} – ${d.black}`;
}

/** Add games to the queue. Returns how many were added (duplicates are skipped). */
export function enqueue(items) {
  let added = 0;
  for (const it of items) {
    if (queue.some(q => q.key === it.key) || current?.item.key === it.key) continue;
    if (queue.length >= MAX_QUEUE) break;
    queue.push(it);
    added++;
  }
  if (added) {
    persist();
    notify();
    runQueue();
  }
  return added;
}

export function remove(key) {
  queue = queue.filter(i => i.key !== key);
  persist();
  notify();
}

/** Analyse the next queued game when the engine has nothing else to do. */
export function runQueue(delay = 1500) {
  if (running || !queue.length || !engine.available) return;
  running = true;
  setTimeout(async () => {
    if (!queue.length) {
      running = false;
      return;
    }
    const item = queue[0];
    current = { item, progress: 'Waiting for the engine…' };
    notify();
    try {
      const { review, found, duplicate } = await analyseGame(item.pgn, {
        colour: item.colour,
        background: true,
        onProgress: text => {
          if (current?.item === item) {
            current.progress = text;
            notify();
          }
        },
      });
      queue = queue.filter(i => i !== item);
      persist();
      if (!duplicate) {
        batch.games++;
        batch.found += found || 0;
        batch.last = { id: review.id, label: label(item), debrief: needsDebrief(review) };
      }
      scheduleDeepAnalysis();
    } catch (e) {
      // A game that cannot be analysed is dropped rather than retried for ever.
      queue = queue.filter(i => i !== item);
      persist();
      toast(`Could not review ${label(item)}: ${e.message || 'analysis failed.'}`);
    }
    current = null;
    running = false;
    notify();
    if (queue.length) runQueue(4000);
    else reportBatch();
  }, delay);
}

/** One message for everything reviewed in the background, and today's plan picks the games up. */
function reportBatch() {
  const { games, found, last } = batch;
  batch = { games: 0, found: 0, last: null };
  if (!games) return;
  mergeNewGames();
  if (app.page === 'review') return;
  const positions = found ? `${found} new position${found === 1 ? '' : 's'} to practise` : 'no serious mistakes';
  if (games === 1)
    toast(`${last.label} reviewed: ${positions}.`, {
      action: last.debrief
        ? { label: 'Debrief', onClick: () => app.navigate('review', { review: last.id, debrief: 1 }) }
        : { label: 'Open', onClick: () => app.navigate('review', { review: last.id, ply: 0 }) },
    });
  else
    toast(`${games} games reviewed: ${positions}.${found ? ' They are in today’s session.' : ''}`, {
      action: { label: 'Today', onClick: () => app.navigate('today') },
    });
}

/**
 * Fetch new games for the saved usernames and queue them.
 * Returns { added, errors } and never throws.
 */
export async function syncNow({ force = false, gap = SYNC_GAP_MS, fetchImpl = fetch, now = Date.now() } = {}) {
  const s = app.state;
  const names = [s.profiles.lichess, s.profiles.chesscom].filter(Boolean);
  if (!names.length || syncing) return { added: 0, errors: [] };
  if (!force && now - lastSync < gap) return { added: 0, errors: [] };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { added: 0, errors: ['offline'] };
  syncing = true;
  lastSync = now;
  notify();
  const errors = [];
  const items = [];
  /** @type {[string, () => Promise<any[]>][]} */
  const jobs = [];
  if (s.profiles.lichess) jobs.push(['lichess', () => fetchLichessNew(s.profiles.lichess, s.sync, { fetchImpl, now })]);
  if (s.profiles.chesscom) jobs.push(['chesscom', () => fetchChessComNew(s.profiles.chesscom, s.sync, { fetchImpl, now })]);
  let ledgered = 0;
  let added = 0;
  try {
    for (const [source, run] of jobs) {
      try {
        const fetched = await run();
        // Every finished game goes in the ledger, reviewed or not. A full ledger
        // skips games older than its oldest row before parsing them.
        s.ledger ||= [];
        const after = s.ledger.length >= MAX_LEDGER ? s.ledger[0].t : 0;
        const known = new Set(s.ledger.map(r => r.k));
        ledgered += recordLedger(s.ledger, ledgerFrom(fetched, { usernames: names, known, after }));
        items.push(...selectNew(fetched, { usernames: names, sync: s.sync, source, now }));
        // The backfill is Lichess's: it is done once Lichess has answered, whatever the other site did.
        if (source === 'lichess' && !s.sync.ledgerAt) s.sync.ledgerAt = now;
      } catch (e) {
        errors.push(e.message);
      }
    }
    if (!s.profiles.lichess && !s.sync.ledgerAt && !errors.length) s.sync.ledgerAt = now;
    if (!errors.length) lastSuccess = now;
    app.save();
    if (ledgered)
      for (const fn of ledgerListeners) {
        try {
          fn();
        } catch (e) {
          console.error(e);
        }
      }
    added = enqueue(items);
    // A new game means a new rating: read it now rather than at the next check,
    // whether or not the game is queued for review.
    if (items.length || ledgered) syncRatings({ force: true, fetchImpl, now }).catch(() => {});
  } finally {
    syncing = false;
    notify();
  }
  return { added, errors };
}

/** Sync when the app opens, comes back online or returns to the foreground. */
export function startAutoSync() {
  if (!app.state.sync?.auto) return;
  const go = () => {
    if (app.state.sync?.auto) syncNow({ gap: FOREGROUND_GAP_MS }).catch(() => {});
  };
  setTimeout(go, 2500);
  window.addEventListener('online', go);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) go();
  });
  if (queue.length) runQueue(6000);
}
