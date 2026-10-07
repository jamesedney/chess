// Opening names for game positions, from the Lichess chess-openings table (CC0).
import { OPENING_TABLE } from '../data/openings.js';

/** FNV-1a hash of a position's placement, side, castling and en passant fields, in base 36. */
export function positionKey(fen) {
  const epd = fen.split(' ').slice(0, 4).join(' ');
  let h = 0x811c9dc5;
  for (let i = 0; i < epd.length; i++) {
    h ^= epd.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * The most specific named opening reached in a game, from the list of FENs
 * after each move. Returns { eco, name, family, ply } or null.
 */
export function identifyOpening(fens, table = OPENING_TABLE, maxPly = 40) {
  let found = null;
  for (let i = 0; i < Math.min(fens.length, maxPly + 1); i++) {
    const hit = table[positionKey(fens[i])];
    if (hit) {
      const [eco, name] = hit.split('|');
      found = { eco, name, family: name.split(':')[0].trim(), ply: i };
    }
  }
  return found;
}

/**
 * Results grouped by opening family from the user's point of view.
 * Returns [{ family, games, wins, draws, losses, score, errors }] sorted by games played.
 */
export function openingStats(reviews) {
  const by = new Map();
  for (const r of reviews) {
    if (!r.opening) continue;
    const s = by.get(r.opening.family) || { family: r.opening.family, games: 0, wins: 0, draws: 0, losses: 0, errors: 0 };
    s.games++;
    const res = outcome(r.result, r.colour);
    if (res === 1) s.wins++;
    else if (res === 0.5) s.draws++;
    else if (res === 0) s.losses++;
    s.errors += r.marks.filter(m => m.cls !== 'inaccuracy' && !m.cleared).length;
    by.set(r.opening.family, s);
  }
  return [...by.values()]
    .map(s => {
      const decided = s.wins + s.draws + s.losses;
      return { ...s, score: decided ? Math.round(((s.wins + s.draws / 2) / decided) * 100) : null };
    })
    .sort((a, b) => b.games - a.games || a.family.localeCompare(b.family));
}

/** 1 win, 0.5 draw, 0 loss, null unknown, for the side the user played. */
export function outcome(result, colour) {
  if (result === '1/2-1/2') return 0.5;
  if (result === '1-0') return colour === 'w' ? 1 : 0;
  if (result === '0-1') return colour === 'b' ? 1 : 0;
  return null;
}
