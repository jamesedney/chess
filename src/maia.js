// Human-like move prediction with Maia, running in a module worker.
import { sample } from './maia-core.js';
import { Chess } from '../vendor/chess.js';

let worker = null;
let seq = 0;
const pending = new Map();

function start() {
  worker = new Worker(new URL('./maia-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = e => {
    const job = pending.get(e.data.id);
    if (!job) return;
    pending.delete(e.data.id);
    if (e.data.error) job.reject(new Error(e.data.error));
    else job.resolve(e.data);
  };
  worker.onerror = () => {
    for (const job of pending.values()) job.reject(new Error('The human-like opponent could not start.'));
    pending.clear();
    worker = null;
  };
}

/**
 * Probabilities a human of `level` would play each legal move.
 * fens: every position of the game so far, oldest first.
 */
export function predict({ level, fens, legal }) {
  if (!worker) start();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, level, fens, legal });
  });
}

/** The positions of a game so far, oldest first, as Maia wants them. */
export function gameFens(game) {
  const moves = game.history({ verbose: true });
  return moves.length ? [moves[0].before, ...moves.map(m => m.after)] : [game.fen()];
}

/**
 * The moves a player of `level` would consider in `game`'s position (or, with
 * `fen`, in that position reached from the game), as [{ uci, p }], likeliest first.
 */
export async function humanMoves({ level, game, fen = null }) {
  const fens = fen ? [...gameFens(game), fen] : gameFens(game);
  const g = fen ? new Chess(fen) : game;
  const legal = g.moves({ verbose: true }).map(m => m.from + m.to + (m.promotion || ''));
  const { probs } = await predict({ level, fens, legal });
  return [...probs].sort((a, b) => b.p - a.p);
}

/** Choose a move the way a player of that level might: sampled, not always the top choice. */
export async function humanMove({ level, game }) {
  const probs = await humanMoves({ level, game });
  return sample(probs);
}
