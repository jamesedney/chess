// Deeper second opinions on reviewed mistakes, computed while the engine is idle.
// A short search flags candidate mistakes during review; this pass re-checks each
// marked move with a much larger budget, corrects the suggested move, and clears
// marks that turn out to be fine.
import { Chess } from '../vendor/chess.js';
import { engine, BUDGET } from './engine.js';
import { app } from './app-context.js';
import { playUci, moveToUci } from './chess-utils.js';
import { diagnoseMistake } from './tagger.js';
import { winPercentLoss, classifyLoss } from './evaluation.js';

const GAP_MS = 4000; // pause between searches so the device stays responsive
const PER_VISIT = 12; // at most this many deep searches per app load
let running = false;
let done = 0;
let timer = null;

/** Positions before each move of a review. */
function fenBefore(review, ply) {
  const g = new Chess(review.startFen);
  for (let i = 0; i < ply; i++) g.move(review.moves[i]);
  return g;
}

/** The next mark that has not had a deep check, newest review first. */
export function nextPending(reviews) {
  for (const r of reviews) {
    if (!r.complete) continue;
    const mark = r.marks.find(m => !m.deep && m.cls !== 'inaccuracy');
    if (mark) return { review: r, mark };
  }
  return null;
}

/**
 * Apply a deep result to a mark (and its saved position when untouched).
 * Pure apart from mutating the objects passed in; exported for tests.
 * Returns 'confirmed', 'corrected' or 'cleared'.
 */
export function applyDeepResult({ review, mark, mistake, record, fen, before, after }) {
  const played = review.moves[mark.ply];
  const g = new Chess(fen);
  const playedUci = moveToUci(g.move(played));
  mark.deep = true;
  // The deeper search prefers the move that was played, or the loss is small: not a mistake.
  const loss = after ? winPercentLoss(before.score, after.score) : null;
  if (before.best === playedUci || (loss !== null && classifyLoss(loss) === 'good')) {
    mark.cleared = true;
    if (mistake && !record?.tries) mistake.archived = true;
    return 'cleared';
  }
  if (loss !== null) {
    mark.loss = Math.round(loss);
    mark.cls = classifyLoss(loss);
  }
  if (before.best && before.best !== mark.best) {
    mark.best = before.best;
    mark.bestSan = playUci(new Chess(fen), before.best).san;
    if (mistake && !record?.tries) {
      mistake.line = [before.best];
      const d = diagnoseMistake({ fen, played, before, after });
      mistake.explanation = d.text;
      mistake.kind = d.kind;
      mark.explanation = d.text;
    }
    return 'corrected';
  }
  return 'confirmed';
}

async function checkOne() {
  const pending = nextPending(app.state.reviews);
  if (!pending) return false;
  const { review, mark } = pending;
  const g = fenBefore(review, mark.ply);
  const fen = g.fen();
  const before = await engine.analyse(fen, { nodes: BUDGET.deep, background: true });
  if (before.interrupted) return true;
  g.move(review.moves[mark.ply]);
  let after = null;
  if (!g.isGameOver()) {
    after = await engine.analyse(g.fen(), { nodes: BUDGET.deep / 2, background: true });
    if (after.interrupted) return true;
  }
  // The review may have been deleted while the engine worked.
  if (!app.state.reviews.includes(review) || !review.marks.includes(mark)) return true;
  const mistake = mark.mistakeId ? app.state.mistakes.find(m => m.id === mark.mistakeId) : null;
  applyDeepResult({ review, mark, mistake, record: mistake && app.state.records[mistake.id], fen, before, after });
  app.save();
  done++;
  return true;
}

/** Start (or continue) the idle-time pass. Safe to call often. */
export function scheduleDeepAnalysis(delay = GAP_MS) {
  if (running || timer || done >= PER_VISIT || !engine.available) return;
  timer = setTimeout(async () => {
    timer = null;
    if (document.hidden || !engine.idle) return scheduleDeepAnalysis(GAP_MS * 2);
    running = true;
    let more = false;
    try {
      more = await checkOne();
    } catch {
      more = false;
    }
    running = false;
    if (more) scheduleDeepAnalysis();
  }, delay);
}
