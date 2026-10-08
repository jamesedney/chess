import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../../vendor/chess.js';
import {
  isolatedPawns,
  doubledPawns,
  passedPawns,
  backwardPawns,
  outposts,
  openFiles,
  halfOpenFiles,
  badBishops,
  looseKingSquares,
  squareColor,
  describeStructure,
} from '../../src/structure.js';
import { bucketOf, scoreGuess, pickPositions, playerBias, calibration, evalText, BUCKETS } from '../../src/assess.js';
import { defaults, migrate, validate, logCandidates, CURRENT_VERSION } from '../../src/state.js';
import { primaryTheme, THEMES } from '../../src/themes.js';
import { STRATEGY_LESSONS } from '../../data/strategy-lessons.js';
import { lessons } from '../../data/lessons.js';

test('pawn structure facts', () => {
  const g = new Chess('r2q1rk1/pp3ppp/2p1pn2/2p5/3P4/5N2/PP3PPP/R2Q1RK1 w - - 0 12');
  assert.deepEqual(isolatedPawns(g, 'w'), ['d4']);
  assert.deepEqual(isolatedPawns(g, 'b'), []);
  assert.deepEqual(doubledPawns(g, 'b').sort(), ['c5', 'c6']);
  assert.deepEqual(passedPawns(new Chess('8/5pk1/6p1/1P6/8/6P1/5PK1/8 w - - 0 1'), 'w'), ['b5']);
  assert.deepEqual(passedPawns(new Chess('8/8/3p4/1P6/8/8/8/4K2k w - - 0 1'), 'b'), ['d6']);
  assert.deepEqual(backwardPawns(new Chess('8/8/2p5/3p4/3P4/8/8/4K2k w - - 0 1'), 'b'), ['c6']);
  assert.deepEqual(backwardPawns(new Chess('8/pp6/2p5/3pP3/3P4/8/8/4K2k w - - 0 1'), 'b'), [], 'b7 can still support c6');
  assert.equal(squareColor('a1'), 'dark');
  assert.equal(squareColor('h1'), 'light');
});

test('outposts, files and bishops', () => {
  assert.deepEqual(outposts(new Chess('r2q1rk1/1b2bppp/p1n1pn2/1p1pN3/3P4/P1NBP3/1P3PPP/R2Q1RK1 w - - 0 1'), 'w'), ['c5']);
  assert.deepEqual(outposts(new Chess('r1bq1rk1/pp2bppp/2n2n2/3p4/3P1B2/2N1PN2/PP3PPP/R2QKB1R w KQ - 0 9'), 'w'), ['d4']);
  assert.deepEqual(openFiles(new Chess('r4rk1/ppp1bppp/2n5/8/8/2N5/PPP1PPPP/R3R1K1 w - - 0 1')), ['d']);
  assert.deepEqual(halfOpenFiles(new Chess('r4rk1/pp2bppp/2n5/8/8/2N5/PPP1PPPP/R3R1K1 w - - 0 1'), 'b'), ['c', 'e']);
  const bishops = new Chess('6k1/6p1/2b2p1p/3pP3/2pP4/2P3P1/5P2/2B3K1 w - - 0 1');
  assert.deepEqual(badBishops(bishops, 'w'), ['c1']);
  assert.deepEqual(badBishops(bishops, 'b'), []);
  assert.deepEqual(looseKingSquares(new Chess('r4rk1/pp3p2/2n3p1/8/2B5/2N5/PP3PPP/R3R1K1 w - - 0 1'), 'b').sort(), ['g7', 'h7', 'h8']);
  const facts = describeStructure(new Chess('r2q1rk1/1b2bppp/p1n1pn2/1p1pN3/3P4/P1NBP3/1P3PPP/R2Q1RK1 w - - 0 1'));
  assert.ok(facts.some(f => /c-file is open/.test(f)));
});

test('assessment buckets, scoring and bias', () => {
  assert.equal(bucketOf(300), 0);
  assert.equal(bucketOf(80), 1);
  assert.equal(bucketOf(0), 2);
  assert.equal(bucketOf(-80), 3);
  assert.equal(bucketOf(-400), 4);
  assert.equal(scoreGuess(2, 10), 2);
  assert.equal(scoreGuess(1, 10), 1);
  assert.equal(scoreGuess(0, -200), 0);
  assert.equal(evalText(130), '+1.3');
  assert.equal(evalText(-50), '-0.5');
  // White player says "White clearly better" when it is equal: overrated own side.
  assert.equal(playerBias(0, 0, 'w'), 2);
  // Black player says "White clearly better" when it is equal: underrated own side.
  assert.equal(playerBias(0, 0, 'b'), -2);
  assert.equal(calibration([]).verdict, 'unknown');
  assert.equal(
    calibration([
      { score: 10, total: 10, bias: 0.8 },
      { score: 12, total: 10, bias: 0.6 },
    ]).verdict,
    'optimistic',
  );
  assert.equal(
    calibration([
      { score: 14, total: 10, bias: 0.1 },
      { score: 12, total: 10, bias: -0.2 },
    ]).verdict,
    'balanced',
  );
  assert.equal(BUCKETS.length, 5);
});

test('positions to assess come from the user’s turn after the opening, spread across games', () => {
  const moves = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3', 'd6', 'O-O', 'O-O', 'Bg5', 'h6', 'Bh4', 'g5'];
  const review = colour => ({
    id: 'r' + colour,
    complete: true,
    colour,
    white: 'a',
    black: 'b',
    startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    moves,
    evals: moves.map((_, i) => (i === 10 ? 10000 : 20 * (i % 3))).concat([0]),
  });
  let seed = 11;
  const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const picks = pickPositions([review('w'), review('b')], { count: 8, rng, Chess });
  assert.equal(picks.length, 7, 'eight candidate plies, one of them a forced mate');
  for (const p of picks) {
    assert.ok(p.ply >= 8);
    assert.equal(p.fen.split(' ')[1], p.colour, 'at the user’s move');
    assert.ok(Math.abs(p.evalWhite) < 10000);
  }
  assert.ok(picks.some(p => p.colour === 'w') && picks.some(p => p.colour === 'b'));
  assert.equal(new Set(picks.map(p => p.reviewId + p.ply)).size, 7, 'no repeats');
  assert.deepEqual(pickPositions([], { Chess }), []);
});

test('state v5 adds assessment stats and the candidate-move counter', () => {
  const s = defaults();
  assert.equal(validate(s), null);
  const v4 = { ...migrate({ version: 1 }), version: 4 };
  delete v4.candidates;
  delete v4.calc.assess;
  delete v4.settings.candidates;
  const up = migrate(v4);
  assert.equal(up.version, CURRENT_VERSION);
  assert.equal(up.settings.candidates, false);
  assert.deepEqual(up.candidates, { asked: 0, hit: 0, last: [] });
  logCandidates(up, true, '2026-10-08');
  logCandidates(up, false, '2026-10-08');
  assert.equal(up.candidates.asked, 2);
  assert.equal(up.candidates.hit, 1);
  assert.equal(validate(up), null);
});

test('quiet moves make a Strategy theme and the strategy lessons are in the path', () => {
  assert.ok(THEMES.includes('Strategy'));
  assert.equal(primaryTheme(['quietMove', 'endgame', 'rookEndgame']), 'Strategy');
  assert.equal(primaryTheme(['zugzwang', 'middlegame']), 'Strategy');
  assert.equal(primaryTheme(['mateIn2', 'quietMove']), 'King safety');
  assert.equal(STRATEGY_LESSONS.length, 8);
  for (const l of STRATEGY_LESSONS) assert.ok(lessons.includes(l));
});
