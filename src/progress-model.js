// The goal as the app sees it: which rating it tracks, where it stands, and
// moving to the next target when one is reached. Pure functions of the state.
import { projection, makeGoal } from './goal.js';
import { seriesFor } from './ratings.js';
import { dateKey } from './state.js';

export const PUZZLE_PERF = 'Rankup puzzle rating';

/** The dated rating series the goal follows. */
export function goalSeries(state) {
  const t = state.target;
  if (!t) return [];
  if (t.perf === PUZZLE_PERF) return state.puzzle.history.map(h => ({ date: h.date, rating: h.rating }));
  return seriesFor(state.ratings, t.perf);
}

/** Projection for the current goal, or null when there is none yet. */
export function goalStatus(state, now = new Date()) {
  if (!state.target) return null;
  return projection(state.target, goalSeries(state), now);
}

/**
 * Keep the goal current: create one from the best rating available, and when a
 * target is reached record the milestone and set the next one. Returns a
 * milestone object when one was just reached, else null.
 */
export function updateGoal(state, now = new Date()) {
  // Follow the ratings the last sync fetched (your chosen time control), or any
  // real rating when none was fetched yet.
  const followed = state.sync?.followed || [];
  const matches = r => !followed.length || followed.includes(r.platform);
  const latestReal = state.ratings.filter(matches).at(-1) || null;
  if (!state.target) {
    const perf = latestReal ? latestReal.platform : PUZZLE_PERF;
    const rating = latestReal ? latestReal.rating : state.puzzle.rating;
    state.target = makeGoal({ perf, rating, minutes: state.minutes || 20, now });
    return null;
  }
  // A real rating arrived after a puzzle-rating goal was set, or you chose a
  // different time control: switch the goal to that rating.
  if (latestReal && (state.target.perf === PUZZLE_PERF || !matches({ platform: state.target.perf }))) {
    state.target = makeGoal({ perf: latestReal.platform, rating: latestReal.rating, minutes: state.target.minutes, now });
    return null;
  }
  const status = goalStatus(state, now);
  if (status?.status === 'reached') {
    const milestone = { date: dateKey(now), perf: state.target.perf, rating: status.current, target: state.target.target };
    state.milestones.push(milestone);
    state.target = makeGoal({ perf: state.target.perf, rating: status.current, minutes: state.target.minutes, now });
    return milestone;
  }
  return null;
}
