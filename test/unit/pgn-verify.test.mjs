import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitPgn, readHeaders, detectColour, loadGame, describeGame } from '../../src/pgn.js';
import { judgeAlternative } from '../../src/verify.js';
import { hangingPieces } from '../../src/chess-utils.js';
import { Chess } from '../../vendor/chess.js';
import { puzzles } from '../../data/puzzles.js';

const LICHESS = `[Event "Rated rapid game"]
[Site "https://lichess.org/abcd1234"]
[White "Alice"]
[Black "bob_99"]
[Result "0-1"]
[UTCDate "2026.10.01"]
[WhiteElo "1180"]
[BlackElo "1215"]

1. e4 { [%clk 0:10:00] } e5 { [%clk 0:10:00] } 2. Nf3 { [%clk 0:09:58] } Nc6 {
[%clk 0:09:55] } 0-1


[Event "Rated blitz game"]
[White "bob_99"]
[Black "Carol"]
[Result "1-0"]

1. d4 d5 2. c4 1-0
`;

test('multi-game PGN splits into games, even with clock comments at line starts', () => {
  const games = splitPgn('﻿' + LICHESS.replace(/\n/g, '\r\n'));
  assert.equal(games.length, 2);
  assert.equal(readHeaders(games[0]).White, 'Alice');
  assert.equal(readHeaders(games[1]).Black, 'Carol');
  assert.deepEqual(splitPgn('1. e4 e5 *'), ['1. e4 e5 *']);
  assert.deepEqual(splitPgn('   '), []);
});

test('colour detection is case-insensitive', () => {
  const [a, b] = splitPgn(LICHESS);
  assert.equal(detectColour(a, ['BOB_99']), 'b');
  assert.equal(detectColour(b, ['bob_99']), 'w');
  assert.equal(detectColour(a, ['nobody']), null);
  assert.equal(detectColour(a, []), null);
});

test('game summaries and friendly errors', () => {
  const d = describeGame(splitPgn(LICHESS)[0]);
  assert.equal(d.players, 'Alice (1180) – bob_99 (1215)');
  assert.equal(d.date, '2026-10-01');
  assert.throws(() => loadGame('1. e4 e9'), /Could not read that PGN/);
  assert.equal(loadGame(splitPgn(LICHESS)[0]).history().length, 4);
});

test('alternative solutions', () => {
  const before = { score: 500, mate: null };
  assert.equal(judgeAlternative({ before, after: { score: -480, mate: null } }).accepted, true);
  const weaker = judgeAlternative({ before, after: { score: -180, mate: null } });
  assert.equal(weaker.accepted, false);
  assert.equal(weaker.reason, 'weaker');
  assert.equal(judgeAlternative({ before, after: { score: 300, mate: null } }).reason, 'mistake');
  // Mate puzzles: the alternative must keep a mate within the moves left.
  const mateBefore = { score: 99998, mate: 2 };
  assert.equal(
    judgeAlternative({ before: mateBefore, after: { score: -99999, mate: -1 }, mateExpected: true, remainingMoves: 1 }).accepted,
    true,
  );
  assert.equal(
    judgeAlternative({ before: mateBefore, after: { score: -99997, mate: -3 }, mateExpected: true, remainingMoves: 1 }).reason,
    'slower-mate',
  );
  assert.equal(
    judgeAlternative({ before: mateBefore, after: { score: -900, mate: null }, mateExpected: true, remainingMoves: 1 }).reason,
    'no-mate',
  );
  assert.equal(judgeAlternative({ before: null, after: null }).accepted, false);
});
