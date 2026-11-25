import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schedule, nextPosition, ownCounts, isDue, DAY, RETRY_MS } from '../../src/srs.js';
import { expectedScore, kFactor, updateRating, pushHistory } from '../../src/rating.js';

const NOW = Date.UTC(2026, 9, 7, 12);

test('clean solves climb the boxes only when due', () => {
  let r = schedule(undefined, true, NOW);
  assert.deepEqual([r.tries, r.clean, r.box, r.due], [1, 1, 1, NOW + DAY]);
  const early = schedule(r, true, NOW + 1000);
  assert.equal(early.box, 1, 'extra practice before due keeps the box');
  assert.equal(early.due, r.due);
  r = schedule(r, true, r.due);
  assert.equal(r.box, 2);
  assert.equal(r.due, NOW + DAY + 3 * DAY);
});

test('errors and hints reset to a ten-minute retry', () => {
  const r = schedule({ tries: 3, clean: 3, box: 3, due: NOW - 1, last: 0 }, false, NOW);
  assert.equal(r.box, 0);
  assert.equal(r.due, NOW + RETRY_MS);
  assert.ok(isDue(r, NOW + RETRY_MS));
});

const puzzles = [
  { id: 'a', rating: 800 },
  { id: 'b', rating: 1000 },
  { id: 'c', rating: 1600 },
  { id: 'd', rating: 1040 },
];
const mistakes = [{ id: 'm2' }, { id: 'm1' }, { id: 'm0', archived: true }];
const first = () => 0;
const pick = (extra = {}) => nextPosition({ mistakes, puzzles, records: {}, rating: 1000, now: NOW, rng: first, ...extra });

test('two of every three positions come from your own games while any are waiting, newest first', () => {
  assert.deepEqual(pick({ turn: 0 }), { position: mistakes[0], own: true });
  assert.equal(pick({ turn: 1, seen: ['m2'] }).position.id, 'm1');
  assert.deepEqual(pick({ turn: 2 }), { position: puzzles[1], own: false });
  assert.equal(pick({ turn: 3 }).own, true);
  // A position set aside is never served; with none of yours left, puzzles fill every turn.
  assert.equal(pick({ turn: 0, seen: ['m2', 'm1'] }).position.id, 'b');
  assert.equal(pick({ mistakes: [], turn: 0 }).own, false);
  // On a puzzle turn with no puzzle left to serve, one of yours is served instead.
  assert.equal(pick({ puzzles: [], turn: 2 }).position.id, 'm2');
  assert.equal(pick({ puzzles: [], mistakes: [] }), null);
});

test('a position of yours due again comes before one never tried', () => {
  const records = {
    m1: { tries: 1, clean: 0, box: 0, due: NOW - 5, last: 0 },
    m2: { tries: 1, clean: 1, box: 1, due: NOW + DAY, last: 0 },
  };
  assert.equal(pick({ records }).position.id, 'm1');
  // Solved and not yet due: nothing of yours is waiting, so a puzzle is served.
  const done = { ...records, m1: { tries: 2, clean: 1, box: 1, due: NOW + DAY, last: 0 } };
  assert.equal(pick({ records: done }).own, false);
  assert.deepEqual(ownCounts(mistakes, records, NOW), { waiting: 1, solved: 1 });
  assert.deepEqual(ownCounts(mistakes, {}, NOW), { waiting: 2, solved: 0 });
});

test('puzzles: one due again first, else a new one near your rating, else the one seen longest ago', () => {
  const solo = (extra = {}) => pick({ mistakes: [], ...extra });
  assert.equal(solo().position.id, 'b', 'within 75 of 1000');
  assert.equal(solo({ rng: () => 0.99 }).position.id, 'd', 'the band is drawn from at random');
  assert.equal(solo({ rating: 1500 }).position.id, 'c');
  assert.equal(solo({ seen: ['b', 'd'] }).position.id, 'a', 'the band widens when the near ones were just seen');
  const tried = (due, last) => ({ tries: 1, clean: 1, box: 1, due, last });
  assert.equal(solo({ records: { c: tried(NOW - 1, 0) } }).position.id, 'c', 'due again');
  const all = { a: tried(NOW + DAY, 30), b: tried(NOW + DAY, 10), c: tried(NOW + DAY, 20), d: tried(NOW + DAY, 40) };
  assert.equal(solo({ records: all }).position.id, 'b', 'every puzzle tried and none due');
});

test('rating updates follow the Elo expectation', () => {
  assert.equal(expectedScore(1000, 1000), 0.5);
  const win = updateRating(1000, 0, 1000, 1);
  const loss = updateRating(1000, 0, 1000, 0);
  assert.equal(win.delta, 30);
  assert.equal(loss.delta, -30);
  assert.ok(kFactor(5) > kFactor(50) && kFactor(50) > kFactor(500));
  assert.ok(updateRating(1000, 50, 1400, 1).delta > updateRating(1000, 50, 800, 1).delta, 'beating a harder puzzle earns more');
});

test('rating history keeps one entry per day', () => {
  let h = pushHistory([], '2026-10-06', 1000);
  h = pushHistory(h, '2026-10-07', 1010);
  h = pushHistory(h, '2026-10-07', 1030);
  assert.deepEqual(h, [
    { date: '2026-10-06', rating: 1000 },
    { date: '2026-10-07', rating: 1030 },
  ]);
});
