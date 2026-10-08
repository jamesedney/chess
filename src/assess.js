// Assess the position: positions from your own reviewed games, you judge who
// stands better, the engine's evaluation is the answer. Over time the results
// show whether you overrate or underrate your own positions.
import { MATE_EVAL } from './analyse.js';

/** Evaluation buckets from White's point of view, in centipawns. */
export const BUCKETS = [
  { id: 'w2', label: 'White is clearly better', min: 150 },
  { id: 'w1', label: 'White is slightly better', min: 50 },
  { id: 'eq', label: 'About equal', min: -50 },
  { id: 'b1', label: 'Black is slightly better', min: -150 },
  { id: 'b2', label: 'Black is clearly better', min: -Infinity },
];

export const ROUNDS = 10;
const MIN_PLY = 8;

/** Index into BUCKETS for an evaluation. */
export function bucketOf(evalWhite) {
  return BUCKETS.findIndex(b => evalWhite >= b.min);
}

/** 2 for the right bucket, 1 for the one next to it, else 0. */
export function scoreGuess(guess, evalWhite) {
  const d = Math.abs(guess - bucketOf(evalWhite));
  return d === 0 ? 2 : d === 1 ? 1 : 0;
}

/** "+1.3" style text. */
export function evalText(evalWhite) {
  if (Math.abs(evalWhite) >= MATE_EVAL) return evalWhite > 0 ? 'White is mating' : 'Black is mating';
  const p = evalWhite / 100;
  return (p > 0 ? '+' : '') + p.toFixed(1);
}

/**
 * Positions to assess, drawn from complete reviews with evaluations: after
 * the opening, at the user's turn, no forced mates. Spread across games so one
 * long game does not dominate. Returns [{ fen, evalWhite, colour, label, reviewId, ply }].
 */
export function pickPositions(
  reviews,
  /** @type {{ count?: number, rng?: () => number, Chess: any }} */ { count = ROUNDS, rng = Math.random, Chess },
) {
  const pools = [];
  for (const r of reviews) {
    if (!r.complete || !r.evals?.length) continue;
    const game = new Chess(r.startFen);
    const fens = [game.fen()];
    for (const san of r.moves) {
      game.move(san);
      fens.push(game.fen());
    }
    const userToMove = ply => fens[ply].split(' ')[1] === r.colour;
    const options = [];
    for (let ply = MIN_PLY; ply < r.moves.length; ply++) {
      const ev = r.evals[ply];
      if (ev === null || ev === undefined || Math.abs(ev) >= MATE_EVAL || !userToMove(ply)) continue;
      options.push({ fen: fens[ply], evalWhite: ev, colour: r.colour, label: `${r.white} – ${r.black}`, reviewId: r.id, ply });
    }
    if (options.length) pools.push(options);
  }
  const out = [];
  const used = new Set();
  let guard = 0;
  while (out.length < count && pools.length && guard++ < count * 20) {
    const pool = pools[Math.floor(rng() * pools.length)];
    const pick = pool[Math.floor(rng() * pool.length)];
    const key = pick.reviewId + ':' + pick.ply;
    if (used.has(key)) {
      if (used.size >= pools.reduce((n, p) => n + p.length, 0)) break;
      continue;
    }
    used.add(key);
    out.push(pick);
  }
  return out;
}

/**
 * Signed error from the player's point of view: positive means the player
 * rated their own side higher than the engine did.
 */
export function playerBias(guess, evalWhite, colour) {
  const error = bucketOf(evalWhite) - guess; // positive: the guess was more favourable to White
  return colour === 'w' ? error : -error;
}

/** What the last runs say about your judgement. */
export function calibration(runs) {
  const recent = runs.slice(-5).filter(r => Number.isFinite(r.bias));
  if (recent.length < 2)
    return { verdict: 'unknown', text: 'Do a few assessment runs and this shows whether you overrate or underrate your positions.' };
  const bias = recent.reduce((a, r) => a + r.bias, 0) / recent.length;
  const accuracy = recent.reduce((a, r) => a + r.score / (r.total || 1), 0) / recent.length;
  if (bias >= 0.4)
    return {
      verdict: 'optimistic',
      bias,
      accuracy,
      text: 'You tend to overrate your own position. Before deciding you are better, look for your opponent’s best idea.',
    };
  if (bias <= -0.4)
    return {
      verdict: 'pessimistic',
      bias,
      accuracy,
      text: 'You tend to underrate your own position. Trust your advantages: look for your most active plan.',
    };
  return {
    verdict: 'balanced',
    bias,
    accuracy,
    text: `Your assessments are balanced. You land on or next to the engine’s verdict ${Math.round(accuracy * 50)}% of the time.`,
  };
}
