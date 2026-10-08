// Rules for endgame drills: when a drill is won, lost or still going.
import { ENDGAME_DRILLS } from '../data/endgames.js';

export { ENDGAME_DRILLS };

export const drillById = id => ENDGAME_DRILLS.find(d => d.id === id) || null;
export const endgameTitle = id => drillById(id)?.title || id;

function count(game, color, type) {
  let n = 0;
  for (const row of game.board()) for (const p of row) if (p && p.color === color && p.type === type) n++;
  return n;
}

/** The pieces that matter for judging progress, from the starting position. */
export function baseline(game) {
  return {
    wq: count(game, 'w', 'q'),
    bq: count(game, 'b', 'q'),
    wp: count(game, 'w', 'p'),
    bp: count(game, 'b', 'p'),
  };
}

function drawReason(game) {
  if (game.isStalemate()) return 'stalemate';
  if (game.isInsufficientMaterial()) return 'not enough material to mate';
  if (game.isThreefoldRepetition()) return 'threefold repetition';
  return 'the fifty-move rule';
}

/**
 * Judge a drill position. `you` is the user's colour; `moves` is how many
 * moves the user has made. Call it after every move by either side.
 * Returns { state: 'playing' | 'won' | 'lost', reason }.
 */
export function judge(drill, game, you, moves, base) {
  const them = you === 'w' ? 'b' : 'w';
  const queens = c => count(game, c, 'q') - base[c + 'q'];
  const pawns = c => count(game, c, 'p');
  if (game.isCheckmate()) {
    return game.turn() === them ? { state: 'won', reason: 'Checkmate.' } : { state: 'lost', reason: 'You were checkmated.' };
  }
  if (game.isDraw()) {
    const why = drawReason(game);
    return drill.goal === 'draw'
      ? { state: 'won', reason: `Drawn by ${why}. Well held.` }
      : { state: 'lost', reason: `Drawn by ${why}. The win slipped away.` };
  }
  if (drill.goal === 'promote') {
    // A new queen counts once the opponent has had a move to answer it.
    if (queens(you) > 0 && game.turn() === you) return { state: 'won', reason: 'Promoted, and the new queen is safe.' };
    if (pawns(you) === 0 && queens(you) <= 0) return { state: 'lost', reason: 'The pawn is gone, and the win with it.' };
  }
  if (drill.goal === 'draw') {
    if (queens(them) > 0) return { state: 'lost', reason: 'The pawn promoted.' };
    if (base[them + 'p'] > 0 && pawns(them) === 0) return { state: 'won', reason: 'You won the pawn. That is a draw.' };
    if (moves >= drill.limit && game.turn() === you) return { state: 'won', reason: `You held for ${drill.limit} moves.` };
    return { state: 'playing', reason: '' };
  }
  if (moves >= drill.limit && game.turn() === you) return { state: 'lost', reason: `Out of moves: the goal was ${drill.limit} or fewer.` };
  return { state: 'playing', reason: '' };
}

/** Update stored progress after a finished attempt. */
export function recordResult(progress, { won, moves, assisted }) {
  const p = { tries: 0, wins: 0, best: 0, ...progress };
  p.tries++;
  if (won && !assisted) {
    p.wins++;
    p.best = p.best ? Math.min(p.best, moves) : moves;
  }
  return p;
}
