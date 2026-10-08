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

const KEY = 'rankup-queue';
const MAX_QUEUE = 12;
const SYNC_GAP_MS = 10 * 60000; // do not poll the sites more often than this

let queue = load();
let current = null; // { item, progress }
let running = false;
let lastSync = 0;
let syncing = false;
const listeners = new Set();

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
      if (!duplicate && app.page !== 'review') {
        toast(
          `${label(item)} reviewed: ${found ? found + ' new position' + (found === 1 ? '' : 's') + ' to practise.' : 'no serious mistakes.'}`,
          {
            action: { label: 'Open', onClick: () => app.navigate('review', { review: review.id, ply: 0 }) },
          },
        );
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
  }, delay);
}

/**
 * Fetch new games for the saved usernames and queue them.
 * Returns { added, errors } and never throws.
 */
export async function syncNow({ force = false, fetchImpl = fetch, now = Date.now() } = {}) {
  const s = app.state;
  const names = [s.profiles.lichess, s.profiles.chesscom].filter(Boolean);
  if (!names.length || syncing) return { added: 0, errors: [] };
  if (!force && now - lastSync < SYNC_GAP_MS) return { added: 0, errors: [] };
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
  for (const [source, run] of jobs) {
    try {
      const fetched = await run();
      items.push(...selectNew(fetched, { usernames: names, sync: s.sync, source, now }));
    } catch (e) {
      errors.push(e.message);
    }
  }
  app.save();
  const added = enqueue(items);
  syncing = false;
  notify();
  return { added, errors };
}

/** Sync when the app opens, comes back online or returns to the foreground. */
export function startAutoSync() {
  if (!app.state.sync?.auto) return;
  const go = () => {
    if (app.state.sync?.auto) syncNow().catch(() => {});
  };
  setTimeout(go, 2500);
  window.addEventListener('online', go);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) go();
  });
  if (queue.length) runQueue(6000);
}
