// Decide whether a move that differs from the stored solution is also correct.
import { winPercent, winPercentLoss } from './evaluation.js';

/**
 * before: engine result for the solver's position before moving.
 * after:  engine result for the opponent after the solver's alternative move.
 * mateExpected: the puzzle is a forced mate, so the alternative must keep a
 * mate within the solver's remaining moves (including the mating move).
 */
export function judgeAlternative({ before, after, mateExpected = false, remainingMoves = 1, tolerance = 10 }) {
  if (!before || !after) return { accepted: false, reason: 'unknown' };
  if (mateExpected) {
    const mating = after.mate !== null && after.mate !== undefined && after.mate < 0;
    if (mating && -after.mate <= remainingMoves) return { accepted: true, loss: 0 };
    return { accepted: false, reason: mating ? 'slower-mate' : 'no-mate' };
  }
  const loss = winPercentLoss(before.score, after.score);
  if (loss <= tolerance && winPercent(-after.score) >= 60) return { accepted: true, loss };
  return { accepted: false, loss, reason: loss <= 25 ? 'weaker' : 'mistake' };
}

export function rejectionMessage(reason) {
  switch (reason) {
    case 'slower-mate':
      return 'That still mates, but more slowly. Find the fastest mate.';
    case 'no-mate':
      return 'That lets the king escape. Look for a forcing move that keeps the mating net.';
    case 'weaker':
      return 'A reasonable move, but there is something stronger. Look again.';
    case 'mistake':
      return 'That gives away the advantage. Check the opponent’s best reply, then try again.';
    default:
      return 'That is not the solution. Check the opponent’s best reply, then try again.';
  }
}
