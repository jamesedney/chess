// Shared fixtures for the v5 tests: reviewed games, ledger rows and states.
import { defaults } from '../../src/state.js';

export const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const NOW = Date.parse('2026-10-13T21:00:00Z');
export const DAY = 86400000;
/** You (White) lose after 5. Nxf7?? when 5. Bxf7+ was winning. */
export const MOVES = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4', 'Nxe5', 'Qg5', 'Nxf7', 'Qxg2'];
export const FEN_BEFORE_NXF7 = 'r1b1kbnr/pppp1ppp/8/4N1q1/2BnP3/8/PPPP1PPP/RNBQK2R w KQkq - 1 5';
let seq = 0;

/**
 * A reviewed game. evals: { ply: whiteCentipawns } (unset plies stay null),
 * marks: [{ ply, cls, loss, best, bestSan, mistakeId, refute, reason }].
 */
export function review({ colour = 'w', result = '0-1', moves = MOVES, evals = {}, marks = [], created = NOW, clocks, tc, ...rest } = {}) {
  const ev = new Array(moves.length + 1).fill(null);
  for (const [k, v] of Object.entries(evals)) ev[Number(k)] = v;
  const id = 'r' + ++seq;
  return {
    id,
    key: 'k' + seq,
    gameKey: 'lichess.org/' + id,
    complete: true,
    created,
    white: colour === 'w' ? 'me' : 'rival',
    black: colour === 'w' ? 'rival' : 'me',
    result,
    colour,
    startFen: START,
    moves,
    evals: ev,
    marks: marks.map(m => ({ cls: 'mistake', loss: 20, best: 'a2a3', bestSan: 'a3', ...m })),
    ...(clocks ? { clocks, tc } : {}),
    ...rest,
  };
}

/** The classic lost game: winning (+3.2) before 5. Nxf7??, lost (−5.5) after, a hung-piece mistake saved. */
export function lostGame({ created = NOW, ...rest } = {}) {
  const r = review({
    created,
    evals: { 8: 320, 9: -550 },
    marks: [{ ply: 8, cls: 'blunder', loss: 60, best: 'c4f7', bestSan: 'Bxf7+', refute: 'g5g2', mistakeId: 'm' + (seq + 1) }],
    ...rest,
  });
  r.marks[0].mistakeId = 'm' + r.id.slice(1);
  return r;
}

/** The saved mistake for lostGame(): Bxf7+ instead of Nxf7. */
export function mistakeFor(r, kind = 'hung-piece') {
  return {
    id: 'm' + r.id.slice(1),
    title: 'Instead of Nxf7',
    fen: FEN_BEFORE_NXF7,
    line: ['c4f7'],
    theme: 'Personal mistakes',
    tags: ['mate'],
    goal: 'Find the improvement.',
    explanation: 'Bxf7+ wins the queen after Kd8 Nxg5.',
    played: 'Nxf7',
    loss: 60,
    created: r.created,
    kind,
    source: { reviewId: r.id, ply: 8 },
  };
}

/** A ledger row: a loss by default, blitz 5+0, exact times. */
export function row({
  t = NOW,
  r = 0,
  d = 300,
  x = 1,
  k = null,
  tc = 'blitz',
  base = 300,
  inc = 0,
  term = 'resign',
  c = 'w',
  me = 1200,
  opp = 1220,
  rated = 1,
  src = 'lichess',
  n = 60,
} = {}) {
  return {
    k: k || 'lichess.org/' + Math.round(t / 1000).toString(36) + '-' + ++seq,
    t,
    d,
    x,
    r,
    c,
    tc,
    base,
    inc,
    term,
    n,
    me,
    opp,
    rated,
    src,
  };
}

/** A state with reviews, their mistakes and a ledger. */
export function stateWith({ reviews = [], mistakes = null, ledger = [], ...rest } = {}) {
  return {
    ...defaults(),
    onboarded: true,
    reviews,
    mistakes: mistakes ?? reviews.filter(r => r.marks.some(m => m.mistakeId)).map(r => mistakeFor(r)),
    ledger,
    ...rest,
  };
}
