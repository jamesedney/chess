// Nemesis: an opponent built from how you lose. It plays like a person of
// your level (Maia's candidate moves) but, when one of those candidates
// leaves a position where the move you would probably play is a blunder, it
// plays that one. The trap is defined by a model of you, not by what looks
// tempting: a 1250 player rarely takes a poisoned piece, but often makes the
// natural quiet move that leaves one hanging. You are scored on each trap,
// taken or declined. Pure functions of a position, an engine and a
// predictor; the Play page wires them up.
import { Chess } from '../vendor/chess.js';
import { moveToUci } from './chess-utils.js';

/** A likely reply that loses this much (centipawns, your view) is a trap. */
export const TRAP_LOSS = 150;
/** Nemesis gives up at most this much to set a trap (centipawns, its view). */
export const TRAP_COST = 60;
/** Its candidates: the likeliest human moves, with at least this probability after the first. */
export const MAX_CANDIDATES = 4;
export const MIN_PROB = 0.04;
/** Your replies read as likely: the top few with at least this probability. */
export const REPLIES = 3;
export const MIN_REPLY_PROB = 0.08;
/** Engine lines asked for your replies, and the search size for each candidate. */
export const REPLY_LINES = 6;
export const NODES = 30000;
/** While you think, Nemesis works out its reply to this many of your likeliest moves, each at least this likely. */
export const AHEAD = 2;
export const MIN_AHEAD_PROB = 0.12;

/** A mate score as centipawns, so the maths below can compare it. */
const cp = line => (line.mate != null ? (line.mate > 0 ? 1 : -1) * (10000 - Math.abs(line.mate)) : (line.score ?? 0));

/** Your moves worth preparing a reply to: the likeliest AHEAD with at least MIN_AHEAD_PROB, from [{ uci, p }] likeliest first. */
export function likelyYours(moves) {
  return moves.slice(0, AHEAD).filter(m => m.p >= MIN_AHEAD_PROB);
}

/** The Maia level that plays most like a player of this rating. */
export function maiaFor(rating) {
  return rating < 1300 ? 1100 : rating < 1700 ? 1500 : 1900;
}

/** Centipawns a reply loses against the best, from one multi-line analysis of its position. */
function lossOf(uci, lines) {
  const best = cp(lines[0]);
  const line = lines.find(l => l.pv?.[0] === uci);
  if (line) return best - cp(line);
  // A reply missing from a full set of lines is worse than the last line shown.
  return lines.length >= REPLY_LINES ? best - cp(lines[lines.length - 1]) : null;
}

/**
 * The trap in a position with you to move, if there is one: among your
 * likely replies (`replies`: [{ uci, p }], likeliest first), the likeliest
 * that loses TRAP_LOSS or more against the engine's best (`lines`, scores
 * from your side). Returns { uci, san, p, loss, best } or null.
 */
export function trapIn(fen, lines, replies) {
  if (!lines?.length || !replies?.length) return null;
  const g = new Chess(fen);
  const likely = replies.slice(0, REPLIES).filter(r => r.p >= MIN_REPLY_PROB);
  for (const r of likely) {
    const loss = lossOf(r.uci, lines);
    if (loss === null || loss < TRAP_LOSS) continue;
    let san;
    try {
      san = new Chess(fen).move({ from: r.uci.slice(0, 2), to: r.uci.slice(2, 4), promotion: r.uci[4] }).san;
    } catch {
      continue;
    }
    const bestUci = lines[0].pv?.[0] || null;
    let best = null;
    if (bestUci)
      try {
        best = g.move({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), promotion: bestUci[4] }).san;
      } catch {}
    return { uci: r.uci, san, p: r.p, loss, best };
  }
  return null;
}

/**
 * Choose Nemesis's move in `fen` (Nemesis to move). `candidates` are its
 * likely moves, [{ uci, p }], likeliest first. `analyse(fen, { multipv,
 * nodes })` is the engine; `predict(fen)` resolves with your likely replies
 * in a position. Each candidate costs one analysis and one prediction of the
 * position after it. The move is the candidate whose trap is worth most
 * (probability times loss) among those within TRAP_COST of the best
 * candidate, else the likeliest candidate. Resolves with { uci, trap, cost,
 * considered }, or null once `alive()` says the answer is no longer wanted.
 */
export async function nemesisMove(
  fen,
  candidates,
  analyse,
  predict,
  { nodes = NODES, alive = /** @type {() => boolean} */ (() => true) } = {},
) {
  const judged = [];
  for (const c of candidates.slice(0, MAX_CANDIDATES)) {
    if (!alive()) return null;
    if (judged.length && c.p < MIN_PROB) break;
    const after = new Chess(fen);
    try {
      after.move({ from: c.uci.slice(0, 2), to: c.uci.slice(2, 4), promotion: c.uci[4] });
    } catch {
      continue;
    }
    if (after.isGameOver()) {
      judged.push({ uci: c.uci, ours: after.isCheckmate() ? 10000 : 0, trap: null });
      continue;
    }
    const r = await analyse(after.fen(), { multipv: REPLY_LINES, nodes });
    const lines = r.lines?.length ? r.lines : [r];
    const replies = await predict(after.fen());
    // The top line is your best reply, from your side; Nemesis's view is the opposite.
    judged.push({ uci: c.uci, ours: -cp(lines[0]), trap: trapIn(after.fen(), lines, replies) });
  }
  if (!alive()) return null;
  if (!judged.length) {
    const legal = new Chess(fen).moves({ verbose: true });
    return { uci: legal.length ? moveToUci(legal[0]) : null, trap: null, cost: 0, considered: 0 };
  }
  const top = Math.max(...judged.map(j => j.ours));
  const worth = j => j.trap.p * j.trap.loss;
  const set = judged.filter(j => j.trap && top - j.ours <= TRAP_COST).sort((a, b) => worth(b) - worth(a))[0];
  const pick = set || judged[0];
  return { uci: pick.uci, trap: pick.trap, cost: top - pick.ours, considered: judged.length };
}

/** "Re8 would have lost a rook; Nf6 was the move." for a trap, from its loss in centipawns. */
export function trapText(trap) {
  const what =
    trap.loss >= 9000
      ? 'the game'
      : trap.loss >= 800
        ? 'the queen'
        : trap.loss >= 450
          ? 'a rook'
          : trap.loss >= 250
            ? 'a piece'
            : 'material';
  return `${trap.san} would have lost ${what}${trap.best ? `; ${trap.best} was the move` : ''}.`;
}

/** "Traps 5, taken 2." over a game's [{ taken }], or '' with none. */
export function trapTally(traps) {
  const set = traps.length;
  if (!set) return '';
  return `Traps ${set}, taken ${traps.filter(t => t.taken).length}.`;
}
