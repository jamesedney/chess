// Human-like move prediction with Maia, running in a module worker.
import { sample } from './maia-core.js';

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

/** Choose a move the way a player of that level might: sampled, not always the top choice. */
export async function humanMove({ level, game }) {
  const moves = game.history({ verbose: true });
  const fens = moves.length ? [moves[0].before, ...moves.map(m => m.after)] : [game.fen()];
  const legal = game.moves({ verbose: true }).map(m => m.from + m.to + (m.promotion || ''));
  const { probs } = await predict({ level, fens, legal });
  return sample(probs);
}
