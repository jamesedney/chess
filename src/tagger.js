// Recognise the tactical ideas inside a move sequence and describe them.
// Used to tag puzzles at build time and to explain personal mistakes in the app.
import { Chess } from '../vendor/chess.js';
import { VALUES, NAMES, playUci, materialBalance, totalMaterial, hangingPieces, opposite } from './chess-utils.js';

const SQUARES = [];
for (const f of 'abcdefgh') for (let r = 1; r <= 8; r++) SQUARES.push(f + r);

function piecesOf(game, color) {
  const out = [];
  for (const sq of SQUARES) {
    const p = game.get(sq);
    if (p && p.color === color) out.push({ square: sq, ...p });
  }
  return out;
}

function kingSquare(game, color) {
  return SQUARES.find(sq => {
    const p = game.get(sq);
    return p && p.type === 'k' && p.color === color;
  });
}

const coords = sq => [sq.charCodeAt(0) - 97, Number(sq[1]) - 1];

/** True when c lies beyond b on the ray from a through b. */
function beyondOnRay(a, b, c) {
  const [ax, ay] = coords(a);
  const [bx, by] = coords(b);
  const [cx, cy] = coords(c);
  const dx = Math.sign(bx - ax);
  const dy = Math.sign(by - ay);
  const straight = ax === bx || ay === by || Math.abs(bx - ax) === Math.abs(by - ay);
  if (!straight) return false;
  if (Math.sign(cx - bx) !== dx || Math.sign(cy - by) !== dy) return false;
  return cx === bx || cy === by || Math.abs(cx - bx) === Math.abs(cy - by);
}

function describePiece(p) {
  return NAMES[p.type];
}

/** Opponent pieces the moved piece now attacks that are worth attacking. */
function forkTargets(game, move, solver) {
  const opp = opposite(solver);
  const attacker = game.get(move.to);
  if (!attacker) return [];
  const targets = [];
  for (const p of piecesOf(game, opp)) {
    if (!game.attackers(p.square, solver).includes(move.to)) continue;
    if (p.type === 'k') {
      targets.push(p);
      continue;
    }
    if (VALUES[p.type] < 3) continue;
    const defended = game.attackers(p.square, opp).length > 0;
    if (VALUES[p.type] > VALUES[attacker.type] || !defended) targets.push(p);
  }
  // Read the king first, then the most valuable targets.
  return targets.sort((a, b) => (b.type === 'k') - (a.type === 'k') || VALUES[b.type] - VALUES[a.type]);
}

/** A pin the moved slider creates: the pinned piece and what stands behind it. */
function pinCreated(game, move, solver) {
  const attacker = game.get(move.to);
  if (!attacker || !['b', 'r', 'q'].includes(attacker.type)) return null;
  const opp = opposite(solver);
  for (const p of piecesOf(game, opp)) {
    if (p.type === 'k') continue;
    if (!game.attackers(p.square, solver).includes(move.to)) continue;
    const probe = new Chess(game.fen());
    probe.remove(p.square);
    for (const behind of piecesOf(probe, opp)) {
      if (!beyondOnRay(move.to, p.square, behind.square)) continue;
      if (!probe.attackers(behind.square, solver).includes(move.to)) continue;
      if (behind.type === 'k' || VALUES[behind.type] > VALUES[p.type]) {
        return { pinned: p, behind, absolute: behind.type === 'k' };
      }
    }
  }
  return null;
}

/** Attacks on the king or a valuable piece revealed by moving another piece. */
function discoveredAttack(beforeFen, game, move, solver) {
  if (move.flags.includes('k') || move.flags.includes('q')) return null;
  const before = new Chess(beforeFen);
  const opp = opposite(solver);
  for (const p of piecesOf(game, opp)) {
    if (p.type !== 'k' && VALUES[p.type] < 5) continue;
    const now = game.attackers(p.square, solver).filter(sq => sq !== move.to);
    const then = new Set(before.attackers(p.square, solver));
    const fresh = now.find(sq => !then.has(sq));
    if (fresh) {
      const doubleCheck = p.type === 'k' && game.attackers(p.square, solver).includes(move.to);
      return { target: p, from: fresh, piece: game.get(fresh), doubleCheck };
    }
  }
  return null;
}

function mateShape(game) {
  const mated = game.turn();
  const ksq = kingSquare(game, mated);
  if (!ksq) return {};
  const winner = opposite(mated);
  const checkers = game.attackers(ksq, winner).map(sq => ({ square: sq, ...game.get(sq) }));
  const [kx, ky] = coords(ksq);
  const neighbours = [];
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const x = kx + dx;
      const y = ky + dy;
      if (x >= 0 && x < 8 && y >= 0 && y < 8) neighbours.push(String.fromCharCode(97 + x) + (y + 1));
    }
  const own = sq => game.get(sq)?.color === mated;
  const smothered = checkers.length === 1 && checkers[0].type === 'n' && neighbours.every(own);
  const homeRank = mated === 'w' ? 0 : 7;
  const forward = mated === 'w' ? 1 : -1;
  const backRank =
    ky === homeRank &&
    checkers.some(c => ['r', 'q'].includes(c.type) && coords(c.square)[1] === homeRank) &&
    neighbours.filter(sq => coords(sq)[1] === homeRank + forward).some(own);
  return { smothered, backRank };
}

/**
 * Analyse a solution line from `fen` (solver to move).
 * Returns { tags, facts } where facts hold the details needed for explanations.
 */
export function analyseLine(fen, line, { score = null, setup = null } = {}) {
  let start = fen;
  if (setup) {
    const g = new Chess(fen);
    playUci(g, setup);
    start = g.fen();
  }
  const game = new Chess(start);
  const solver = game.turn();
  const sign = solver === 'w' ? 1 : -1;
  const startMaterial = materialBalance(game) * sign;
  const nonKing = totalMaterial(game);
  const fullmove = Number(start.split(' ')[5] || 1);
  const facts = {
    solver,
    moves: [],
    forks: [],
    pins: [],
    skewers: [],
    discovered: null,
    promotion: null,
    hanging: null,
    minMaterial: startMaterial,
  };
  const tags = new Set();

  const free = hangingPieces(Chess, start, { minValue: 3 });

  for (let i = 0; i < line.length; i++) {
    const beforeFen = game.fen();
    let move;
    try {
      move = playUci(game, line[i]);
    } catch {
      break;
    }
    facts.moves.push(move);
    if (i % 2 === 1) {
      facts.minMaterial = Math.min(facts.minMaterial, materialBalance(game) * sign);
      continue;
    }
    if (move.promotion) {
      facts.promotion = facts.promotion || { san: move.san, piece: move.promotion };
      tags.add('promotion');
      if (move.promotion !== 'q') tags.add('underPromotion');
    }
    if (move.flags.includes('e')) tags.add('enPassant');
    if (move.flags.includes('k') || move.flags.includes('q')) tags.add('castling');
    if (move.captured && move.to === (solver === 'w' ? 'f7' : 'f2')) tags.add('attackingF2F7');
    if (game.isCheckmate()) continue;
    const targets = forkTargets(game, move, solver);
    if (targets.length >= 2 && !facts.forks.length) {
      facts.forks.push({ ply: i, san: move.san, piece: game.get(move.to), square: move.to, targets });
      tags.add('fork');
    }
    const pin = pinCreated(game, move, solver);
    if (pin) facts.pins.push({ ply: i, san: move.san, piece: game.get(move.to), ...pin });
    const disc = discoveredAttack(beforeFen, game, move, solver);
    if (disc && !facts.discovered) {
      facts.discovered = { ply: i, san: move.san, ...disc };
      tags.add(disc.doubleCheck ? 'doubleCheck' : 'discoveredAttack');
    }
  }

  // Skewers: attack a big piece, it steps aside, take what was behind it.
  const m = facts.moves;
  for (let i = 0; i + 2 < m.length; i += 2) {
    const a = m[i];
    const reply = m[i + 1];
    const take = m[i + 2];
    if (!['b', 'r', 'q'].includes(a.promotion || a.piece)) continue;
    if (take.from !== a.to || !take.captured) continue;
    if (!['k', 'q', 'r'].includes(reply.piece)) continue;
    if (VALUES[reply.piece] !== 0 && VALUES[reply.piece] <= VALUES[take.captured]) continue;
    if (beyondOnRay(a.to, reply.from, take.to)) {
      facts.skewers.push({ san: a.san, front: reply.piece, back: take.captured });
      tags.add('skewer');
      break;
    }
  }

  // Pins only count when the line exploits them.
  for (const pin of facts.pins) {
    const exploited = m.some(
      (mv, j) => j > pin.ply && j % 2 === 0 && mv.captured && (mv.to === pin.pinned.square || mv.to === pin.behind.square),
    );
    if (exploited || (line.length === 1 && pin.absolute && VALUES[pin.pinned.type] >= 3)) {
      tags.add('pin');
      facts.pin = pin;
      break;
    }
  }

  const first = m[0];
  if (first) {
    facts.first = first;
    const mateInOne = line.length === 1 && game.isCheckmate();
    if (!first.captured && !first.san.includes('+') && !first.promotion && !mateInOne) tags.add('quietMove');
    const hang = first.captured && free.find(h => h.square === first.to);
    if (hang && line.length <= 3 && !game.isCheckmate()) {
      tags.add('hangingPiece');
      facts.hanging = { square: first.to, piece: first.captured, san: first.san };
    }
  }

  if (line.length >= 3 && facts.minMaterial <= startMaterial - 2) tags.add('sacrifice');

  if (game.isCheckmate() && m.length === line.length) {
    const playerMoves = Math.ceil(line.length / 2);
    tags.add('mate');
    tags.add('mateIn' + playerMoves);
    const shape = mateShape(game);
    if (shape.smothered) tags.add('smotheredMate');
    if (shape.backRank) tags.add('backRankMate');
  } else if (score !== null) {
    tags.add(score >= 600 ? 'crushing' : 'advantage');
  }

  const playerMoves = Math.ceil(line.length / 2);
  if (playerMoves) tags.add(['oneMove', 'short', 'long', 'veryLong'][Math.min(playerMoves, 4) - 1]);

  // Phase of the game.
  const startGame = new Chess(start);
  const types = new Set(
    piecesOf(startGame, 'w')
      .concat(piecesOf(startGame, 'b'))
      .map(p => p.type),
  );
  types.delete('k');
  if (nonKing <= 20 || (!types.has('q') && nonKing <= 30)) {
    tags.add('endgame');
    const only = t => [...types].every(x => x === 'p' || x === t);
    if ([...types].every(x => x === 'p')) tags.add('pawnEndgame');
    else if (only('r')) tags.add('rookEndgame');
    else if (only('q')) tags.add('queenEndgame');
    else if (only('b')) tags.add('bishopEndgame');
    else if (only('n')) tags.add('knightEndgame');
  } else if (fullmove <= 10 && nonKing >= 62) tags.add('opening');
  else tags.add('middlegame');

  return { tags: [...tags], facts };
}

const list = items => (items.length <= 1 ? items.join('') : items.slice(0, -1).join(', ') + ' and ' + items.at(-1));

/** One or two sentences explaining a solved puzzle. */
export function explainLine(fen, line, opts = {}) {
  const { tags, facts } = analyseLine(fen, line, opts);
  const first = facts.first?.san || '';
  const n = Math.ceil(line.length / 2);
  if (tags.includes('mate')) {
    if (tags.includes('smotheredMate')) return `${first} leads to a smothered mate: the king is boxed in by its own pieces.`;
    if (tags.includes('backRankMate'))
      return `The king is trapped on its back rank by its own pieces. ${first} ${n > 1 ? `starts a forced mate in ${n}` : 'is mate'}.`;
    if (n === 1) return `${first} is checkmate. Every escape square is covered.`;
    if (first.includes('+')) return `${first} starts a forced mate in ${n}. Each check takes away more of the king’s squares.`;
    return `${first} sets up a forced mate in ${n}. It is not a check, but the king has no defence against what follows.`;
  }
  const parts = [];
  if (tags.includes('sacrifice')) parts.push('Material is given up to open the position.');
  if (facts.forks.length) {
    const f = facts.forks[0];
    parts.push(`${f.san} forks the ${list(f.targets.map(describePiece))}.`);
  } else if (facts.skewers.length) {
    const s = facts.skewers[0];
    parts.push(`${s.san} skewers the ${NAMES[s.front]}, winning the ${NAMES[s.back]} behind it.`);
  } else if (facts.pin) {
    parts.push(`${facts.pin.san} pins the ${describePiece(facts.pin.pinned)} to the ${describePiece(facts.pin.behind)}.`);
  } else if (facts.discovered) {
    const d = facts.discovered;
    parts.push(
      d.doubleCheck
        ? `${d.san} gives double check, so the king must move.`
        : `${d.san} uncovers an attack from the ${describePiece(d.piece)} on ${d.from}.`,
    );
  } else if (facts.hanging) {
    parts.push(`The ${NAMES[facts.hanging.piece]} on ${facts.hanging.square} was undefended. ${facts.hanging.san} wins it.`);
  } else if (facts.promotion) {
    parts.push(`${facts.promotion.san} makes a new ${NAMES[facts.promotion.piece]}.`);
  } else if (tags.includes('quietMove')) {
    parts.push(`${first} is a quiet move: not a check or a capture, yet the only way to keep the advantage.`);
  } else if (first) {
    parts.push(`${first} is the only move that keeps a clear advantage.`);
  }
  return parts.join(' ');
}

/**
 * Explain a personal mistake.
 * before/after are engine results: before = best line for the player before
 * moving; after = best line for the opponent after the played move.
 */
export function explainMistake({ fen, played, before, after }) {
  const game = new Chess(fen);
  const bestSan = before?.pv?.length ? safeSan(fen, before.pv[0]) : null;
  if (after?.mate > 0) {
    const reply = safeSan(afterFen(fen, played), after.pv[0]);
    return `${played} allowed a forced mate in ${after.mate}${reply ? `, starting with ${reply}` : ''}. ${bestSan ? `${bestSan} was safer.` : ''}`.trim();
  }
  if (before?.mate > 0) return `You had a forced mate in ${before.mate}${bestSan ? ` starting with ${bestSan}` : ''}.`;

  // Did the move hand over material?
  if (after?.pv?.length) {
    const pos = new Chess(afterFen(fen, played));
    const mover = game.turn();
    const sign = mover === 'w' ? 1 : -1;
    const start = materialBalance(pos) * sign;
    let worst = start;
    const plies = after.pv.slice(0, 4);
    let captured = null;
    for (let i = 0; i < plies.length; i++) {
      let mv;
      try {
        mv = playUci(pos, plies[i]);
      } catch {
        break;
      }
      if (i === 0 && mv.captured) captured = { piece: mv.captured, square: mv.to, san: mv.san };
      worst = Math.min(worst, materialBalance(pos) * sign);
    }
    if (captured && start - worst >= 2) {
      return `${played} left your ${NAMES[captured.piece]} on ${captured.square} exposed: ${captured.san} wins material.${bestSan ? ` ${bestSan} was stronger.` : ''}`;
    }
  }

  if (before?.pv?.length) {
    const line = before.pv.slice(0, 5);
    if (line.length % 2 === 0) line.pop();
    const idea = explainLine(fen, line);
    if (idea && bestSan) return `You played ${played}. Better was ${bestSan}. ${idea}`;
  }
  return bestSan ? `You played ${played}. ${bestSan} kept a stronger position.` : `You played ${played}. A stronger move was available.`;
}

function afterFen(fen, san) {
  const g = new Chess(fen);
  g.move(san);
  return g.fen();
}

function safeSan(fen, uci) {
  try {
    return playUci(new Chess(fen), uci).san;
  } catch {
    return null;
  }
}
