// Small chess helpers on top of chess.js. Pure and shared with the build tools.

export const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

export function moveToUci(move) {
  return move.from + move.to + (move.promotion || '');
}

export function uciToMoveObject(uci) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci[4] ? { promotion: uci[4] } : {}) };
}

/** Play a UCI move on a chess.js game. Throws on illegal moves, like chess.js. */
export function playUci(game, uci) {
  return game.move(uciToMoveObject(uci));
}

/** Play a UCI move, returning null instead of throwing when it is illegal. */
export function tryUci(game, uci) {
  try {
    return playUci(game, uci);
  } catch {
    return null;
  }
}

/** Material balance from White's point of view. */
export function materialBalance(game) {
  let total = 0;
  for (const row of game.board()) for (const p of row) if (p) total += (p.color === 'w' ? 1 : -1) * VALUES[p.type];
  return total;
}

/** Total non-king material on the board (both sides). */
export function totalMaterial(game) {
  let total = 0;
  for (const row of game.board()) for (const p of row) if (p) total += VALUES[p.type];
  return total;
}

/** Convert a list of UCI moves from a FEN into SAN. Stops at the first illegal move. */
export function uciLineToSan(GameClass, fen, line) {
  const g = new GameClass(fen);
  const out = [];
  for (const u of line) {
    const m = tryUci(g, u);
    if (!m) break;
    out.push(m.san);
  }
  return out;
}

export function opposite(color) {
  return color === 'w' ? 'b' : 'w';
}

/**
 * Squares holding pieces of `color` that the side to move can capture for free:
 * a legal capture exists and no legal recapture on that square follows.
 * Kings are excluded. Used by the board-vision drills and the mistake explainer.
 */
export function hangingPieces(GameClass, fen, { minValue = 1 } = {}) {
  const game = new GameClass(fen);
  const mover = game.turn();
  const found = new Map();
  for (const m of game.moves({ verbose: true })) {
    if (!m.captured || m.captured === 'k' || VALUES[m.captured] < minValue) continue;
    if (m.flags.includes('e')) continue;
    const after = new GameClass(fen);
    after.move(m);
    if (after.isCheckmate()) continue;
    const recapture = after.moves({ verbose: true }).some(r => r.to === m.to && r.captured);
    if (recapture) {
      // A recapture exists; still "free" if what we captured outweighs what we lose.
      if (VALUES[m.captured] - VALUES[m.piece] < 1) continue;
    }
    const prev = found.get(m.to);
    const gain = recapture ? VALUES[m.captured] - VALUES[m.piece] : VALUES[m.captured];
    if (!prev || gain > prev.gain)
      found.set(m.to, { square: m.to, piece: m.captured, color: game.get(m.to).color, gain, capture: m.san, uci: moveToUci(m) });
  }
  return [...found.values()].filter(h => h.color !== mover);
}
