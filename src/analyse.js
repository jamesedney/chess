// Reading one of your games for mistakes, in the background. Every move of
// yours that threw away a clearly better one becomes a position to train.
// When the PGN carries Lichess [%eval] comments those evaluations are used and
// Stockfish only looks at the moves that lost ground; otherwise Stockfish
// looks at every move of yours.
import { Chess } from '../vendor/chess.js';
import { engine, BUDGET } from './engine.js';
import { loadGame, describeGame } from './pgn.js';
import { moveToUci, opposite } from './chess-utils.js';
import { winPercentLoss, classifyLoss, isTrainableMistake } from './evaluation.js';
import { createMistake } from './mistakes.js';

export const MAX_PLIES = 200;
export const MATE_EVAL = 10000;
const clampEval = v => Math.max(-MATE_EVAL, Math.min(MATE_EVAL, Math.round(v)));

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
const toMover = (evalWhite, turn) => (turn === 'w' ? evalWhite : -evalWhite);

/** Where a position came from, for the line above the board: the opponent and the day. */
export function gameInfo(pgn, colour) {
  const d = describeGame(pgn);
  return { opp: colour === 'w' ? d.black : d.white, date: /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : '' };
}

/**
 * Read one game. Options:
 *   colour: 'w' | 'b', the side you played
 *   onProgress(text): status updates
 *   isCancelled(): return true to stop early
 *   background: yield to anything you are waiting for
 * Resolves with { found, complete }: how many new positions were saved, and
 * whether the whole game was read. Rejects with a user-facing Error when the
 * PGN cannot be read.
 */
export async function analyseGame(
  pgn,
  /** @type {{ colour: string, onProgress?: (text: string) => void, isCancelled?: () => boolean, background?: boolean }} */
  { colour, onProgress = () => {}, isCancelled = () => false, background = false },
) {
  const moves = loadGame(pgn).history({ verbose: true });
  const limit = Math.min(moves.length, MAX_PLIES);
  const game = gameInfo(pgn, colour);
  const given = readEvals(pgn, moves.length);
  let found = 0;
  let complete = true;
  const search = async fen => {
    for (;;) {
      const r = await engine.analyse(fen, { nodes: BUDGET.review, background });
      if (!r.interrupted) return r;
      if (isCancelled()) return null;
    }
  };
  /** Save the position before move i when the move threw away enough; `before` and `after` are engine results. */
  const save = (m, before, after, loss) => {
    const saved = createMistake({ fen: m.before, played: m.san, before, after, loss, game });
    if (saved?.created) found++;
  };

  for (let i = 0; i < limit; i++) {
    const m = moves[i];
    if (m.color !== colour) continue;
    if (isCancelled()) {
      complete = false;
      break;
    }
    onProgress(`Move ${Math.floor(i / 2) + 1} of ${Math.ceil(limit / 2)}`);
    if (given) {
      // Evaluations are known: given[i] is the evaluation after move i. No evaluation
      // precedes the first move, which is never a mistake anyway.
      if (i === 0) continue;
      const evalBefore = given[i - 1];
      const evalAfter = given[i] ?? evalBefore;
      const scoreBefore = toMover(evalBefore, m.color);
      const scoreAfter = toMover(evalAfter, opposite(m.color));
      if (classifyLoss(winPercentLoss(scoreBefore, scoreAfter)) === 'good') continue;
      if (!isTrainableMistake(scoreBefore, scoreAfter)) continue;
      const before = await search(m.before);
      if (!before) {
        complete = false;
        break;
      }
      if (!before.best || before.best === moveToUci(m)) continue;
      const afterGame = new Chess(m.after);
      const after = afterGame.isGameOver() ? null : await search(m.after);
      if (!after && !afterGame.isGameOver()) {
        complete = false;
        break;
      }
      save(m, before, after, winPercentLoss(scoreBefore, scoreAfter));
      continue;
    }
    const before = await search(m.before);
    if (!before) {
      complete = false;
      break;
    }
    if (moveToUci(m) === before.best) continue;
    const afterGame = new Chess(m.after);
    if (afterGame.isCheckmate()) continue;
    let after;
    if (afterGame.isDraw()) after = { score: 0, mate: null, pv: [], best: null };
    else {
      after = await search(m.after);
      if (!after) {
        complete = false;
        break;
      }
    }
    if (isTrainableMistake(before.score, after.score)) save(m, before, after, winPercentLoss(before.score, after.score));
  }
  return { found, complete };
}
