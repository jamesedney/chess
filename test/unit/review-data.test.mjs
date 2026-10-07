import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../../vendor/chess.js';
import { readClocks, parseTimeControl, timeSpent, moveTime, timeSummary, formatClock } from '../../src/clocks.js';
import { identifyOpening, openingStats, outcome, positionKey } from '../../src/openings.js';
import { OPENING_TABLE } from '../../data/openings.js';
import { applyDeepResult, nextPending } from '../../src/deep.js';
import { phaseOf, kindFromExplanation, KIND_IDS } from '../../src/mistake-kinds.js';
import { diagnoseMistake } from '../../src/tagger.js';

const PGN = `[Event "Rated blitz game"]
[TimeControl "180+2"]
[Result "0-1"]

1. e4 { [%clk 0:03:00] } 1... e5 { [%clk 0:03:00] } 2. Nf3 { [%clk 0:02:58.5] } 2... Nc6 { [%clk 0:02:55] } 3. Bc4 { [%clk 0:02:30] } 3... Nf6 { [%clk 0:02:54] } 0-1`;

test('clock comments become remaining time per move', () => {
  const clocks = readClocks(PGN, 6);
  assert.deepEqual(clocks, [180, 180, 178.5, 175, 150, 174]);
  assert.equal(readClocks(PGN, 7), null, 'a mismatch means no clock data rather than wrong data');
  const tc = parseTimeControl('180+2');
  assert.deepEqual(tc, { base: 180, inc: 2 });
  assert.equal(parseTimeControl('-'), null);
  assert.equal(timeSpent(clocks, tc, 0), 2);
  assert.equal(timeSpent(clocks, tc, 4), 30.5, 'Bc4 took 28.5 s of clock plus the 2 s increment');
  assert.equal(formatClock(65), '1:05');
  assert.equal(formatClock(3723), '1:02:03');
});

test('rushed moves and time trouble scale with the time control', () => {
  const review = {
    tc: { base: 180, inc: 0 },
    clocks: [178, 179, 176, 150, 10, 149],
    marks: [
      { ply: 2, cls: 'blunder' },
      { ply: 4, cls: 'mistake' },
      { ply: 5, cls: 'inaccuracy' },
    ],
  };
  assert.equal(moveTime(review, 2).rushed, true, 'two seconds on a blunder is rushed');
  assert.equal(moveTime(review, 4).trouble, false);
  assert.deepEqual(timeSummary(review), { known: 2, rushed: 1, trouble: 0 });
  assert.equal(moveTime({ ...review, clocks: undefined }, 2), null);
});

test('games are matched to the most specific named opening', () => {
  const g = new Chess();
  const fens = [g.fen()];
  for (const m of 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3'.split(' ')) {
    g.move(m);
    fens.push(g.fen());
  }
  const o = identifyOpening(fens);
  assert.equal(o.eco, 'B90');
  assert.match(o.name, /Najdorf/);
  assert.equal(o.family, 'Sicilian Defense');
  assert.ok(Object.keys(OPENING_TABLE).length > 3000);
  assert.equal(positionKey(fens[0]), positionKey(fens[0].replace(/ 0 1$/, ' 5 9')), 'move counters do not matter');
});

test('opening results are scored from the user’s side', () => {
  assert.equal(outcome('1-0', 'w'), 1);
  assert.equal(outcome('1-0', 'b'), 0);
  assert.equal(outcome('1/2-1/2', 'b'), 0.5);
  assert.equal(outcome('', 'w'), null);
  const s = openingStats([
    { opening: { family: 'Sicilian Defense' }, result: '0-1', colour: 'b', marks: [{ cls: 'blunder' }] },
    { opening: { family: 'Sicilian Defense' }, result: '1-0', colour: 'b', marks: [{ cls: 'mistake' }, { cls: 'blunder', cleared: true }] },
    { opening: { family: 'French Defense' }, result: '1/2-1/2', colour: 'b', marks: [] },
    { result: '1-0', colour: 'w', marks: [] },
  ]);
  assert.deepEqual(s[0], { family: 'Sicilian Defense', games: 2, wins: 1, draws: 0, losses: 1, errors: 2, score: 50 });
  assert.equal(s[1].score, 50);
});

const START = new Chess().fen();

test('a deep check clears a mark when the played move was best', () => {
  const review = { moves: ['e4'], marks: [{ ply: 0, cls: 'mistake', best: 'd2d4', bestSan: 'd4' }] };
  const mistake = { id: 'mx', line: ['d2d4'] };
  const r = applyDeepResult({
    review,
    mark: review.marks[0],
    mistake,
    record: null,
    fen: START,
    before: { best: 'e2e4', score: 30 },
    after: null,
  });
  assert.equal(r, 'cleared');
  assert.equal(review.marks[0].cleared, true);
  assert.equal(mistake.archived, true);
});

test('a deep check corrects the suggested move of an untried position only', () => {
  const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 2 4';
  const review = { moves: ['Qe2'], marks: [{ ply: 0, cls: 'blunder', best: 'c4f7', bestSan: 'Bxf7+' }] };
  const mistake = { id: 'mx', line: ['c4f7'], explanation: 'old' };
  const before = { best: 'f3f7', score: 10000, mate: 1, pv: ['f3f7'] };
  const after = { best: 'g8f6', score: 0, mate: null, pv: ['g8f6'] };
  const r = applyDeepResult({ review, mark: review.marks[0], mistake, record: null, fen, before, after });
  assert.equal(r, 'corrected');
  assert.equal(review.marks[0].bestSan, 'Qxf7#');
  assert.deepEqual(mistake.line, ['f3f7']);
  assert.equal(mistake.kind, 'missed-mate');
  const practised = { id: 'my', line: ['c4f7'] };
  const review2 = { moves: ['Qe2'], marks: [{ ply: 0, cls: 'blunder', best: 'c4f7', bestSan: 'Bxf7+' }] };
  applyDeepResult({ review: review2, mark: review2.marks[0], mistake: practised, record: { tries: 2 }, fen, before, after });
  assert.deepEqual(practised.line, ['c4f7'], 'a position already practised keeps its answer');
});

test('pending deep checks skip inaccuracies and finished marks', () => {
  const reviews = [
    {
      complete: true,
      marks: [
        { ply: 1, cls: 'inaccuracy' },
        { ply: 3, cls: 'mistake', deep: true },
      ],
    },
    { complete: false, marks: [{ ply: 2, cls: 'blunder' }] },
    { complete: true, marks: [{ ply: 5, cls: 'blunder' }] },
  ];
  assert.equal(nextPending(reviews).mark.ply, 5);
});

test('game phases', () => {
  assert.equal(phaseOf(START), 'opening');
  assert.equal(phaseOf('8/5pk1/6p1/8/3R4/6P1/5PK1/8 w - - 0 40'), 'endgame');
  assert.equal(phaseOf('r1bq1rk1/pp2bppp/2n1pn2/3p4/3P4/2NBPN2/PP3PPP/R2QK2R w KQ - 0 14'), 'middlegame');
});

test('mistake kinds come from the engine lines', () => {
  const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';
  // Black plays ...Qh4?? and White's knight takes it.
  const hung = diagnoseMistake({
    fen,
    played: 'Qh4',
    before: { best: 'b8c6', pv: ['b8c6'], score: 0 },
    after: { best: 'f3h4', pv: ['f3h4', 'g8f6'], score: 900, mate: null },
  });
  assert.equal(hung.kind, 'hung-piece');
  const mate = diagnoseMistake({
    fen: START,
    played: 'f3',
    before: { best: 'e2e4', pv: ['e2e4'], score: 30 },
    after: { best: 'e7e5', pv: ['e7e5', 'g2g4', 'd8h4'], score: 5000, mate: 2 },
  });
  assert.equal(mate.kind, 'allowed-mate');
  assert.ok(KIND_IDS.includes(kindFromExplanation('You played a3. Nf3 kept a stronger position.')));
  assert.equal(kindFromExplanation('Nxe5 forks the king and rook.'), 'missed-tactic');
});

import { judge, baseline, recordResult, ENDGAME_DRILLS } from '../../src/endgames.js';
import { makeVisualisation, nextPlies, makeCheckDrill, checkingMoves, scoreChecks, MAX_PLIES } from '../../src/calc.js';

const drill = id => ENDGAME_DRILLS.find(d => d.id === id);

test('endgame drills are judged by their goal', () => {
  const kq = drill('kq-k');
  const going = new Chess('7k/8/5QK1/8/8/8/8/8 b - - 0 1');
  const mate = new Chess('6k1/5Q2/6K1/8/8/8/8/8 w - - 0 1');
  mate.move('Qg7#');
  assert.equal(judge(kq, mate, 'w', 5, baseline(new Chess(kq.fen))).state, 'won');
  const stale = new Chess('7k/8/6K1/8/8/8/8/5Q2 w - - 0 1');
  stale.move('Qf7');
  assert.equal(judge(kq, stale, 'w', 5, baseline(new Chess(kq.fen))).state, 'lost', 'stalemate throws the win away');
  assert.equal(judge(kq, going, 'w', kq.limit, baseline(new Chess(kq.fen))).state, 'playing', 'the limit only bites on your turn');
  const slow = new Chess('8/8/8/4k3/8/8/8/3QK3 w - - 0 1');
  assert.match(judge(kq, slow, 'w', kq.limit, baseline(slow)).reason, /Out of moves/);
});

test('promotion and defence drills', () => {
  const kp = drill('kp-win');
  const base = baseline(new Chess(kp.fen));
  assert.equal(judge(kp, new Chess('3Qk3/8/8/8/8/8/8/4K3 b - - 0 1'), 'w', 4, base).state, 'playing', 'wait for the reply');
  assert.equal(judge(kp, new Chess('3Q4/4k3/8/8/8/8/8/4K3 w - - 0 1'), 'w', 5, base).state, 'won');
  const hold = drill('kp-draw');
  const hb = baseline(new Chess(hold.fen));
  assert.equal(judge(hold, new Chess('4Q3/8/8/2k5/8/8/8/4K3 b - - 0 1'), 'b', 6, hb).state, 'lost');
  assert.equal(judge(hold, new Chess('8/4k3/8/8/8/4K3/8/8 w - - 0 1'), 'b', 6, hb).state, 'won', 'bare kings are a draw');
  assert.equal(judge(hold, new Chess(hold.fen), 'b', hold.limit, hb).state, 'won', 'surviving the limit holds');
  assert.deepEqual(recordResult(undefined, { won: true, moves: 9, assisted: false }), { tries: 1, wins: 1, best: 9 });
  assert.deepEqual(recordResult({ tries: 1, wins: 1, best: 9 }, { won: true, moves: 7, assisted: true }), { tries: 2, wins: 1, best: 9 });
});

let seed = 7;
const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const SEEDS = [
  'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
  'r2q1rk1/ppp2ppp/2np1n2/2b1p1B1/2B1P1b1/2NP1N2/PPP2PPP/R2Q1RK1 w - - 0 8',
];

test('visualisation questions track a piece through the line', () => {
  for (let i = 0; i < 20; i++) {
    const v = makeVisualisation(SEEDS, 4, rng);
    assert.ok(v);
    assert.equal(v.sans.length, 4);
    const g = new Chess(v.fen);
    for (const s of v.sans) g.move(s);
    assert.equal(g.fen(), v.finalFen);
    const p = g.get(v.answer);
    assert.equal(p.color, v.piece.color);
    assert.equal(p.type, v.piece.type);
  }
  assert.equal(nextPlies(MAX_PLIES, true), MAX_PLIES);
  assert.equal(nextPlies(2, false), 2);
  assert.equal(nextPlies(4, true), 5);
});

test('check drills list every checking move', () => {
  assert.deepEqual(checkingMoves('4k3/8/8/8/8/8/8/R3K3 w - - 0 1'), ['a1a8']);
  const d = makeCheckDrill(SEEDS, rng, { min: 1, max: 10 });
  assert.ok(d === null || d.checks.length >= 1);
  assert.equal(scoreChecks(3, 5), 0);
});
