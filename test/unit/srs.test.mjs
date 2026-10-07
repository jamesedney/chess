import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schedule, choosePuzzle, isDue, themeStats, DAY, RETRY_MS } from '../../src/srs.js';
import { expectedScore, kFactor, updateRating, pushHistory, weakestTheme } from '../../src/rating.js';

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

const puzzle = (id, rating, theme = 'Tactics') => ({ id, rating, theme });
const pool = [
  puzzle('a', 800),
  puzzle('b', 1000),
  puzzle('c', 1600),
  puzzle('d', 1010, 'Endgames'),
  { id: 'm1', theme: 'Personal mistakes' },
];
const fixed = () => 0;

test('due personal mistakes come first', () => {
  const records = { b: { tries: 1, due: NOW - 5, box: 0 }, m1: { tries: 1, due: NOW - 1, box: 0 } };
  assert.equal(choosePuzzle({ puzzles: pool, records, target: 1000, now: NOW, rng: fixed }).id, 'm1');
});

test('new mistakes come before new puzzles some of the time', () => {
  assert.equal(choosePuzzle({ puzzles: pool, records: {}, target: 1000, now: NOW, rng: () => 0.1 }).id, 'm1');
  assert.notEqual(choosePuzzle({ puzzles: pool, records: {}, target: 1000, now: NOW, rng: () => 0.9 }).id, 'm1');
});

test('new puzzles are picked near the target rating', () => {
  const records = { m1: { tries: 1, due: NOW + DAY, box: 1 } };
  const picked = choosePuzzle({ puzzles: pool, records, target: 1550, now: NOW, rng: fixed });
  assert.equal(picked.id, 'c');
});

test('the weakest theme is favoured', () => {
  const records = { m1: { tries: 1, due: NOW + DAY, box: 1 } };
  const picked = choosePuzzle({ puzzles: pool, records, target: 1000, weakTheme: 'Endgames', now: NOW, rng: () => 0.2 });
  assert.equal(picked.id, 'd');
});

test('mistake mode, seen list and archived positions', () => {
  assert.equal(choosePuzzle({ puzzles: pool, records: {}, mode: 'mistakes', now: NOW }).id, 'm1');
  assert.equal(choosePuzzle({ puzzles: [{ ...pool[4], archived: true }], records: {}, mode: 'mistakes', now: NOW }), null);
  const picked = choosePuzzle({ puzzles: pool.slice(0, 2), records: {}, seen: ['b'], target: 1000, now: NOW, rng: fixed });
  assert.equal(picked.id, 'a');
});

test('theme recall counts attempted positions only', () => {
  const stats = themeStats(pool, { a: { tries: 1, clean: 1, box: 3 }, b: { tries: 1, clean: 0, box: 0 } });
  assert.equal(stats.Tactics.attempted, 2);
  assert.equal(stats.Tactics.recall, 50);
  assert.equal(stats.Endgames.recall, 0);
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

test('weakest theme needs enough attempts', () => {
  assert.equal(weakestTheme({ Tactics: { rating: 900, count: 2 }, Endgames: { rating: 1100, count: 5 } }), 'Endgames');
  assert.equal(weakestTheme({}), null);
});
