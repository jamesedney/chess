// Pawn-structure and piece-placement facts: isolated, doubled, passed and
// backward pawns, outposts, open files and bad bishops. Pure functions over a
// chess.js game, used by the strategy lessons' tap checks, the assessment
// drill and the coach.
import { opposite } from './chess-utils.js';

const FILES = 'abcdefgh';
export const SQUARES = [];
for (const f of FILES) for (let r = 1; r <= 8; r++) SQUARES.push(f + r);

const file = sq => FILES.indexOf(sq[0]);
const rank = sq => Number(sq[1]);
const sqAt = (f, r) => (f >= 0 && f < 8 && r >= 1 && r <= 8 ? FILES[f] + r : null);

/** Squares holding pawns of `color`. */
export function pawns(game, color) {
  return SQUARES.filter(sq => {
    const p = game.get(sq);
    return p && p.color === color && p.type === 'p';
  });
}

function pawnFiles(game, color) {
  return new Set(pawns(game, color).map(file));
}

/** Pawns with no friendly pawn on either adjacent file. */
export function isolatedPawns(game, color) {
  const files = pawnFiles(game, color);
  return pawns(game, color).filter(sq => !files.has(file(sq) - 1) && !files.has(file(sq) + 1));
}

/** Pawns sharing a file with another friendly pawn. */
export function doubledPawns(game, color) {
  const all = pawns(game, color);
  return all.filter(sq => all.some(o => o !== sq && file(o) === file(sq)));
}

/** Pawns with no enemy pawn ahead of them on their file or the adjacent files. */
export function passedPawns(game, color) {
  const dir = color === 'w' ? 1 : -1;
  const enemy = pawns(game, opposite(color));
  return pawns(game, color).filter(sq => !enemy.some(e => Math.abs(file(e) - file(sq)) <= 1 && (rank(e) - rank(sq)) * dir > 0));
}

/**
 * Backward pawns: no friendly pawn beside or behind them on an adjacent file
 * to support an advance, and the square in front is attacked by an enemy pawn.
 */
export function backwardPawns(game, color) {
  const dir = color === 'w' ? 1 : -1;
  const own = pawns(game, color);
  const enemy = pawns(game, opposite(color));
  return own.filter(sq => {
    const supportable = own.some(o => Math.abs(file(o) - file(sq)) === 1 && (rank(o) - rank(sq)) * dir <= 0);
    if (supportable) return false;
    const stop = sqAt(file(sq), rank(sq) + dir);
    if (!stop) return false;
    return enemy.some(e => Math.abs(file(e) - file(stop)) === 1 && rank(e) === rank(stop) + dir);
  });
}

/**
 * Outposts for `color`: squares on the opponent's side of the board (ranks
 * 4–6 for White, 5–3 for Black) that a friendly pawn defends and no enemy pawn
 * can ever attack. Occupied squares count too, so a knight already sitting on
 * one is found.
 */
export function outposts(game, color) {
  const dir = color === 'w' ? 1 : -1;
  const own = pawns(game, color);
  const enemy = pawns(game, opposite(color));
  const ranks = color === 'w' ? [4, 5, 6] : [5, 4, 3];
  const out = [];
  for (const f of [0, 1, 2, 3, 4, 5, 6, 7])
    for (const r of ranks) {
      const sq = sqAt(f, r);
      const p = game.get(sq);
      if (p && p.color !== color) continue;
      const defended = own.some(o => Math.abs(file(o) - f) === 1 && rank(o) === r - dir);
      if (!defended) continue;
      const attackable = enemy.some(e => Math.abs(file(e) - f) === 1 && (rank(e) - r) * dir > 0);
      if (!attackable) out.push(sq);
    }
  return out;
}

/** Files with no pawns at all, as letters. */
export function openFiles(game) {
  const all = new Set([...pawns(game, 'w'), ...pawns(game, 'b')].map(file));
  return [...FILES].filter((_, i) => !all.has(i));
}

/** Files with no pawns of `color` but at least one enemy pawn: half-open for `color`. */
export function halfOpenFiles(game, color) {
  const own = pawnFiles(game, color);
  const theirs = pawnFiles(game, opposite(color));
  return [...FILES].filter((_, i) => !own.has(i) && theirs.has(i));
}

/** The light or dark colour of a square. */
export const squareColor = sq => ((file(sq) + rank(sq)) % 2 === 0 ? 'light' : 'dark');

/**
 * Bishops of `color` with the share of friendly pawns on their square colour.
 * The one with the higher share is the "bad" bishop, hemmed in by its own pawns.
 */
export function bishops(game, color) {
  const own = pawns(game, color);
  return SQUARES.filter(sq => {
    const p = game.get(sq);
    return p && p.color === color && p.type === 'b';
  }).map(sq => {
    const colour = squareColor(sq);
    const blocked = own.filter(p => squareColor(p) === colour).length;
    return { square: sq, colour, blocked, share: own.length ? blocked / own.length : 0 };
  });
}

export function badBishops(game, color) {
  const list = bishops(game, color);
  const worst = Math.max(...list.map(b => b.share), -1);
  return list.filter(b => b.share === worst && b.share > 0.5).map(b => b.square);
}

/** Squares next to the king that no friendly pawn or piece defends. */
export function looseKingSquares(game, color) {
  const k = SQUARES.find(sq => {
    const p = game.get(sq);
    return p && p.color === color && p.type === 'k';
  });
  if (!k) return [];
  const out = [];
  for (let df = -1; df <= 1; df++)
    for (let dr = -1; dr <= 1; dr++) {
      if (!df && !dr) continue;
      const sq = sqAt(file(k) + df, rank(k) + dr);
      if (!sq) continue;
      const p = game.get(sq);
      if (p && p.color === color) continue;
      if (game.attackers(sq, color).filter(a => a !== k).length === 0) out.push(sq);
    }
  return out;
}

/** A plain-language summary of the structural facts of a position, for the assessment drill. */
export function describeStructure(game) {
  const facts = [];
  for (const color of ['w', 'b']) {
    const side = color === 'w' ? 'White' : 'Black';
    const passed = passedPawns(game, color);
    const isolated = isolatedPawns(game, color);
    const doubled = doubledPawns(game, color);
    if (passed.length) facts.push(`${side} has a passed pawn on ${passed.join(' and ')}.`);
    if (isolated.length) facts.push(`${side}'s ${isolated.join(' and ')} pawn${isolated.length > 1 ? 's are' : ' is'} isolated.`);
    if (doubled.length) facts.push(`${side} has doubled pawns on the ${FILES[file(doubled[0])]}-file.`);
    const bad = badBishops(game, color);
    if (bad.length) facts.push(`${side}'s bishop on ${bad[0]} is hemmed in by its own pawns.`);
    const op = outposts(game, color).filter(sq => game.get(sq)?.type === 'n');
    if (op.length) facts.push(`${side}'s knight on ${op[0]} sits on an outpost no pawn can challenge.`);
  }
  const open = openFiles(game);
  if (open.length) facts.push(`The ${open.join('- and ')}-file${open.length > 1 ? 's are' : ' is'} open.`);
  return facts;
}
