// Calculation drills: follow a line in your head, and find every check.
import { Chess } from '../vendor/chess.js';
import { NAMES, moveToUci } from './chess-utils.js';

export const MIN_PLIES = 2;
export const MAX_PLIES = 10;
export const VISUAL_ROUNDS = 10;
export const CHECK_ROUNDS = 5;

const COLOR = { w: 'white', b: 'black' };

/**
 * A visualisation question: the starting position, a line of `plies` moves
 * that is not shown on the board, and one piece to locate at the end.
 * Returns { fen, sans, piece: { color, type, from }, answer } or null.
 */
export function makeVisualisation(seedFens, plies, rng = Math.random, attempts = 60) {
  for (let a = 0; a < attempts; a++) {
    const g = new Chess(seedFens[Math.floor(rng() * seedFens.length)]);
    if (g.isGameOver()) continue;
    const fen = g.fen();
    // Follow each piece by identity so we know where it ends up.
    const at = new Map(); // square -> id
    const pieces = new Map(); // id -> { color, type, from, moved }
    for (const row of g.board())
      for (const p of row)
        if (p) {
          const id = p.square;
          at.set(p.square, id);
          pieces.set(id, { color: p.color, type: p.type, from: p.square, moved: 0, alive: true });
        }
    const sans = [];
    for (let i = 0; i < plies; i++) {
      const moves = g.moves({ verbose: true });
      if (!moves.length) break;
      // Prefer moves that do not end the line early or give up the queen for nothing.
      const m = moves[Math.floor(rng() * moves.length)];
      const id = at.get(m.from);
      if (m.captured) {
        const capturedSq = m.flags.includes('e') ? m.to[0] + m.from[1] : m.to;
        const victim = at.get(capturedSq);
        if (victim) pieces.get(victim).alive = false;
        at.delete(capturedSq);
      }
      at.delete(m.from);
      at.set(m.to, id);
      const piece = pieces.get(id);
      piece.moved++;
      if (m.promotion) piece.type = m.promotion;
      if (m.flags.includes('k') || m.flags.includes('q')) {
        const rank = m.from[1];
        const [rf, rt] = m.flags.includes('k') ? ['h', 'f'] : ['a', 'd'];
        const rook = at.get(rf + rank);
        at.delete(rf + rank);
        at.set(rt + rank, rook);
      }
      g.move(m);
      sans.push(m.san);
    }
    if (sans.length < plies || g.isGameOver()) continue;
    const candidates = [...pieces.entries()].filter(([, p]) => p.alive && p.moved > 0 && p.type !== 'p');
    if (!candidates.length) continue;
    const most = Math.max(...candidates.map(([, p]) => p.moved));
    const pool = candidates.filter(([, p]) => p.moved === most);
    const [id, piece] = pool[Math.floor(rng() * pool.length)];
    const answer = [...at.entries()].find(([, v]) => v === id)[0];
    return { fen, sans, piece: { color: piece.color, type: piece.type, from: piece.from }, answer, finalFen: g.fen() };
  }
  return null;
}

export function visualisationQuestion(v) {
  return `Where is the ${COLOR[v.piece.color]} ${NAMES[v.piece.type]} that started on ${v.piece.from} now?`;
}

/** Next line length: one longer after a correct answer, one shorter after a miss. */
export function nextPlies(plies, correct) {
  return Math.max(MIN_PLIES, Math.min(MAX_PLIES, plies + (correct ? 1 : -1)));
}

/** Every checking move for the side to move, as UCI strings. */
export function checkingMoves(fen) {
  return new Chess(fen)
    .moves({ verbose: true })
    .filter(m => m.san.includes('+') || m.san.includes('#'))
    .map(moveToUci);
}

/** A position with between min and max checks available, from the seeds. */
export function makeCheckDrill(seedFens, rng = Math.random, { min = 2, max = 7, attempts = 80 } = {}) {
  for (let a = 0; a < attempts; a++) {
    const g = new Chess(seedFens[Math.floor(rng() * seedFens.length)]);
    const plies = Math.floor(rng() * 3);
    for (let k = 0; k < plies; k++) {
      const moves = g.moves();
      if (!moves.length) break;
      g.move(moves[Math.floor(rng() * moves.length)]);
    }
    if (g.isGameOver() || g.isCheck()) continue;
    const checks = checkingMoves(g.fen());
    // Promotions with check would count four times; keep positions without them simple.
    if (checks.length < min || checks.length > max || checks.some(u => u.length > 4)) continue;
    return { fen: g.fen(), checks };
  }
  return null;
}

/** Score a finished check hunt: found minus false alarms, never below zero. */
export function scoreChecks(found, wrong) {
  return Math.max(0, found - wrong);
}
