// Evaluation maths shared by the coach, the game reviewer and the build tools.

/** Lichess's winning-chances curve: centipawns → expected score in [-1, 1]. */
export function winningChances(score) {
  const cp = Math.max(-1000, Math.min(1000, score));
  return 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;
}

/** Win percentage (0–100) for the side the score belongs to. */
export function winPercent(score) {
  return 50 + 50 * winningChances(score);
}

/**
 * How much a move cost the player, in win-percentage points.
 * `before` is the best score for the mover before moving.
 * `after` is the best score for the opponent after the move (opponent's view).
 */
export function winPercentLoss(before, after) {
  return Math.max(0, winPercent(before) - winPercent(-after));
}

/** Plain centipawn loss for the mover, using the same convention. */
export function centipawnLoss(before, after) {
  return before + after;
}

/** Lichess-style move labels from win-percentage loss. */
export function classifyLoss(loss) {
  if (loss >= 30) return 'blunder';
  if (loss >= 20) return 'mistake';
  if (loss >= 10) return 'inaccuracy';
  return 'good';
}

/**
 * Decide whether a played move should become a personal exercise.
 * Uses win-percentage loss so that a drop from +9 to +7 is ignored while a
 * smaller drop that turns a draw into a loss is caught.
 */
export function isTrainableMistake(before, after, { threshold = 20 } = {}) {
  if (before === null || after === null) return false;
  // Already completely lost: nothing useful to learn from the next move.
  if (winPercent(before) < 8) return false;
  return winPercentLoss(before, after) >= threshold;
}

/** Score for White from a score for the side to move. */
export function whitePov(score, turn) {
  return turn === 'w' ? score : -score;
}

/** Human-readable evaluation, e.g. "+1.4", "−0.3" or "M3". */
export function formatScore(score, mate = null) {
  if (mate !== null && mate !== undefined) return (mate > 0 ? '' : '−') + 'M' + Math.abs(mate);
  const pawns = score / 100;
  const text = Math.abs(pawns).toFixed(1);
  return pawns > 0.05 ? '+' + text : pawns < -0.05 ? '−' + text : '0.0';
}
