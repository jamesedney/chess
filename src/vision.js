// Board-vision drills: positions with exactly one free piece to capture.
import { Chess } from '../vendor/chess.js';
import { hangingPieces } from './chess-utils.js';

export function makeVisionDrill(seedFens, rng = Math.random, attempts = 80) {
  for (let i = 0; i < attempts; i++) {
    const game = new Chess(seedFens[Math.floor(rng() * seedFens.length)]);
    const plies = Math.floor(rng() * 4);
    for (let k = 0; k < plies; k++) {
      const moves = game.moves();
      if (!moves.length) break;
      game.move(moves[Math.floor(rng() * moves.length)]);
    }
    if (game.isGameOver() || game.isCheck()) continue;
    const free = hangingPieces(Chess, game.fen(), { minValue: 3 }).filter(h => h.gain >= 3);
    if (free.length !== 1) continue;
    const mateInOne = game.moves({ verbose: true }).some(m => {
      const c = new Chess(game.fen());
      c.move(m);
      return c.isCheckmate();
    });
    if (mateInOne) continue;
    return { fen: game.fen(), target: free[0].square, piece: free[0].piece, answer: free[0].capture };
  }
  return null;
}

export function isVisionAnswer(drill, move) {
  return move.to === drill.target && !!move.captured;
}
