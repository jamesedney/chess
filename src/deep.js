// A second, deeper opinion on each saved position, computed while the engine
// is idle. A short search finds candidate mistakes when a game is read; this
// pass looks again with a much larger budget, corrects the suggested move, and
// drops positions where the move you played turns out to be fine.
import { Chess } from '../vendor/chess.js';
import { engine, BUDGET } from './engine.js';
import { app } from './app-context.js';
import { moveToUci } from './chess-utils.js';
import { diagnoseMistake } from './tagger.js';
import { winPercentLoss, classifyLoss } from './evaluation.js';

const GAP_MS = 4000; // pause between searches so the device stays responsive
const PER_VISIT = 12; // at most this many deep searches per app load
let running = false;
let done = 0;
let timer = null;

/** The next saved position that has not had a deep check, newest first. */
export function nextPending(mistakes) {
  return mistakes.find(m => !m.deep && !m.archived && m.played) || null;
}

/**
 * Apply a deep result to a saved position. `before` is the engine's view of
 * the position, `after` its view once your move is played (null when the move
 * ended the game). Pure apart from mutating the position; exported for tests.
 * Returns 'cleared' (your move was fine: the caller removes an untried
 * position, a tried one is set aside), 'corrected' (the better move changed)
 * or 'confirmed'.
 */
export function applyDeepResult({ mistake, record, before, after }) {
  mistake.deep = true;
  let playedUci;
  try {
    playedUci = moveToUci(new Chess(mistake.fen).move(mistake.played));
  } catch {
    return 'confirmed';
  }
  const loss = after ? winPercentLoss(before.score, after.score) : null;
  if (before.best === playedUci || (loss !== null && classifyLoss(loss) === 'good')) {
    mistake.archived = true;
    return 'cleared';
  }
  if (loss !== null) mistake.loss = Math.round(loss);
  // A position you have already worked on keeps the answer you were taught.
  if (before.best && before.best !== mistake.line[0] && !record?.tries && !mistake.mate) {
    mistake.line = [before.best];
    mistake.explanation = diagnoseMistake({ fen: mistake.fen, played: mistake.played, before, after }).text;
    return 'corrected';
  }
  return 'confirmed';
}

async function checkOne() {
  const mistake = nextPending(app.state.mistakes);
  if (!mistake) return false;
  const before = await engine.analyse(mistake.fen, { nodes: BUDGET.deep, background: true });
  if (before.interrupted) return true;
  const g = new Chess(mistake.fen);
  let after = null;
  try {
    g.move(mistake.played);
    if (!g.isGameOver()) {
      after = await engine.analyse(g.fen(), { nodes: BUDGET.deep / 2, background: true });
      if (after.interrupted) return true;
    }
  } catch {}
  // The position may have been removed while the engine worked.
  if (!app.state.mistakes.includes(mistake)) return true;
  const record = app.state.records[mistake.id];
  const verdict = applyDeepResult({ mistake, record, before, after });
  if (verdict === 'cleared' && !record?.tries) {
    app.state.mistakes = app.state.mistakes.filter(m => m !== mistake);
    delete app.state.records[mistake.id];
  }
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
