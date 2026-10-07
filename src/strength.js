// Practice-opponent strength levels and move choice for the weaker ones.
// Stockfish's UCI_Elo only goes down to 1320, so lower levels pick among the
// engine's top moves with deliberate noise. All labels are approximate.

export const LEVELS = [
  { id: 'beginner', label: 'Beginner · about 800', elo: 800, mode: 'noise', multipv: 5, temperature: 260, randomRate: 0.22 },
  { id: 'novice', label: 'Novice · about 1000', elo: 1000, mode: 'noise', multipv: 5, temperature: 170, randomRate: 0.1 },
  { id: 'improver', label: 'Improver · about 1200', elo: 1200, mode: 'noise', multipv: 4, temperature: 90, randomRate: 0.04 },
  { id: 'elo1400', label: 'Club · about 1400', elo: 1400, mode: 'elo' },
  { id: 'elo1600', label: 'Club · about 1600', elo: 1600, mode: 'elo' },
  { id: 'elo1800', label: 'Strong club · about 1800', elo: 1800, mode: 'elo' },
  { id: 'elo2000', label: 'Expert · about 2000', elo: 2000, mode: 'elo' },
  { id: 'elo2400', label: 'Master · about 2400', elo: 2400, mode: 'elo' },
  { id: 'full', label: 'Full strength', elo: null, mode: 'full' },
];
export const DEFAULT_LEVEL = 'novice';

export function levelById(id) {
  return LEVELS.find(l => l.id === id) || LEVELS.find(l => l.id === DEFAULT_LEVEL);
}

/**
 * Pick a move for a noisy level from MultiPV lines (scores for the side to move).
 * With probability randomRate it plays any legal move; otherwise it samples the
 * engine's candidates with a softmax over their scores.
 */
export function pickNoisyMove(lines, legalUci, level, rng = Math.random) {
  if (!lines.length) return legalUci[Math.floor(rng() * legalUci.length)] || null;
  // Never miss a mate in one: even beginners take the king when it is offered.
  const mateNow = lines.find(l => l.mate === 1);
  if (mateNow) return mateNow.pv[0];
  if (legalUci.length && rng() < level.randomRate) return legalUci[Math.floor(rng() * legalUci.length)];
  const clamp = s => Math.max(-1500, Math.min(1500, s));
  const best = clamp(lines[0].score);
  const weights = lines.map(l => Math.exp((clamp(l.score) - best) / level.temperature));
  const total = weights.reduce((a, b) => a + b, 0);
  let x = rng() * total;
  for (let i = 0; i < lines.length; i++) {
    x -= weights[i];
    if (x <= 0) return lines[i].pv[0];
  }
  return lines[0].pv[0];
}
