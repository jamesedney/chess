// Your repertoire, built from your own games: the moves you play in the
// opening, where the engine says a different move was better, and the lines
// you score badly in. Drilled with the same spaced-repetition schedule as
// puzzles. Pure functions of the state.
import { Chess } from '../vendor/chess.js';
import { outcome, positionKey } from './openings.js';
import { isDue } from './srs.js';

/** Half-moves from the start that count as the opening. */
export const DEPTH = 16;
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/**
 * Every position in your games' openings where it was your move: what you
 * played there, how those games went, and the engine's better move when you
 * lost ground. Returns a Map of key -> node.
 */
export function buildRepertoire(reviews) {
  const nodes = new Map();
  for (const review of reviews) {
    if (!review.complete || review.startFen !== START) continue;
    const score = outcome(review.result, review.colour);
    const g = new Chess();
    const line = [];
    for (let i = 0; i < Math.min(DEPTH, review.moves.length); i++) {
      const san = review.moves[i];
      if (g.turn() === review.colour) {
        const fen = g.fen();
        const key = `${review.colour}:${positionKey(fen)}`;
        const node = nodes.get(key) || { key, fen, colour: review.colour, ply: i, line: [...line], games: 0, points: 0, moves: {} };
        node.games++;
        node.points += score ?? 0.5;
        const entry = (node.moves[san] ||= { san, count: 0, points: 0, better: null, loss: 0 });
        entry.count++;
        entry.points += score ?? 0.5;
        const mark = review.marks.find(m => m.ply === i && !m.cleared);
        if (mark && mark.loss >= entry.loss) {
          entry.better = mark.bestSan;
          entry.loss = mark.loss;
        }
        nodes.set(key, node);
      }
      try {
        g.move(san);
      } catch {
        break;
      }
      line.push(san);
    }
  }
  return nodes;
}

/** "1. e4 e5 2. Nf3" for a list of moves from the start. */
export function lineText(sans) {
  return sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${s}` : s)).join(' ');
}

/**
 * Positions worth drilling: ones you reach in at least two games, or where you
 * lost ground. The answer is your usual move, or the engine's better move when
 * your usual move was marked. Earliest positions first.
 */
export function repertoireCards(reviews) {
  const cards = [];
  for (const node of buildRepertoire(reviews).values()) {
    const moves = Object.values(node.moves).sort((a, b) => b.count - a.count);
    const main = moves[0];
    if (node.games < 2 && !main.better) continue;
    const fix = main.better && main.better !== main.san;
    cards.push({
      id: `rep:${node.key}`,
      fen: node.fen,
      colour: node.colour,
      ply: node.ply,
      line: node.line,
      answer: fix ? main.better : main.san,
      played: main.san,
      fix,
      games: node.games,
      score: node.points / node.games,
      why: fix
        ? `Better than ${main.san}, which cost you ${main.loss}% winning chances.`
        : `Your move here in ${main.count} of ${node.games} games.`,
    });
  }
  return cards.sort((a, b) => a.ply - b.ply || b.games - a.games);
}

/** Cards due for practice now: never seen, or due by their schedule. Fixes first. */
export function dueCards(state, now = Date.now()) {
  return repertoireCards(state.reviews)
    .filter(c => !state.rep?.[c.id] || isDue(state.rep[c.id], now))
    .sort((a, b) => Number(b.fix) - Number(a.fix) || a.ply - b.ply);
}

/** Lines you score badly in (at least three games, under 40%), worst first. */
export function weakLines(reviews) {
  return [...buildRepertoire(reviews).values()]
    .filter(n => n.games >= 3 && n.points / n.games < 0.4 && n.line.length)
    .sort((a, b) => a.points / a.games - b.points / b.games || b.games - a.games)
    .map(n => ({ colour: n.colour, line: lineText(n.line), games: n.games, score: n.points / n.games }));
}
