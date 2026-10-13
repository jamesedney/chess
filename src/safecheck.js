// Safe or hanging? Positions from your own reviewed games with the move you
// played drawn on the board: five seconds to say whether it was safe or
// hanging. Pure: the board, the clock and the saves live in the Train page.
// `Chess` is passed in (like assess.pickPositions) so this file stays free of
// the vendor import and the tests can drive it with the real class.
import { moveToUci, tryUci } from './chess-utils.js';
import { winPercentLoss } from './evaluation.js';
import { emptyDrillStats, dateKey } from './state.js';
import { kindFromExplanation } from './mistake-kinds.js';

export const SAFE_SECONDS = 5;
export const PASS = { accuracy: 0.7, medianMs: 3500 };
export const MIN_ITEMS = 6;
export const MIN_EACH = 3; // at least this many hanging and this many safe items in the bank
export const MAX_LAST = 50;
export const SAFE_CHANGE = 5; // win-percentage points: a safe move changed the game by less than this

const HANGING_KINDS = new Set(['hung-piece', 'allowed-mate']);
const SAFE_TEXT = 'Safe. Their best reply only kept the balance.';
const SLOW_TEXT = 'Too slow: in a game that is a move.';

/** @typedef {{ id: string, reviewId: string, ply: number, fen: string, played: string, uci: string, answer: 'safe' | 'hanging', refute: string | null, refuteSan: string | null, bestSan: string | null, loss: number, explanation: string | null, opponent: string, needsRefute: boolean, colour: string }} SafeItem */
/** @typedef {{ correct: boolean, kind: 'hit' | 'miss' | 'fa' | 'cr' | 'slow', text: string, truth: 'safe' | 'hanging', ms: number | null }} SafeVerdict */

const hasCheck = san => typeof san === 'string' && /[+#]/.test(san);

/**
 * After a move, can the opponent capture a non-pawn piece or give a check?
 * When they can, "safe" is never obvious from the picture.
 */
export function isTense(fenAfterMove, Chess) {
  let moves;
  try {
    moves = new Chess(fenAfterMove).moves({ verbose: true });
  } catch {
    return false;
  }
  return moves.some(m => (m.captured && m.captured !== 'p') || hasCheck(m.san));
}

/** The mistake's kind, falling back to the explanation for positions saved before kinds were recorded. */
function kindOf(mistake, mark) {
  if (mistake?.kind) return mistake.kind;
  const text = mistake?.explanation ?? mark?.explanation;
  return text ? kindFromExplanation(text) : null;
}

/**
 * A mark that means the played move hung something: an uncleared blunder with
 * a refutation that either left material or the king en prise (the mistake's
 * kind) or is itself a capture or a check. `fen` is the position after the
 * played move, the one the refutation is played in.
 */
export function isHangingMark(mark, mistake, fen, Chess) {
  if (!mark || mark.cleared || mark.cls !== 'blunder' || !mark.refute) return false;
  if (HANGING_KINDS.has(kindOf(mistake, mark))) return true;
  let move;
  try {
    move = tryUci(new Chess(fen), mark.refute);
  } catch {
    return false;
  }
  if (!move) return false;
  return /[ce]/.test(move.flags || '') || hasCheck(move.san);
}

/** Centipawns for the mover from White's point of view. */
const forMover = (evalWhite, colour) => (colour === 'w' ? evalWhite : -evalWhite);

const known = v => typeof v === 'number' && Number.isFinite(v);

/** Replay a review: the position before every ply and each move as played. */
function replay(review, Chess) {
  const fens = [];
  const moves = [];
  try {
    const g = new Chess(review.startFen);
    fens.push(g.fen());
    for (const san of review.moves) {
      const m = g.move(san);
      moves.push(m);
      fens.push(g.fen());
    }
  } catch {
    // A move that does not play: keep the plies before it.
  }
  return { fens, moves };
}

/** Every candidate item from one review: hanging plies and safe plies, by ply. */
function itemsFromReview(review, mistakes, Chess) {
  const out = { hanging: [], safe: [] };
  if (!review?.complete || !Array.isArray(review.moves) || !review.startFen) return out;
  const { fens, moves } = replay(review, Chess);
  const marks = new Map();
  for (const m of review.marks || []) if (!marks.has(m.ply)) marks.set(m.ply, m);
  const opponent = review.colour === 'w' ? review.black : review.white;
  for (let ply = 0; ply < moves.length; ply++) {
    if (fens[ply].split(' ')[1] !== review.colour) continue;
    const move = moves[ply];
    const after = fens[ply + 1];
    const mark = marks.get(ply);
    const mistake = mark?.mistakeId ? mistakes.find(x => x.id === mark.mistakeId) : null;
    const base = {
      id: review.id + ':' + ply,
      reviewId: review.id,
      ply,
      fen: fens[ply],
      played: move.san,
      uci: moveToUci(move),
      opponent,
      colour: review.colour,
    };
    if (mark && mark.cls !== 'inaccuracy') {
      if (mark.cleared || mark.cls !== 'blunder') continue;
      const refuteMove = mark.refute ? tryUci(new Chess(after), mark.refute) : null;
      let hanging;
      if (refuteMove) hanging = isHangingMark(mark, mistake, after, Chess);
      // No usable refutation stored (a mark from before 5.0): the kind alone decides, and the page searches one.
      else hanging = HANGING_KINDS.has(kindOf(mistake, mark));
      if (!hanging) continue;
      out.hanging.push({
        ...base,
        answer: 'hanging',
        refute: refuteMove ? mark.refute : null,
        refuteSan: refuteMove ? refuteMove.san : null,
        bestSan: mark.bestSan ?? (mark.best ? (tryUci(new Chess(fens[ply]), mark.best)?.san ?? null) : null),
        loss: Math.round(mark.loss ?? 0),
        explanation: mistake?.explanation ?? mark.explanation ?? null,
        needsRefute: !refuteMove,
      });
      continue;
    }
    const before = review.evals?.[ply];
    const afterEval = review.evals?.[ply + 1];
    if (!known(before) || !known(afterEval)) continue;
    // Both evaluations are White's; the loss is measured from the mover's side.
    const change = winPercentLoss(forMover(before, review.colour), -forMover(afterEval, review.colour));
    if (change >= SAFE_CHANGE) continue;
    if (!isTense(after, Chess)) continue;
    out.safe.push({
      ...base,
      answer: 'safe',
      refute: null,
      refuteSan: null,
      bestSan: mark?.bestSan ?? move.san,
      loss: Math.round(change),
      explanation: mistake?.explanation ?? mark?.explanation ?? null,
      needsRefute: false,
    });
  }
  return out;
}

/** The whole bank, newest game first: { hanging, safe }. */
export function safeBank(state, /** @type {{ Chess: any, now?: number }} */ { Chess, now = Date.now() }) {
  const reviews = [...(state.reviews || [])].sort((a, b) => (b.created ?? now) - (a.created ?? now));
  const mistakes = state.mistakes || [];
  const bank = { hanging: [], safe: [] };
  for (const r of reviews) {
    const items = itemsFromReview(r, mistakes, Chess);
    bank.hanging.push(...items.hanging);
    bank.safe.push(...items.safe);
  }
  return bank;
}

/** Enough positions for the mode to show: MIN_ITEMS in all, MIN_EACH of each. */
export function hasSafeBank(state, /** @type {{ Chess: any, now?: number }} */ { Chess, now = Date.now() }) {
  const bank = safeBank(state, { Chess, now });
  return bank.hanging.length >= MIN_EACH && bank.safe.length >= MIN_EACH && bank.hanging.length + bank.safe.length >= MIN_ITEMS;
}

/**
 * `count` items from an ordered bank. The rng chooses which surplus items are
 * left out; the chosen ones keep the bank's order (newest game first).
 */
function choose(bank, count, rng) {
  if (count >= bank.length) return bank.slice();
  const idx = bank.map((_, i) => i);
  for (let i = 0; i < count; i++) {
    const j = i + Math.min(idx.length - 1 - i, Math.floor(rng() * (idx.length - i)));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx
    .slice(0, count)
    .sort((a, b) => a - b)
    .map(i => bank[i]);
}

/**
 * A set for one run: `first` ids (the leak's decisive positions) first, then
 * hanging and safe alternating from the newest games, half and half where the
 * bank allows. The order is deterministic; the rng only picks among surplus.
 */
export function safeItems(
  state,
  /** @type {{ limit?: number, first?: string[], rng?: () => number, Chess: any, now?: number }} */
  { limit = 10, first = [], rng = Math.random, Chess, now = Date.now() },
) {
  const bank = safeBank(state, { Chess, now });
  const byId = new Map([...bank.hanging, ...bank.safe].map(it => [it.id, it]));
  const used = new Set();
  const lead = [];
  for (const id of first) {
    const it = byId.get(id);
    if (!it || used.has(id) || lead.length >= limit) continue;
    used.add(id);
    lead.push(it);
  }
  const hangingRest = bank.hanging.filter(it => !used.has(it.id));
  const safeRest = bank.safe.filter(it => !used.has(it.id));
  const wantHanging = Math.ceil(limit / 2);
  const wantSafe = limit - wantHanging;
  const leadHanging = lead.filter(it => it.answer === 'hanging').length;
  let takeHanging = Math.min(hangingRest.length, Math.max(0, wantHanging - leadHanging));
  let takeSafe = Math.min(safeRest.length, Math.max(0, wantSafe - (lead.length - leadHanging)));
  // One side short: the other fills the run.
  let slack = limit - lead.length - takeHanging - takeSafe;
  const moreHanging = Math.min(slack, hangingRest.length - takeHanging);
  takeHanging += moreHanging;
  slack -= moreHanging;
  takeSafe += Math.min(slack, safeRest.length - takeSafe);
  const hanging = choose(hangingRest, takeHanging, rng);
  const safe = choose(safeRest, takeSafe, rng);
  const out = lead;
  for (let i = 0; i < Math.max(hanging.length, safe.length); i++) {
    if (i < hanging.length) out.push(hanging[i]);
    if (i < safe.length) out.push(safe[i]);
  }
  return out;
}

/**
 * The part of the explanation that says what the refutation does, without
 * the move itself: "Qxg2 wins material" → "wins material".
 */
function refuteClause(explanation, refuteSan) {
  if (!explanation) return null;
  const mate = /allowed a forced mate in (\d+)/.exec(explanation);
  if (mate) return `forces mate in ${mate[1]}`;
  if (!refuteSan) return null;
  for (const clause of explanation.split(/[.:;,]\s+|\.\s*$/)) {
    const c = clause.trim();
    if (c.startsWith(refuteSan + ' '))
      return (
        c
          .slice(refuteSan.length + 1)
          .replace(/\.$/, '')
          .trim() || null
      );
  }
  return null;
}

/** What was true about the item, for the feedback line. */
function truthText(item) {
  if (item.answer !== 'hanging') return SAFE_TEXT;
  const head = `${item.played} lost ${item.loss}% winning chances`;
  if (!item.refuteSan) return head + '.';
  return `${head}: ${item.refuteSan} ${refuteClause(item.explanation, item.refuteSan) || 'punishes it'}.`;
}

/**
 * Judge one answer. `answer` is null on a timeout. The verdict carries the
 * item's truth and the time so runSummary can score the run.
 * @returns {SafeVerdict}
 */
export function judgeSafe(item, answer, ms) {
  const truth = item.answer;
  const time = known(ms) ? ms : null;
  if (answer !== 'safe' && answer !== 'hanging')
    return { correct: false, kind: 'slow', text: SLOW_TEXT + ' ' + truthText(item), truth, ms: time };
  const correct = answer === truth;
  const kind = truth === 'hanging' ? (correct ? 'hit' : 'miss') : correct ? 'cr' : 'fa';
  return { correct, kind, text: truthText(item), truth, ms: time };
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Trim float noise so a run at exactly the pass line passes. */
const round4 = x => Math.round(x * 10000) / 10000;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Score a run from judgeSafe verdicts. Saying "hanging" every time scores 0:
 * accuracy is the hit rate less the false-alarm rate.
 */
export function runSummary(answers) {
  const n = answers.length;
  const count = kind => answers.filter(a => a.kind === kind).length;
  const hit = count('hit');
  const miss = count('miss');
  const fa = count('fa');
  const cr = count('cr');
  const slow = count('slow');
  const isHanging = a => a.truth === 'hanging' || a.kind === 'hit' || a.kind === 'miss';
  const isSafe = a => a.truth === 'safe' || a.kind === 'fa' || a.kind === 'cr';
  const hangingItems = answers.filter(isHanging).length;
  const safeItemsN = answers.filter(isSafe).length;
  const hitRate = hangingItems ? hit / hangingItems : 0;
  const faRate = safeItemsN ? fa / safeItemsN : 0;
  const accuracy = Math.max(0, round4(hitRate - faRate));
  const medianMs = median(answers.filter(a => a.kind !== 'slow' && known(a.ms)).map(a => a.ms));
  const passed = accuracy >= PASS.accuracy && medianMs !== null && medianMs <= PASS.medianMs;
  const parts = [`${hit + cr} of ${n} right`, fa ? plural(fa, 'false alarm') : 'no false alarms'];
  if (slow) parts.push(`${slow} too slow`);
  if (medianMs !== null) parts.push(`median ${(medianMs / 1000).toFixed(1)} s`);
  return { n, hit, miss, fa, cr, slow, hanging: hangingItems, hitRate, faRate, accuracy, medianMs, passed, text: parts.join(' · ') };
}

/** Save a run: the last MAX_LAST runs, the run count and the best accuracy (0–100). */
export function recordSafeRun(state, summary, date = dateKey()) {
  const s = state.calc.safe || emptyDrillStats();
  const row = {
    d: date,
    n: summary.n,
    h: summary.hanging ?? summary.hit + summary.miss + summary.slow,
    hit: summary.hit,
    miss: summary.miss,
    fa: summary.fa,
    slow: summary.slow,
    ms: summary.medianMs ?? null,
  };
  state.calc.safe = {
    best: Math.max(s.best || 0, Math.round(summary.accuracy * 100)),
    runs: (s.runs || 0) + 1,
    last: [...(s.last || []), row].slice(-MAX_LAST),
  };
}

/** Accuracy (0–100) and median time over a group of runs. */
function groupStats(runs) {
  const items = runs.reduce((a, r) => a + (r.n || 0), 0);
  if (!items) return { items: 0, accuracy: null, medianMs: null };
  const sum = key => runs.reduce((a, r) => a + (r[key] || 0), 0);
  const hanging = runs.reduce((a, r) => a + (known(r.h) ? r.h : (r.hit || 0) + (r.miss || 0) + (r.slow || 0)), 0);
  const safe = items - hanging;
  const hitRate = hanging ? sum('hit') / hanging : 0;
  const faRate = safe ? sum('fa') / safe : 0;
  // Each run's median stands for its items, so bigger runs weigh more.
  const times = [];
  for (const r of runs) if (known(r.ms)) for (let i = 0; i < (r.n || 0); i++) times.push(r.ms);
  return { items, accuracy: Math.round(Math.max(0, hitRate - faRate) * 100), medianMs: median(times) };
}

/** Whole runs, newest first, that fit within `cap` items (always at least one). */
function takeRuns(runs, cap) {
  const out = [];
  let items = 0;
  for (const r of runs) {
    if (out.length && items + (r.n || 0) > cap) break;
    out.push(r);
    items += r.n || 0;
  }
  return out;
}

/** The last 50 positions against the 50 before them, for the You page. */
export function safeStats(state) {
  const newestFirst = [...(state.calc?.safe?.last || [])].reverse();
  const recent = takeRuns(newestFirst, MAX_LAST);
  const earlier = takeRuns(newestFirst.slice(recent.length), MAX_LAST);
  const now = groupStats(recent);
  const before = groupStats(recent.length ? earlier : []);
  return { items: now.items, accuracy: now.accuracy, medianMs: now.medianMs, before: { items: before.items, accuracy: before.accuracy } };
}
