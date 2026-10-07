import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseLine, explainLine, explainMistake } from '../../src/tagger.js';
import { hangingPieces } from '../../src/chess-utils.js';
import { Chess } from '../../vendor/chess.js';
import { primaryTheme, hintForTags, displayTags } from '../../src/themes.js';
import { estimateRating } from '../../src/difficulty.js';

test('knight fork', () => {
  const { tags } = analyseLine('3q3k/6pp/8/4N3/8/8/6PP/R5K1 w - - 0 1', ['e5f7', 'h8g8', 'f7d8']);
  assert.ok(tags.includes('fork'));
  assert.match(explainLine('3q3k/6pp/8/4N3/8/8/6PP/R5K1 w - - 0 1', ['e5f7', 'h8g8', 'f7d8']), /Nf7\+ forks the king and queen/);
});

test('back-rank mate', () => {
  const { tags } = analyseLine('6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1', ['e1e8']);
  assert.deepEqual(['mate', 'mateIn1', 'backRankMate'].filter(t => tags.includes(t)).length, 3);
  assert.equal(primaryTheme(tags), 'King safety');
});

test('smothered mate', () => {
  const { tags } = analyseLine('6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1', ['g5f7']);
  assert.ok(tags.includes('smotheredMate'), tags.join());
});

test('free piece', () => {
  const fen = '6k1/5ppp/8/8/3q4/8/3R1PPP/6K1 w - - 0 1';
  const { tags } = analyseLine(fen, ['d2d4']);
  assert.ok(tags.includes('hangingPiece'));
  assert.equal(primaryTheme(tags), 'Board vision');
  assert.deepEqual(
    hangingPieces(Chess, fen).map(h => h.square),
    ['d4'],
  );
});

test('defended pieces are not free', () => {
  // The pawn on d5 is defended by e6; taking it with the queen loses the queen.
  assert.deepEqual(hangingPieces(Chess, '4k3/8/4p3/3p4/8/8/3Q4/4K3 w - - 0 1'), []);
});

test('skewer', () => {
  const fen = '8/1q6/8/3k4/8/8/8/5BK1 w - - 0 1';
  const { tags } = analyseLine(fen, ['f1g2', 'd5d4', 'g2b7']);
  assert.ok(tags.includes('skewer'), tags.join());
  assert.match(explainLine(fen, ['f1g2', 'd5d4', 'g2b7']), /skewers the king/);
});

test('absolute pin', () => {
  // Bb5 pins the knight on c6 to the king on e8.
  const { tags } = analyseLine('r3k3/8/2n5/8/8/8/8/3BK3 w - - 0 1', ['d1a4']);
  assert.ok(tags.includes('pin'), tags.join());
});

test('discovered attack and double check', () => {
  // Moving the knight off the e-file uncovers the rook's check; Nf6 also checks.
  const { tags } = analyseLine('4k3/8/8/8/4N3/8/8/4R1K1 w - - 0 1', ['e4f6']);
  assert.ok(tags.includes('doubleCheck'), tags.join());
});

test('promotion and endgame phase', () => {
  const { tags } = analyseLine('7k/P7/6K1/8/8/8/8/8 w - - 0 1', ['a7a8q']);
  assert.ok(tags.includes('promotion') && tags.includes('endgame') && tags.includes('pawnEndgame'));
});

test('setup moves are applied before the solution', () => {
  // Black blunders the queen to d4; White takes it.
  const { tags, facts } = analyseLine('6k1/5ppp/8/8/8/3q4/3R1PPP/6K1 b - - 0 1', ['d2d4'], { setup: 'd3d4' });
  assert.equal(facts.solver, 'w');
  assert.ok(tags.includes('hangingPiece'));
});

test('mistake explanations', () => {
  const fen = 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2';
  // Black misses Qh4#.
  const missed = explainMistake({
    fen,
    played: 'Nc6',
    before: { mate: 1, pv: ['d8h4'], score: 99999 },
    after: { mate: null, score: 50, pv: [] },
  });
  assert.match(missed, /forced mate in 1 starting with Qh4#/);
  // White's last move allowed mate.
  const allowed = explainMistake({
    fen: 'rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2',
    played: 'g4',
    before: { mate: null, score: -30, pv: ['e2e4'] },
    after: { mate: 1, pv: ['d8h4'], score: 99999 },
  });
  assert.match(allowed, /allowed a forced mate in 1, starting with Qh4#/);
  // Leaving a piece en prise.
  const hung = explainMistake({
    fen: '4k3/8/8/8/8/2n5/8/R3K3 w - - 0 1',
    played: 'Ra5',
    before: { mate: null, score: 300, pv: ['a1a8'] },
    after: { mate: null, score: 200, pv: ['c3a4', 'e1d2', 'a4b6'] },
  });
  assert.ok(typeof hung === 'string' && hung.length > 10);
});

test('hints never name the move', () => {
  for (const tags of [['mateIn1'], ['fork'], ['hangingPiece'], []]) assert.doesNotMatch(hintForTags(tags), /[a-h][1-8]/);
  assert.deepEqual(displayTags(['middlegame', 'fork', 'advantage', 'short']), ['Fork']);
});

test('difficulty estimate orders easy and hard puzzles sensibly', () => {
  const easy = estimateRating({ tags: ['hangingPiece', 'oneMove'], line: ['a1a2'], firstSan: 'Rxa2' });
  const hard = estimateRating({ tags: ['quietMove', 'sacrifice', 'long'], line: ['a', 'b', 'c', 'd', 'e'], discovery: 9, legalMoves: 40 });
  assert.ok(easy < 900 && hard > 1600, `${easy} ${hard}`);
});
