import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../../src/app-context.js';
import { defaults, validate } from '../../src/state.js';
import { createMistake, trimMistakes, deleteMistake } from '../../src/mistakes.js';
import { applyDeepResult, nextPending } from '../../src/deep.js';
import { mainRating, trend } from '../../src/ratings.js';

// After 1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5: Black to move; Na5 is the book move, Nxd5 the mistake.
const FEN = 'r1bqkb1r/ppp2ppp/2n2n2/3Pp1N1/2B5/8/PPPP1PPP/RNBQK2R b KQkq - 0 5';
const line = (uci, score = 0, mate = null) => ({ best: uci, pv: [uci], score, mate });

test('a missed move becomes a position: the better move, the move you played, and where it came from', () => {
  app.state = defaults();
  const game = { opp: 'rival', date: '2026-10-08' };
  const saved = createMistake({ fen: FEN, played: 'Nxd5', before: line('c6a5', 0), after: line('g5f7', 250), loss: 31.6, game });
  assert.equal(saved.created, true);
  const m = saved.mistake;
  assert.deepEqual([m.fen, m.line, m.played, m.loss, m.game], [FEN, ['c6a5'], 'Nxd5', 32, game]);
  assert.match(m.id, /^m[a-z0-9]+$/);
  assert.match(m.explanation, /Nxd5/);
  assert.equal(validate(app.state), null, 'what it saves loads again');
  // The same position again is not saved twice; one a deeper look set aside stays set aside.
  m.archived = true;
  const again = createMistake({ fen: FEN, played: 'Nxd5', before: line('c6a5'), after: line('g5f7', 250), loss: 30 });
  assert.equal(again.created, false);
  assert.equal(again.mistake, m);
  assert.equal(m.archived, true);
  assert.equal(app.state.mistakes.length, 1);
  // No engine line, or a line that is not playable: nothing to train.
  assert.equal(createMistake({ fen: FEN, played: 'Nxd5', before: { best: null, pv: [] }, after: null, loss: 30 }), null);
  assert.equal(createMistake({ fen: FEN.replace(' b ', ' w '), played: 'h3', before: line('c6a5'), after: null, loss: 30 }), null);
  deleteMistake(m.id);
  assert.equal(app.state.mistakes.length, 0);
});

test('a short forced mate is saved to the end; anything else asks for the first move only', () => {
  app.state = defaults();
  const fen = '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1';
  const m = createMistake({
    fen,
    played: 'h3',
    before: { best: 'e1e8', pv: ['e1e8'], score: 0, mate: 1 },
    after: line('g8f8'),
    loss: 60,
  }).mistake;
  assert.deepEqual(m.line, ['e1e8']);
  assert.equal(m.mate, 1);
});

test('past the limit, set-aside positions go first, then the oldest, with their records', () => {
  const state = defaults();
  state.mistakes = ['m5', 'm4', 'm3', 'm2', 'm1'].map(id => ({ id }));
  state.mistakes[1].archived = true;
  state.records = { m4: { tries: 1 }, m1: { tries: 1 }, m5: { tries: 1 } };
  trimMistakes(state, 3);
  assert.deepEqual(
    state.mistakes.map(m => m.id),
    ['m5', 'm3', 'm2'],
  );
  assert.deepEqual(Object.keys(state.records), ['m5']);
});

test('a deeper look drops a position when your move was fine, and corrects the answer of one not yet tried', () => {
  const fresh = () => ({ id: 'm1', fen: FEN, line: ['c6a5'], played: 'Nxd5', explanation: 'old', loss: 30 });
  // The deep search prefers the move you played: cleared.
  let m = fresh();
  assert.equal(applyDeepResult({ mistake: m, record: undefined, before: line('f6d5', 0), after: line('d2d4', 0) }), 'cleared');
  assert.equal(m.archived, true);
  assert.equal(m.deep, true);
  // The loss turns out small: cleared too.
  m = fresh();
  assert.equal(applyDeepResult({ mistake: m, record: undefined, before: line('c6a5', 10), after: line('d2d4', 5) }), 'cleared');
  // A different better move: the answer and its explanation change, when you have not worked on it yet.
  m = fresh();
  assert.equal(applyDeepResult({ mistake: m, record: undefined, before: line('c6d4', 20), after: line('g5f7', 300) }), 'corrected');
  assert.deepEqual(m.line, ['c6d4']);
  assert.notEqual(m.explanation, 'old');
  assert.notEqual(m.loss, 30, 'the loss is measured again');
  // A position you have tried keeps the answer you were taught.
  m = fresh();
  assert.equal(applyDeepResult({ mistake: m, record: { tries: 2 }, before: line('c6d4', 20), after: line('g5f7', 300) }), 'confirmed');
  assert.deepEqual(m.line, ['c6a5']);
  // Same answer: confirmed.
  m = fresh();
  assert.equal(applyDeepResult({ mistake: m, record: undefined, before: line('c6a5', 20), after: line('g5f7', 300) }), 'confirmed');
  // Checked positions, set-aside ones and ones with no played move are not looked at again.
  assert.equal(
    nextPending([
      { id: 'a', deep: true, played: 'x' },
      { id: 'b', archived: true, played: 'x' },
      { id: 'c', played: '' },
    ]),
    null,
  );
  assert.equal(
    nextPending([
      { id: 'a', deep: true, played: 'x' },
      { id: 'b', played: 'Nf3' },
    ]).id,
    'b',
  );
});

test('the rating followed is the one with the most history; its trend is measured over 30 days', () => {
  const day = n => new Date(Date.UTC(2026, 9, 31) - n * 86400000).toISOString().slice(0, 10);
  const today = new Date(Date.UTC(2026, 9, 31, 12));
  const ratings = [
    { platform: 'Chess.com blitz', date: day(45), rating: 1200 },
    { platform: 'Chess.com blitz', date: day(31), rating: 1210 },
    { platform: 'Chess.com blitz', date: day(10), rating: 1190 },
    { platform: 'Chess.com blitz', date: day(0), rating: 1254 },
    { platform: 'Lichess rapid', date: day(0), rating: 1500 },
  ];
  const state = { ratings, sync: { followed: ['Lichess rapid', 'Chess.com blitz'] } };
  const main = mainRating(state);
  assert.equal(main.perf, 'Chess.com blitz');
  assert.equal(main.rating, 1254);
  assert.deepEqual(trend(main.series, 30, today), { from: day(31), change: 44 });
  // Less than 30 days of history: against the oldest there is.
  assert.deepEqual(trend(main.series.slice(2), 30, today), { from: day(10), change: 64 });
  assert.equal(trend(main.series.slice(3), 30, today), null);
  // Before any sync named a time control, whatever rating is known is followed.
  assert.equal(mainRating({ ratings, sync: {} }).perf, 'Chess.com blitz');
  assert.equal(mainRating({ ratings: [], sync: {} }), null);
});
