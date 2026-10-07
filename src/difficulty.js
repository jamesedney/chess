// Estimated puzzle ratings for puzzles that have no crowd rating.
// The scale is anchored so that a simple free piece sits near 750 and a
// three-move quiet combination near 1700. It is an estimate, not a Lichess rating.

export function estimateRating({ tags, line, discovery = null, legalMoves = 30, firstSan = '' }) {
  const moves = Math.ceil(line.length / 2);
  let r = tags.includes('mateIn1') ? 700 : 900;
  r += (moves - 1) * 170;
  if (tags.includes('quietMove')) r += 220;
  if (tags.includes('sacrifice')) r += 160;
  if (tags.includes('hangingPiece')) r -= 150;
  if (tags.includes('pin') || tags.includes('skewer')) r += 80;
  if (tags.includes('discoveredAttack') || tags.includes('doubleCheck')) r += 120;
  if (tags.includes('underPromotion')) r += 250;
  if (tags.includes('backRankMate')) r -= 60;
  if (tags.includes('smotheredMate')) r += 100;
  if (firstSan.includes('+')) r -= 60;
  if (firstSan.includes('x')) r -= 40;
  if (discovery) r += Math.min(300, Math.max(0, discovery - 1) * 45);
  r += Math.max(-60, Math.min(90, (legalMoves - 30) * 3));
  return Math.round(Math.max(500, Math.min(2300, r)) / 10) * 10;
}
