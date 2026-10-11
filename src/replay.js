// Play it again: positions from your own games where a win slipped away or a
// draw was there to be saved, replayed against an opponent of your opponent's
// strength. Pure functions of the state; the Play page runs the challenge.
import { Chess } from '../vendor/chess.js';
import { outcome } from './openings.js';
import { LEVELS } from './strength.js';
import { MATE_EVAL } from './analyse.js';

/** Clearly winning, and clearly lost, from your side, in centipawns. */
export const WINNING = 250;
export const LOST = -300;
/** Worse but holdable: the moment before it became lost. */
export const HOLDABLE = -250;
/** Your moves before the position is judged by the engine instead of played to the end. */
export const MAX_MOVES = 30;

const pov = (evalWhite, colour) => (evalWhite == null ? null : colour === 'w' ? evalWhite : -evalWhite);

/**
 * Positions to play again, newest game first. Each is the position before your
 * mistake: "convert" where you were winning and did not win, "hold" where you
 * were worse but not lost and then lost.
 */
export function replayCandidates(state, limit = 20) {
  const out = [];
  for (const review of state.reviews) {
    if (!review.complete || !review.evals || !review.moves) continue;
    const score = outcome(review.result, review.colour);
    if (score === null || score === 1) continue;
    const marks = review.marks.filter(m => !m.cleared && m.cls !== 'inaccuracy').sort((a, b) => a.ply - b.ply);
    let pick = null;
    for (const m of marks) {
      const before = pov(review.evals[m.ply], review.colour);
      const after = pov(review.evals[m.ply + 1], review.colour);
      if (before === null || Math.abs(before) >= MATE_EVAL) continue;
      if (before >= WINNING) {
        pick = { mark: m, goal: 'convert', eval: before };
        break;
      }
      if (score === 0 && before >= HOLDABLE && after !== null && after <= LOST) {
        pick = { mark: m, goal: 'hold', eval: before };
        break;
      }
    }
    if (!pick) continue;
    let fen;
    try {
      const g = new Chess(review.startFen);
      for (const san of review.moves.slice(0, pick.mark.ply)) g.move(san);
      fen = g.fen();
    } catch {
      continue;
    }
    const opponent = review.colour === 'w' ? review.black : review.white;
    const id = `${review.id}:${pick.mark.ply}`;
    out.push({
      id,
      reviewId: review.id,
      ply: pick.mark.ply,
      fen,
      colour: review.colour,
      goal: pick.goal,
      eval: pick.eval,
      played: review.moves[pick.mark.ply],
      best: pick.mark.bestSan,
      opponent,
      oppElo: review.oppElo || null,
      created: review.created || 0,
      record: state.replays?.[id] || null,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** The next one to play: not yet done, then the oldest attempt. */
export function nextReplay(state) {
  const list = replayCandidates(state);
  return list.find(c => !c.record?.success) || null;
}

/**
 * The practice opponent for a replay: Maia when one plays near that rating,
 * otherwise the Stockfish level closest to it.
 */
export function opponentLevel(oppElo, fallback = 1200) {
  const elo = oppElo || fallback;
  const maia = LEVELS.filter(l => l.mode === 'maia').sort((a, b) => Math.abs(a.elo - elo) - Math.abs(b.elo - elo))[0];
  if (maia && Math.abs(maia.elo - elo) <= 200) return maia.id;
  return LEVELS.filter(l => l.elo).sort((a, b) => Math.abs(a.elo - elo) - Math.abs(b.elo - elo))[0].id;
}

/**
 * Whether the challenge was met. result: 'win' | 'draw' | 'loss' when the game
 * ended, or null when it was judged at the move limit with `evalUser` (centipawns,
 * your side).
 */
export function judgeReplay(goal, { result = null, evalUser = null } = {}) {
  if (result === 'win') return true;
  if (result === 'draw') return goal === 'hold';
  if (result === 'loss') return false;
  if (evalUser === null) return false;
  return goal === 'convert' ? evalUser >= 400 : evalUser >= -100;
}

/** Save an attempt. Returns the record. */
export function recordReplay(state, id, success, date) {
  state.replays ||= {};
  const r = state.replays[id] || { tries: 0, success: false };
  state.replays[id] = { tries: r.tries + 1, success: r.success || success, last: date };
  return state.replays[id];
}

/** What the challenge asks, in words. */
export function goalText(c) {
  const pawns = (c.eval / 100).toFixed(1);
  return c.goal === 'convert'
    ? `You were winning here (+${pawns}) and played ${c.played}. Convert it: win, or still be clearly winning after ${MAX_MOVES} moves.`
    : `You were worse but alive here (${pawns}) and played ${c.played}. Hold it: draw or better, or still be standing after ${MAX_MOVES} moves.`;
}
