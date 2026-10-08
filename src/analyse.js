// Game analysis shared by the Review page and the background import queue.
// Produces a review record: evaluations per ply, marked moves and saved
// personal mistakes. When the PGN carries Lichess [%eval] comments, those
// evaluations are used and Stockfish only looks at the marked moves.
import { Chess } from '../vendor/chess.js';
import { engine, BUDGET } from './engine.js';
import { app } from './app-context.js';
import { loadGame, describeGame, readHeaders } from './pgn.js';
import { moveToUci, playUci, opposite } from './chess-utils.js';
import { whitePov, winPercentLoss, classifyLoss, isTrainableMistake } from './evaluation.js';
import { createMistake } from './mistakes.js';
import { readClocks, parseTimeControl } from './clocks.js';
import { identifyOpening } from './openings.js';
import { MAX_REVIEWS } from './state.js';

export const MAX_PLIES = 200;
export const MATE_EVAL = 10000;
const clampEval = v => Math.max(-MATE_EVAL, Math.min(MATE_EVAL, Math.round(v)));

/** The key that identifies a game however it was imported. */
export function reviewKey(colour, moves) {
  return colour + ':' + (moves[0]?.before || '') + ':' + moves.map(m => m.san).join(' ');
}

/**
 * Lichess-style evaluations from PGN comments: one per move, from White's
 * point of view, in centipawns (mates become ±MATE_EVAL). Null when the PGN
 * does not carry one evaluation per move.
 */
export function readEvals(pgn, moveCount) {
  const body = String(pgn).replace(/^\s*\[[^\]]*\]\s*$/gm, '');
  const found = [...body.matchAll(/\[%eval\s+(#?-?\d+(?:\.\d+)?)\]/g)].map(m => {
    const v = m[1];
    if (v.startsWith('#')) return Number(v.slice(1)) > 0 ? MATE_EVAL : -MATE_EVAL;
    return clampEval(Number(v) * 100);
  });
  // Lichess omits the evaluation after a mating move; allow one short.
  if (moveCount > 0 && (found.length === moveCount || found.length === moveCount - 1)) return found;
  return null;
}

/** Score for the side to move from a White-point-of-view evaluation. */
function toMover(evalWhite, turn) {
  return turn === 'w' ? evalWhite : -evalWhite;
}

/**
 * Analyse one game. Options:
 *   colour: 'w' | 'b', the side the user played
 *   onProgress(text): status updates
 *   isCancelled(): return true to stop early
 *   background: yield to anything the user is waiting for
 * Resolves with { review, found, duplicate } where duplicate is an existing
 * complete review of the same game, or rejects with a user-facing Error.
 */
export async function analyseGame(
  pgn,
  /** @type {{ colour: string, onProgress?: (text: string) => void, isCancelled?: () => boolean, background?: boolean }} */
  { colour, onProgress = () => {}, isCancelled = () => false, background = false },
) {
  const game = loadGame(pgn);
  const moves = game.history({ verbose: true });
  const limit = Math.min(moves.length, MAX_PLIES);
  const key = reviewKey(colour, moves);
  const duplicate = app.state.reviews.find(r => r.key === key && r.complete);
  if (duplicate) return { review: duplicate, found: 0, duplicate: true };
  const d = describeGame(pgn);
  const headers = readHeaders(pgn);
  const fens = [moves[0].before, ...moves.map(m => m.after)];
  const tc = parseTimeControl(headers.TimeControl);
  const clocks = tc ? readClocks(pgn, moves.length) : null;
  const given = readEvals(pgn, moves.length);
  const review = {
    id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    key,
    created: Date.now(),
    white: d.white,
    black: d.black,
    result: d.result,
    date: d.date,
    event: d.event,
    site: headers.Site || '',
    colour,
    startFen: moves[0].before,
    moves: moves.slice(0, limit).map(m => m.san),
    evals: new Array(limit + 1).fill(null),
    marks: [],
    complete: false,
    opening: identifyOpening(fens),
    ...(clocks ? { clocks: clocks.slice(0, limit), tc } : {}),
    ...(given ? { source: 'lichess-evals' } : {}),
  };
  const truncated = moves.length > MAX_PLIES ? ` Only the first ${MAX_PLIES} half-moves are analysed.` : '';
  let found = 0;
  const search = async fen => {
    for (;;) {
      const r = await engine.analyse(fen, { nodes: BUDGET.review, background });
      if (!r.interrupted) return r;
      if (isCancelled()) return null;
    }
  };

  if (given) {
    // Evaluations are known: find the losses, then ask Stockfish only about those moments.
    // given[i] is the evaluation after move i; no evaluation precedes the first move,
    // so the position before it borrows the first move's, which is never a mistake anyway.
    review.evals[0] = given.length ? given[0] : 0;
    for (let i = 0; i < limit; i++) review.evals[i + 1] = given[i] ?? review.evals[i];
    for (let i = 0; i < limit; i++) {
      const m = moves[i];
      if (m.color !== colour || isCancelled()) continue;
      const before = review.evals[i];
      const after = review.evals[i + 1];
      if (before === null || after === null) continue;
      const loss = winPercentLoss(toMover(before, m.color), toMover(after, opposite(m.color)));
      const cls = classifyLoss(loss);
      if (cls === 'good') continue;
      onProgress(`Checking move ${Math.floor(i / 2) + 1} with Stockfish · ${found} saved.${truncated}`);
      const sf = await search(m.before);
      if (!sf) break;
      if (!sf.best || sf.best === moveToUci(m)) continue;
      const mark = { ply: i, cls, loss: Math.round(loss), best: sf.best, bestSan: playUci(new Chess(m.before), sf.best).san };
      const afterGame = new Chess(m.after);
      if (isTrainableMistake(toMover(before, m.color), toMover(after, opposite(m.color)))) {
        const afterSf = afterGame.isGameOver() ? null : await search(m.after);
        if (afterSf === null && !afterGame.isGameOver()) break;
        const mistake = createMistake({
          fen: m.before,
          played: m.san,
          before: sf,
          after: afterSf,
          loss,
          source: { reviewId: review.id, ply: i },
        })?.mistake;
        if (mistake) {
          mark.mistakeId = mistake.id;
          mark.explanation = mistake.explanation;
          found++;
        }
      }
      review.marks.push(mark);
    }
  } else {
    for (let i = 0; i < limit; i++) {
      if (isCancelled()) break;
      const m = moves[i];
      if (m.color !== colour) continue;
      onProgress(`Analysing move ${Math.floor(i / 2) + 1} of ${Math.ceil(limit / 2)} · ${found} saved.${truncated}`);
      const before = await search(m.before);
      if (!before) break;
      review.evals[i] = clampEval(whitePov(before.score, m.color));
      if (moveToUci(m) === before.best) {
        review.evals[i + 1] = review.evals[i];
        continue;
      }
      const afterGame = new Chess(m.after);
      let after;
      if (afterGame.isCheckmate()) {
        review.evals[i + 1] = m.color === 'w' ? MATE_EVAL : -MATE_EVAL;
        continue;
      } else if (afterGame.isDraw()) {
        after = { score: 0, mate: null, pv: [], best: null };
      } else {
        after = await search(m.after);
        if (!after) break;
      }
      review.evals[i + 1] = clampEval(whitePov(after.score, opposite(m.color)));
      const loss = winPercentLoss(before.score, after.score);
      const cls = classifyLoss(loss);
      if (cls === 'good') continue;
      const mark = { ply: i, cls, loss: Math.round(loss), best: before.best, bestSan: playUci(new Chess(m.before), before.best).san };
      if (isTrainableMistake(before.score, after.score)) {
        const mistake = createMistake({
          fen: m.before,
          played: m.san,
          before,
          after,
          loss,
          source: { reviewId: review.id, ply: i },
        })?.mistake;
        if (mistake) {
          mark.mistakeId = mistake.id;
          mark.explanation = mistake.explanation;
          found++;
        }
      }
      review.marks.push(mark);
    }
  }
  review.complete = !isCancelled();
  app.state.reviews = [review, ...app.state.reviews.filter(r => r.key !== key)].slice(0, MAX_REVIEWS);
  app.save();
  return { review, found, duplicate: false };
}
