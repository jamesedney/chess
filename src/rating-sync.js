// Pull your real ratings from the linked accounts and keep the goal in step.
import { app } from './app-context.js';
import { lichessRatings, chessComRatings, mergeRatings } from './ratings.js';
import { updateGoal } from './progress-model.js';
import { dateKey } from './state.js';
import { toast } from './ui.js';

// Ratings move after every game, so check often but not on every focus.
const GAP_MS = 30 * 60000;
let running = false;
const listeners = new Set();

/** Be told when a sync changed the ratings (Today redraws its goal). */
export function onRatingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Fetch ratings for the linked accounts. Never throws; returns { changed, errors }. */
export async function syncRatings({ force = false, fetchImpl = fetch, now = Date.now() } = {}) {
  const s = app.state;
  const names = s.profiles;
  if (running || (!names.lichess && !names.chesscom)) return { changed: 0, errors: [] };
  if (!force && now - (s.sync.ratingsAt || 0) < GAP_MS) return { changed: 0, errors: [] };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { changed: 0, errors: ['offline'] };
  running = true;
  let changed = 0;
  const errors = [];
  const results = [];
  const prefer = s.settings.perf || 'auto';
  if (names.lichess) results.push(lichessRatings(names.lichess, fetchImpl, now, prefer).catch(e => errors.push(e.message)));
  if (names.chesscom) results.push(chessComRatings(names.chesscom, fetchImpl, prefer, now).catch(e => errors.push(e.message)));
  const fetched = /** @type {{ perf: string, rating: number, history: { date: string, rating: number }[] }[]} */ (
    (await Promise.all(results)).filter(r => r && typeof r === 'object')
  );
  for (const r of fetched) changed += mergeRatings(s.ratings, r, dateKey(new Date(now)));
  if (fetched.length) s.sync.followed = fetched.map(r => r.perf);
  s.sync.ratingsAt = now;
  const milestone = updateGoal(s, new Date(now));
  app.save();
  running = false;
  if (changed || milestone) for (const fn of listeners) fn();
  if (milestone) toast(`Target reached: ${milestone.target}! Your next target is ${s.target.target}.`, { duration: 9000 });
  return { changed, errors };
}

/**
 * Keep ratings current without any effort: shortly after the app opens, and
 * whenever it comes back to the foreground or back online (an installed app is
 * usually resumed, not restarted). Each check respects the gap above.
 */
export function startRatingSync() {
  const go = () => syncRatings().catch(() => {});
  setTimeout(go, 3000);
  window.addEventListener('online', go);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) go();
  });
}
