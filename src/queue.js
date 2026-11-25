// The import queue: your games waiting to be read, one at a time while the
// engine is otherwise idle. Lives outside the saved state (and backups) under
// its own storage key, because PGNs are bulky and the queue is transient.
import { app } from './app-context.js';
import { engine } from './engine.js';
import { analyseGame } from './analyse.js';
import { fetchLichessNew, fetchChessComNew, selectNew, MAX_FAILED, MAX_REVIEWED } from './sync.js';
import { toast } from './ui.js';
import { scheduleDeepAnalysis } from './deep.js';
import { syncRatings } from './rating-sync.js';

const KEY = 'rankup-queue';
const MAX_QUEUE = 400; // room for two months of games on the first sync
const SYNC_GAP_MS = 10 * 60000; // do not poll the sites more often than this
const FOREGROUND_GAP_MS = 60000; // opening the app checks for a game you just finished, at most once a minute

let queue = load();
let current = null; // the game being read
let running = false;
let lastSync = 0;
let syncing = false;
const listeners = new Set();
// Games read since the queue last emptied: reported once, together.
let batch = { games: 0, found: 0 };

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

/** { pending, reading, syncing }: games waiting, whether one is being read, whether the sites are being asked. */
export function snapshot() {
  return { pending: queue.length + (current ? 1 : 0), reading: !!current, syncing };
}

/** Add games to the queue. Returns how many were added (duplicates are skipped). */
export function enqueue(items) {
  let added = 0;
  for (const it of items) {
    if (queue.some(q => q.key === it.key) || current?.key === it.key) continue;
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

/** Read the next queued game when the engine has nothing else to do. */
export function runQueue(delay = 1500) {
  if (running || !queue.length || !engine.available) return;
  running = true;
  setTimeout(async () => {
    if (!queue.length) {
      running = false;
      return;
    }
    const item = queue[0];
    current = item;
    notify();
    const sync = app.state.sync;
    try {
      const { found } = await analyseGame(item.pgn, { colour: item.colour, background: true });
      sync.reviewed = [...sync.reviewed.filter(k => k !== item.key), item.key].slice(-MAX_REVIEWED);
      batch.games++;
      batch.found += found;
      scheduleDeepAnalysis();
    } catch {
      // A game that cannot be read is dropped, and remembered so a later sync does not queue it again.
      sync.failed = [...sync.failed.filter(k => k !== item.key), item.key].slice(-MAX_FAILED);
    }
    queue = queue.filter(i => i !== item);
    persist();
    app.save();
    current = null;
    running = false;
    notify();
    if (queue.length) runQueue(4000);
    else reportBatch();
  }, delay);
}

/** One message for everything read in the background. */
function reportBatch() {
  const { games, found } = batch;
  batch = { games: 0, found: 0 };
  if (!games || !found) return;
  toast(`${found} new position${found === 1 ? '' : 's'} from your last ${games === 1 ? 'game' : games + ' games'}.`, {
    action: app.page === 'train' ? null : { label: 'Train', onClick: () => app.navigate('train') },
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
  let added = 0;
  try {
    for (const [source, run] of jobs) {
      try {
        const fetched = await run();
        const reviewed = new Set([...s.sync.reviewed, ...queue.map(q => q.key)]);
        items.push(...selectNew(fetched, { usernames: names, sync: s.sync, source, now, reviewed }));
        // The backfill is Lichess's: it is done once Lichess has answered, whatever the other site did.
        if (source === 'lichess' && !s.sync.backfillAt) s.sync.backfillAt = now;
      } catch (e) {
        errors.push(e.message);
      }
    }
    if (!s.profiles.lichess && !s.sync.backfillAt && !errors.length) s.sync.backfillAt = now;
    app.save();
    added = enqueue(items);
    // A new game means a new rating: read it now rather than at the next check.
    if (items.length) syncRatings({ force: true, fetchImpl, now }).catch(() => {});
  } finally {
    syncing = false;
    notify();
  }
  return { added, errors };
}

/** Sync when the app opens, comes back online or returns to the foreground. */
export function startAutoSync() {
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
