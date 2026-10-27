// Openings you struggle with, from your reviewed games: the lines you score
// badly in, and the moves your opponents played there, so a practice game can
// start where the trouble starts and the opponent answers the way yours did.
// Pure functions of the reviews.
import { Chess } from '../vendor/chess.js';
import { outcome, positionKey } from './openings.js';
import { DEPTH, lineText } from './repertoire.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
/** A line needs this many games, and to score under WEAK, to count. */
export const MIN_GAMES = 3;
const WEAK = 0.4;

/** Each game's opening as positions: [{ fen, key, mine, san }], stopping at an illegal move. */
function walk(review) {
  const g = new Chess();
  const out = [];
  for (let i = 0; i < Math.min(DEPTH, review.moves.length); i++) {
    const fen = g.fen();
    const san = review.moves[i];
    out.push({ fen, key: positionKey(fen), mine: g.turn() === review.colour, san, ply: i });
    try {
      g.move(san);
    } catch {
      break;
    }
  }
  return out;
}

const counted = reviews => reviews.filter(r => r.complete && r.startFen === START && outcome(r.result, r.colour) !== null);

/**
 * Lines worth practising: positions on your move, after at least one move,
 * reached in MIN_GAMES or more games where you scored under 40%. A line inside
 * another listed line with the same games is left out. Worst first.
 * Each is { colour, fen, line, text, games, won, drawn, lost }.
 */
export function strugglingLines(reviews, limit = 5) {
  const nodes = new Map();
  for (const r of counted(reviews)) {
    const score = outcome(r.result, r.colour);
    const line = [];
    for (const p of walk(r)) {
      if (p.mine && p.ply > 0) {
        const id = `${r.colour}:${p.key}`;
        const n = nodes.get(id) || { colour: r.colour, fen: p.fen, line: [...line], games: 0, won: 0, drawn: 0, lost: 0 };
        n.games++;
        if (score === 1) n.won++;
        else if (score === 0) n.lost++;
        else n.drawn++;
        nodes.set(id, n);
      }
      line.push(p.san);
    }
  }
  const points = n => (n.won + n.drawn / 2) / n.games;
  const weak = [...nodes.values()].filter(n => n.games >= MIN_GAMES && points(n) < WEAK).sort((a, b) => a.line.length - b.line.length);
  const kept = [];
  for (const n of weak) {
    const inside = kept.some(k => k.colour === n.colour && k.games === n.games && k.line.every((s, i) => n.line[i] === s));
    if (!inside) kept.push(n);
  }
  return kept
    .sort((a, b) => points(a) - points(b) || b.games - a.games || a.line.length - b.line.length)
    .slice(0, limit)
    .map(n => ({ ...n, text: lineText(n.line) }));
}

/**
 * The move your opponents played most often in this position in your games
 * as `colour`, or null when they never reached it.
 */
export function opponentMove(reviews, fen, colour) {
  const key = positionKey(fen);
  const counts = {};
  for (const r of counted(reviews)) {
    if (r.colour !== colour) continue;
    for (const p of walk(r)) if (!p.mine && p.key === key) counts[p.san] = (counts[p.san] || 0) + 1;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return best ? best[0] : null;
}

/** "3 games: 0 won, 1 drawn, 2 lost". */
export function recordText(l) {
  return `${l.games} games: ${l.won} won, ${l.drawn} drawn, ${l.lost} lost`;
}
