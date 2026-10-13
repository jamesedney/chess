import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIN_POSITIONS, DEFAULT_SECONDS, pressurePositions, recordRealRun, pressureStats, promptFor } from '../../src/pressure.js';
import { CLOCK_DRILLS } from '../../src/timeprofile.js';
import { emptyDrillStats } from '../../src/state.js';
import { lostGame, mistakeFor, stateWith, NOW, DAY, FEN_BEFORE_NXF7 } from './fixtures-v5.mjs';

const TC = { base: 180, inc: 0 };
/** Ten plies of 3+0 with White's clock at `left` before the ply-8 blunder and `left - spent` after it. */
const clocksWith = (left, spent = 2) => [178, 179, 176, 178, 170, 177, left, 176, left - spent, 175];
/** The classic lost game with 41 s before 5. Nxf7??, played in 2 s. */
const clocked = (opts = {}) => lostGame({ tc: TC, clocks: clocksWith(41), ...opts });
const ids = items => items.map(i => i.id);

test('constants and the Same clock drill entry', () => {
  assert.equal(MIN_POSITIONS, 6);
  assert.equal(DEFAULT_SECONDS, 15);
  assert.deepEqual(CLOCK_DRILLS.real, { title: 'Same clock', detail: 'Your own positions, with the seconds you actually had.' });
});

test('a clocked blunder: the seconds you had, the time you took, rushed, lost', () => {
  const r = clocked();
  const [item, ...rest] = pressurePositions(stateWith({ reviews: [r] }), { now: NOW });
  assert.equal(rest.length, 0);
  assert.deepEqual(item, {
    id: 'm' + r.id.slice(1),
    fen: FEN_BEFORE_NXF7,
    seconds: 41,
    spent: 2,
    left: 41,
    played: 'Nxf7',
    reviewId: r.id,
    ply: 8,
    lost: true,
    rushed: true,
    trouble: false,
    hasClock: true,
    first: true,
  });
});

test('seconds are the rounded clock, clamped to 5 and 60', () => {
  const secondsFor = left => pressurePositions(stateWith({ reviews: [clocked({ clocks: clocksWith(left) })] }), { now: NOW })[0].seconds;
  assert.equal(secondsFor(3), 5);
  assert.equal(secondsFor(4.4), 5);
  assert.equal(secondsFor(5), 5);
  assert.equal(secondsFor(6), 6);
  assert.equal(secondsFor(40.6), 41);
  assert.equal(secondsFor(59), 59);
  assert.equal(secondsFor(60), 60);
  assert.equal(secondsFor(61), 60);
  assert.equal(secondsFor(170), 60);
});

test('a clockless position gets the default seconds and comes last', () => {
  const plain = lostGame({ created: NOW });
  const timed = clocked({ created: NOW - DAY });
  const items = pressurePositions(stateWith({ reviews: [plain, timed] }), { now: NOW });
  assert.deepEqual(ids(items), [mistakeFor(timed).id, mistakeFor(plain).id]);
  const last = items[1];
  assert.equal(last.seconds, DEFAULT_SECONDS);
  assert.equal(last.hasClock, false);
  assert.equal(last.spent, null);
  assert.equal(last.left, null);
  assert.equal(last.rushed, false);
  assert.equal(last.trouble, false);
  assert.equal(last.lost, true);
});

test('time trouble is read from the clock before the move', () => {
  // 15 s left, 10 s spent: not rushed, but in trouble (under 20 s at 3+0).
  const r = clocked({ clocks: clocksWith(15, 10) });
  const [item] = pressurePositions(stateWith({ reviews: [r] }), { now: NOW });
  assert.equal(item.rushed, false);
  assert.equal(item.trouble, true);
  assert.equal(item.seconds, 15);
  assert.equal(item.spent, 10);
});

test('never attempted positions come first, whatever else', () => {
  const tried = clocked({ created: NOW });
  const fresh = lostGame({ created: NOW - 10 * DAY });
  const state = stateWith({ reviews: [tried, fresh] });
  state.records[mistakeFor(tried).id] = { tries: 1 };
  const items = pressurePositions(state, { now: NOW });
  assert.deepEqual(ids(items), [mistakeFor(fresh).id, mistakeFor(tried).id]);
  assert.equal(items[0].first, true);
  assert.equal(items[1].first, false);
  // A record with no tries yet still counts as never attempted.
  state.records[mistakeFor(tried).id] = { tries: 0 };
  assert.equal(pressurePositions(state, { now: NOW })[0].id, mistakeFor(tried).id);
});

test('lost games come before won and drawn ones', () => {
  const won = clocked({ result: '1-0', created: NOW });
  const drawn = clocked({ result: '1/2-1/2', created: NOW - DAY });
  const lost = clocked({ result: '0-1', created: NOW - 2 * DAY });
  const items = pressurePositions(stateWith({ reviews: [won, drawn, lost] }), { now: NOW });
  assert.deepEqual(ids(items), [mistakeFor(lost).id, mistakeFor(won).id, mistakeFor(drawn).id]);
  assert.deepEqual(
    items.map(i => i.lost),
    [true, false, false],
  );
  // Lost as Black too.
  const black = clocked({ colour: 'b', result: '1-0' });
  assert.equal(pressurePositions(stateWith({ reviews: [black] }), { now: NOW })[0].lost, true);
});

test('with a clock before clockless, rushed or in trouble before calm, then the newest review', () => {
  const calm = clocked({ clocks: clocksWith(120, 60), created: NOW });
  const rushed = clocked({ clocks: clocksWith(41, 2), created: NOW - 3 * DAY });
  const trouble = clocked({ clocks: clocksWith(15, 10), created: NOW - 2 * DAY });
  const clockless = lostGame({ created: NOW + DAY });
  const items = pressurePositions(stateWith({ reviews: [clockless, calm, rushed, trouble] }), { now: NOW + DAY });
  assert.deepEqual(ids(items), [mistakeFor(trouble).id, mistakeFor(rushed).id, mistakeFor(calm).id, mistakeFor(clockless).id]);
  assert.equal(items[2].rushed, false);
  assert.equal(items[2].trouble, false);
});

test('skips archived, unsourced, cleared, old, incomplete and orphaned positions', () => {
  const base = () => stateWith({ reviews: [clocked()] });
  assert.equal(pressurePositions(base(), { now: NOW }).length, 1);

  let s = base();
  s.mistakes[0].archived = true;
  assert.equal(pressurePositions(s, { now: NOW }).length, 0);

  s = base();
  delete s.mistakes[0].source;
  assert.equal(pressurePositions(s, { now: NOW }).length, 0);

  s = base();
  s.mistakes[0].source = { reviewId: s.reviews[0].id };
  assert.equal(pressurePositions(s, { now: NOW }).length, 0);

  s = base();
  s.reviews[0].marks[0].cleared = true;
  assert.equal(pressurePositions(s, { now: NOW }).length, 0);

  s = base();
  s.reviews[0].marks = [];
  assert.equal(pressurePositions(s, { now: NOW }).length, 0);

  s = base();
  s.reviews[0].complete = false;
  assert.equal(pressurePositions(s, { now: NOW }).length, 0);

  s = base();
  s.reviews = [];
  assert.equal(pressurePositions(s, { now: NOW }).length, 0);

  // Exactly 60 days old is still in; one millisecond older is out.
  s = stateWith({ reviews: [clocked({ created: NOW - 60 * DAY })] });
  assert.equal(pressurePositions(s, { now: NOW }).length, 1);
  s = stateWith({ reviews: [clocked({ created: NOW - 60 * DAY - 1 })] });
  assert.equal(pressurePositions(s, { now: NOW }).length, 0);
  assert.equal(pressurePositions(s, { now: NOW, days: 61 }).length, 1);
});

test('limit, the default limit and empty data', () => {
  const reviews = Array.from({ length: 8 }, (_, i) => clocked({ created: NOW - i * DAY }));
  const state = stateWith({ reviews });
  assert.equal(pressurePositions(state, { now: NOW }).length, 6);
  assert.equal(pressurePositions(state, { now: NOW, limit: 3 }).length, 3);
  assert.equal(pressurePositions(state, { now: NOW, limit: 20 }).length, 8);
  assert.deepEqual(pressurePositions(stateWith({}), { now: NOW }), []);
  assert.deepEqual(pressurePositions(stateWith({ reviews: [clocked()], mistakes: [] }), { now: NOW }), []);
});

test('the prompt names the clock, the move and the time taken', () => {
  const [item] = pressurePositions(stateWith({ reviews: [clocked()] }), { now: NOW });
  assert.equal(promptFor(item), 'You had 0:41 here and played Nxf7 in 2 s. Find the better move.');
  assert.equal(promptFor({ ...item, played: 'Rxe5' }), 'You had 0:41 here and played Rxe5 in 2 s. Find the better move.');
  assert.equal(promptFor({ ...item, left: 125, spent: 0.4 }), 'You had 2:05 here and played Nxf7 in 0.4 s. Find the better move.');
  assert.equal(promptFor({ ...item, spent: 12.6 }), 'You had 0:41 here and played Nxf7 in 13 s. Find the better move.');
  assert.equal(promptFor({ ...item, played: undefined }), 'You had 0:41 here and moved in 2 s. Find the better move.');
  const [plain] = pressurePositions(stateWith({ reviews: [lostGame()] }), { now: NOW });
  assert.equal(promptFor(plain), 'No clock data for this game: 15 seconds. Find the better move.');
});

test('recordRealRun keeps the last 50 runs and the best rate', () => {
  const state = stateWith({});
  assert.deepEqual(state.calc.real, emptyDrillStats());
  recordRealRun(state, { n: 6, inTime: 4, first: 3, firstInTime: 1 }, '2026-10-01');
  assert.deepEqual(state.calc.real, { best: 67, runs: 1, last: [{ d: '2026-10-01', n: 6, inTime: 4, first: 3, firstInTime: 1 }] });
  recordRealRun(state, { n: 6, inTime: 3, first: 0, firstInTime: 0 }, '2026-10-02');
  assert.equal(state.calc.real.best, 67);
  assert.equal(state.calc.real.runs, 2);
  recordRealRun(state, { n: 6, inTime: 6, first: 0, firstInTime: 0 }, '2026-10-03');
  assert.equal(state.calc.real.best, 100);
  // An empty run neither divides by zero nor lowers the best.
  recordRealRun(state, { n: 0, inTime: 0, first: 0, firstInTime: 0 }, '2026-10-04');
  assert.equal(state.calc.real.best, 100);
  assert.equal(state.calc.real.runs, 4);
  // The date defaults to today.
  recordRealRun(state, { n: 1, inTime: 1, first: 1, firstInTime: 1 });
  assert.match(state.calc.real.last.at(-1).d, /^\d{4}-\d{2}-\d{2}$/);
  for (let i = 0; i < 60; i++) recordRealRun(state, { n: 6, inTime: i % 7, first: 0, firstInTime: 0 }, '2026-11-01');
  assert.equal(state.calc.real.last.length, 50);
  assert.equal(state.calc.real.runs, 65);
  assert.equal(state.calc.real.last.at(-1).inTime, 59 % 7);
});

test('pressureStats: overall and first-attempt rates, and the first week', () => {
  const state = stateWith({});
  assert.deepEqual(pressureStats(state), {
    tries: 0,
    inTime: 0,
    rate: 0,
    first: { tries: 0, inTime: 0, rate: 0 },
    firstWeek: { tries: 0, inTime: 0 },
  });
  // Runs out of date order: the earliest is found, not assumed first.
  recordRealRun(state, { n: 6, inTime: 5, first: 2, firstInTime: 2 }, '2026-10-07'); // day 6: still the first week
  recordRealRun(state, { n: 6, inTime: 2, first: 6, firstInTime: 1 }, '2026-10-01'); // the earliest
  recordRealRun(state, { n: 2, inTime: 2, first: 2, firstInTime: 1 }, '2026-10-08'); // day 7: after the first week
  const s = pressureStats(state);
  assert.equal(s.tries, 14);
  assert.equal(s.inTime, 9);
  assert.equal(s.rate, 64);
  assert.deepEqual(s.first, { tries: 10, inTime: 4, rate: 40 });
  assert.deepEqual(s.firstWeek, { tries: 12, inTime: 7 });
});

test('MIN_POSITIONS: the drill needs six positions', () => {
  const five = stateWith({ reviews: Array.from({ length: 5 }, () => clocked()) });
  const six = stateWith({ reviews: Array.from({ length: 6 }, () => clocked()) });
  assert.ok(pressurePositions(five, { now: NOW, limit: 100 }).length < MIN_POSITIONS);
  assert.ok(pressurePositions(six, { now: NOW, limit: 100 }).length >= MIN_POSITIONS);
});
