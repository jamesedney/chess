// The post-game debrief: the few moments that decided a game, and a one-tap
// note on why each went wrong. Over many games the notes show your habits,
// which the planner and the weekly evidence use. Pure functions of the state.
import { moveTime } from './clocks.js';

/** Why a decisive moment went wrong. `skill` or `drill` is what trains it. */
export const REASONS = [
  { id: 'threat', label: 'Missed their threat', skill: 'safety' },
  { id: 'chance', label: 'Missed my chance', skill: 'tactics' },
  { id: 'calc', label: 'Miscalculated', skill: 'calculation' },
  { id: 'rushed', label: 'Played too fast', drill: 'pause' },
  { id: 'time', label: 'Short of time', drill: 'pace' },
  { id: 'plan', label: 'Wrong plan', skill: 'strategy' },
];

export const reasonById = id => REASONS.find(r => r.id === id) || null;

/** The moments that decided a game: its costliest mistakes and blunders, at most `n`, in game order. */
export function pickMoments(review, n = 3) {
  return review.marks
    .filter(m => !m.cleared && m.cls !== 'inaccuracy')
    .sort((a, b) => b.loss - a.loss || a.ply - b.ply)
    .slice(0, n)
    .sort((a, b) => a.ply - b.ply);
}

/** A game still waiting for its debrief. */
export function needsDebrief(review) {
  return !!review.complete && !review.debriefed && pickMoments(review).length > 0;
}

/**
 * The likely reason, offered first: the clock when it explains the moment,
 * otherwise what kind of mistake the engine found.
 */
export function suggestReason(review, mark, mistake = null) {
  const t = moveTime(review, mark.ply);
  if (t?.trouble) return 'time';
  if (t?.rushed) return 'rushed';
  switch (mistake?.kind) {
    case 'hung-piece':
    case 'allowed-mate':
      return 'threat';
    case 'missed-mate':
    case 'missed-tactic':
      return 'chance';
    case 'positional':
      return 'plan';
    default:
      return 'calc';
  }
}

/** Record the reason for one moment; the game is debriefed once every moment has one. */
export function tagMoment(review, ply, reason) {
  const mark = review.marks.find(m => m.ply === ply);
  if (!mark || !reasonById(reason)) return false;
  mark.reason = reason;
  review.debriefed = pickMoments(review).every(m => m.reason);
  return review.debriefed;
}

/**
 * Your habits: reasons over the most recent tagged moments, most common first.
 * Returns { total, list: [{ id, label, count, share, skill?, drill? }] }.
 */
export function habits(state, limit = 30) {
  const tagged = [];
  for (const r of state.reviews)
    for (const m of r.marks) if (m.reason && reasonById(m.reason)) tagged.push({ reason: m.reason, at: r.created || 0 });
  tagged.sort((a, b) => b.at - a.at);
  const recent = tagged.slice(0, limit);
  const counts = {};
  for (const t of recent) counts[t.reason] = (counts[t.reason] || 0) + 1;
  const list = REASONS.filter(r => counts[r.id])
    .map(r => ({ ...r, count: counts[r.id], share: counts[r.id] / recent.length }))
    .sort((a, b) => b.count - a.count);
  return { total: recent.length, list };
}
