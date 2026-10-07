// Rule-based checks for "tap the square" lesson steps, so every claim a
// lesson makes about defenders, attackers, escapes and pins is verified.
import { Chess } from '../vendor/chess.js';
import { hangingPieces, opposite } from './chess-utils.js';

const SQUARES = [];
for (const f of 'abcdefgh') for (let r = 1; r <= 8; r++) SQUARES.push(f + r);

function pieces(game, color) {
  return SQUARES.filter(sq => game.get(sq)?.color === color);
}

function kingSquare(game, color) {
  return pieces(game, color).find(sq => game.get(sq).type === 'k');
}

/** Squares that satisfy a tap step's `verify` rule. */
export function expectedTargets(step) {
  const game = new Chess(step.fen);
  const mover = game.turn();
  const other = opposite(mover);
  const [rule, arg] = step.verify.split(':');
  switch (rule) {
    case 'undefended': {
      // Enemy pieces, not pawns or the king, that no friendly piece guards.
      return pieces(game, other).filter(sq => {
        const p = game.get(sq);
        return p.type !== 'p' && p.type !== 'k' && game.attackers(sq, other).length === 0;
      });
    }
    case 'free-capture':
      return hangingPieces(Chess, step.fen).map(h => h.square);
    case 'attacked-twice':
      // Occupied squares of the side to move that the other side attacks at least twice.
      return pieces(game, mover).filter(sq => game.attackers(sq, other).length >= 2);
    case 'escape-square': {
      const k = kingSquare(game, mover);
      return game.moves({ square: k, verbose: true }).map(m => m.to);
    }
    case 'pinned':
      // Pieces of the side to move whose removal would expose the king.
      return pieces(game, mover).filter(sq => {
        const p = game.get(sq);
        if (p.type === 'k') return false;
        const probe = new Chess(step.fen);
        probe.remove(sq);
        return probe.isAttacked(kingSquare(probe, mover), other);
      });
    case 'defender-of': {
      // Pieces defending `arg`, excluding types listed after a comma, e.g. defender-of:d5,q
      const [square, exclude = ''] = arg.split(',');
      const owner = game.get(square)?.color;
      return game.attackers(square, owner).filter(sq => !exclude.includes(game.get(sq).type));
    }
    default:
      throw new Error('Unknown verify rule ' + rule);
  }
}
