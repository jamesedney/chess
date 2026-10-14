// One leak: when you are losing, read the last ten losses in the main control,
// name the one thing that started most of them, and give one habit for it.
// Classifies each loss by the fix (rushed, safety, clock, tilt, convert,
// opening, calc) from the review's marks, evals and clocks and the ledger
// row. Pure functions of the state; the planner, the coach and the pages
// read the diagnosis.
import { Chess } from '../vendor/chess.js';
import { WINNING, LOST } from './replay.js';
import { moveTime, thresholds, formatClock, rushedText } from './clocks.js';
import { KINDS, phaseOf } from './mistake-kinds.js';
import { mainControl, rowsBetween, lossRun, keyFromSite, score } from './ledger.js';
import { annotate } from './tilt.js';
import { outcome } from './openings.js';
import { OBJECTIVES } from '../data/curriculum.js';

const DAY = 86400000;
/** Losses read for a diagnosis, and the window they must fall in. */
export const LOSSES = 10;
export const LOSS_DAYS = 30;
/** The leak needs this many classified losses and this share of them. */
export const MIN_COUNTED = 4;
export const MIN_SHARE = 0.4;
/** Streak mode: games in the last ten, the score that keeps it on, the loss run and its age. */
export const MIN_GAMES = 8;
export const MAX_SCORE = 0.4;
export const RUN = 3;
export const RUN_DAYS = 7;
/** The main control's base when no row says otherwise (5+0 blitz). */
const DEFAULT_BASE = 300;
/** A loss on the clock from this ply on, with under this many seconds, is a clock loss. */
const LATE_PLY = 60;
const LATE_LEFT = 20;
/** Floating-point safe comparisons: 4/10 must count as 0.40. */
const EPS = 1e-9;

/** Ties between leaks resolve in this order (first wins). */
export const LEAK_ORDER = ['rushed', 'safety', 'clock', 'tilt', 'convert', 'opening', 'calc'];

/**
 * The "rushed" label names the main control's rushed threshold exactly as
 * the clock counts it: "under 4.5 seconds" at 5+0, "under 3 seconds" at 3+0.
 */
export const rushedLabel = (base = DEFAULT_BASE) => `a move played in ${rushedText({ base: base ?? DEFAULT_BASE, inc: 0 })}`;

/** Each leak: how the line names it, the habit for it, and the planner's block type. */
export const LEAKS = {
  rushed: { label: rushedLabel(DEFAULT_BASE), habit: 'At every capture and check, count three before you touch the piece.', block: 'safe' },
  safety: { label: 'a piece hung in one move', habit: KINDS['hung-piece'].habit, block: 'safe' },
  clock: { label: 'the clock', habit: 'Under 30 seconds, play the simple move at once.', block: 'pace' },
  tilt: {
    label: 'a game queued straight after a loss',
    habit: 'One loss: two minutes away from the board. Two losses in a row: stop for tonight.',
    block: null,
  },
  convert: {
    label: 'a won position thrown away',
    habit: 'When ahead, trade pieces, not pawns, and ask what they threaten every move.',
    block: 'replay',
  },
  opening: { label: 'the opening', habit: OBJECTIVES.openings, block: 'repertoire' },
  calc: { label: 'a miscalculation', habit: OBJECTIVES.calculation, block: 'pause' },
};

const SAFETY_KINDS = new Set(['hung-piece', 'allowed-mate']);

/** An eval from your side, or null when unknown (never 0). */
const pov = (e, colour) => (e == null ? null : colour === 'w' ? e : -e);

/** The position before `ply` (moves 0..ply-1 played from the start), or null when the moves do not play. */
export function fenAt(review, ply) {
  try {
    const g = new Chess(review.startFen);
    for (let i = 0; i < ply; i++) g.move(review.moves[i]);
    return g.fen();
  } catch {
    return null;
  }
}

/**
 * The move that lost the game: the first mark (not cleared, not an
 * inaccuracy) where the eval from your side goes from above LOST to LOST or
 * below. A null eval on either side is unknown and that mark is skipped.
 * When no mark crosses, the costliest mark (earliest on ties). Null without
 * marks.
 */
export function firstDecisiveError(review) {
  if (!review || !Array.isArray(review.marks)) return null;
  const marks = review.marks.filter(m => m && !m.cleared && m.cls !== 'inaccuracy').sort((a, b) => a.ply - b.ply);
  if (!marks.length) return null;
  const evals = Array.isArray(review.evals) ? review.evals : [];
  let mark = null;
  for (const m of marks) {
    const before = pov(evals[m.ply], review.colour);
    const after = pov(evals[m.ply + 1], review.colour);
    if (before === null || after === null) continue;
    if (before > LOST && after <= LOST) {
      mark = m;
      break;
    }
  }
  if (!mark) mark = marks.reduce((best, m) => ((m.loss || 0) > (best.loss || 0) ? m : best), marks[0]);
  const ply = mark.ply;
  const earlier = evals.slice(1, ply + 1).map(e => pov(e, review.colour));
  const wasWinning = earlier.some(e => e !== null && e >= WINNING);
  return { mark, ply, loss: mark.loss ?? 0, time: review.clocks && review.tc ? moveTime(review, ply) : null, wasWinning };
}

/** The ledger row with its place in a sitting, from the state's ledger when the row given lacks it. */
const annotated = (row, state) => {
  if (!row) return null;
  if (row.idx !== undefined) return row;
  return annotate(state?.ledger || []).find(r => r.k === row.k) || row;
};

/**
 * What fixes this loss: one chess category (by precedence: rushed, safety,
 * clock, convert, opening, calc) and whether it was a tilt game (queued
 * straight after a loss, or the fifth or later of its sitting). A loss
 * without a review can only be clock (lost on time) or tilt.
 */
export function classifyLoss(review, row, state) {
  const r = annotated(row, state);
  const tilt = !!(r && (r.quick || r.idx >= 5));
  const flagged = !!(r && r.term === 'time' && r.r === 0);
  const d = review ? firstDecisiveError(review) : null;
  if (!d) return { chess: flagged ? 'clock' : null, tilt };
  const kind = state?.mistakes?.find(m => m.id === d.mark.mistakeId)?.kind;
  const time = d.time;
  let chess;
  if (time?.rushed) chess = 'rushed';
  else if (SAFETY_KINDS.has(kind) || (d.mark.cls === 'blunder' && !kind)) chess = 'safety';
  else if (flagged || time?.trouble || (d.ply >= LATE_PLY && time && time.left < LATE_LEFT)) chess = 'clock';
  else if (d.wasWinning) chess = 'convert';
  else if (d.ply < 20) chess = 'opening';
  else chess = 'calc';
  return { chess, tilt };
}

/** The review of a ledger row, by the game key or the Site header; null when the game was not reviewed. */
export function reviewFor(state, row) {
  if (!row || !Array.isArray(state?.reviews)) return null;
  // A review stopped early has no evals past the stop: the loss counts as unreviewed.
  return state.reviews.find(r => r.complete && (r.gameKey === row.k || (r.site && keyFromSite(r.site) === row.k))) || null;
}

/** The ledger in time order (recordLedger keeps it so; a hand-built one may not be). */
const byTime = ledger => [...(ledger || [])].sort((a, b) => a.t - b.t);

/** The newest `n` rows of one control within the last LOSS_DAYS, newest first: old games never start a streak. */
const lastGames = (ledger, control, n, now) =>
  ledger
    .filter(r => r.tc === control && r.t >= now - LOSS_DAYS * DAY)
    .sort((a, b) => b.t - a.t)
    .slice(0, n);

/** The most common base among the control's rows, or the default. */
const baseOf = rows => {
  const counts = {};
  for (const r of rows) if (r.base) counts[r.base] = (counts[r.base] || 0) + 1;
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best ? Number(best[0]) : DEFAULT_BASE;
};

/** Streak mode: the last 10 games of the main control score 40% or less with 8 played, or 3 losses in a row within 7 days. */
export function streakMode(state, now = Date.now()) {
  const ledger = byTime(state?.ledger);
  const control = mainControl(ledger, { now });
  if (!control) return false;
  const last = lastGames(ledger, control, LOSSES, now);
  if (last.length >= MIN_GAMES && score(last) <= MAX_SCORE + EPS) return true;
  const run = lossRun(ledger, { control });
  return run.length >= RUN && run.endedAt !== null && run.endedAt >= now - RUN_DAYS * DAY;
}

/**
 * The diagnosis: the last `losses` losses in the main control within 30
 * days, each classified; the leak is the top category when at least 4 losses
 * are classified and it started 40% of them. `examples` are the leak's
 * decisive positions, newest first. Without a main control the leak is null.
 */
export function diagnoseStreak(state, { now = Date.now(), losses = LOSSES } = {}) {
  const ledger = byTime(state?.ledger);
  const control = mainControl(ledger, { now });
  const counts = {};
  for (const id of LEAK_ORDER) counts[id] = 0;
  const empty = {
    control,
    games10: 0,
    lost10: 0,
    score10: null,
    run: 0,
    base: DEFAULT_BASE,
    losses: [],
    counted: 0,
    counts,
    leak: null,
    label: null,
    share: null,
    habit: null,
    line: null,
    examples: [],
  };
  if (!control) return empty;
  const last = lastGames(ledger, control, LOSSES, now);
  const run = lossRun(ledger, { control }).length;
  const rows = annotate(ledger);
  const recent = rowsBetween(rows, now - LOSS_DAYS * DAY, Infinity, { control })
    .filter(r => r.r === 0)
    .sort((a, b) => b.t - a.t)
    .slice(0, losses);
  const classified = recent.map(row => {
    const review = reviewFor(state, row);
    const { chess, tilt } = classifyLoss(review, row, state);
    const d = review ? firstDecisiveError(review) : null;
    return { row, reviewId: review ? review.id : null, chess, tilt, ply: d ? d.ply : null };
  });
  let counted = 0;
  for (const l of classified) {
    if (l.chess) counts[l.chess]++;
    if (l.tilt) counts.tilt++;
    if (l.chess || l.tilt) counted++;
  }
  const top = LEAK_ORDER.reduce((best, id) => (counts[id] > counts[best] ? id : best), LEAK_ORDER[0]);
  const share = counted ? counts[top] / counted : null;
  const leak = counted >= MIN_COUNTED && share + EPS >= MIN_SHARE ? top : null;
  const base = baseOf(ledger.filter(r => r.tc === control));
  const label = leak ? (leak === 'rushed' ? rushedLabel(base) : LEAKS[leak].label) : null;
  const examples = leak
    ? classified
        .filter(l => l.reviewId && l.ply !== null && (l.chess === leak || (leak === 'tilt' && l.tilt)))
        .map(l => ({ reviewId: l.reviewId, ply: l.ply }))
    : [];
  const d = {
    ...empty,
    games10: last.length,
    lost10: last.filter(r => r.r === 0).length,
    score10: score(last),
    run,
    base,
    losses: classified,
    counted,
    counts,
    leak,
    label,
    share: leak ? share : null,
    habit: leak ? LEAKS[leak].habit : null,
    examples,
  };
  d.line = leakLine(d);
  return d;
}

/** "Losing 7 of your last 10. The leak: 5 of 8 losses began with a piece hung in one move. Habit: …", or null without a leak. */
export function leakLine(d) {
  if (!d || !d.leak) return null;
  const label = d.label || LEAKS[d.leak].label;
  return (
    `Losing ${d.lost10} of your last ${d.games10}. ` +
    `The leak: ${d.counts[d.leak]} of ${d.counted} losses began with ${label}. ` +
    `Habit: ${LEAKS[d.leak].habit}`
  );
}

/** The move number of a ply, counted from the review's start position (which may not be move 1). */
const moveNumber = (review, ply) => {
  const [, turn, , , , full] = String(review.startFen || '').split(' ');
  return (Number(full) || 1) + Math.floor((ply + (turn === 'b' ? 1 : 0)) / 2);
};

/** "+3.2" from centipawns. */
const evalText = cp => (cp > 0 ? '+' : cp < 0 ? '−' : '') + Math.abs(cp / 100).toFixed(1);

/**
 * "Lost at move 31 (endgame), from +2.1, with 0:14 left." for a lost game:
 * the decisive move, its phase, the best eval you had before it (when you
 * were winning) and the clock before it. Null for a game that was not lost or
 * has no decisive error.
 */
export function lossAnatomy(review, state = null) {
  if (!review || outcome(review.result, review.colour) !== 0) return null;
  const d = firstDecisiveError(review);
  if (!d) return null;
  const move = moveNumber(review, d.ply);
  const fen = fenAt(review, d.ply);
  const phase = fen ? phaseOf(fen) : 'middlegame';
  let text = `Lost at move ${move} (${phase})`;
  if (d.wasWinning) {
    const best = Math.max(...review.evals.slice(1, d.ply + 1).map(e => pov(e, review.colour) ?? -Infinity));
    text += `, from ${evalText(best)}`;
  }
  if (d.time) text += `, with ${formatClock(d.time.left)} left`;
  return text + '.';
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * "Last 14 days: 9 wins, 16 losses, 1 draw (37%)." over every row in the
 * window (one control when given); null under 10 games. Draws are left out
 * when there are none.
 */
export function windowHeadline(ledger, { now = Date.now(), days = 14, control = null } = {}) {
  const rows = rowsBetween(ledger || [], now - days * DAY, Infinity, { control });
  if (rows.length < 10) return null;
  const wins = rows.filter(r => r.r === 1).length;
  const losses = rows.filter(r => r.r === 0).length;
  const draws = rows.length - wins - losses;
  const parts = [plural(wins, 'win', 'wins'), plural(losses, 'loss', 'losses')];
  if (draws) parts.push(plural(draws, 'draw', 'draws'));
  return `Last ${days} days: ${parts.join(', ')} (${Math.round(score(rows) * 100)}%).`;
}
