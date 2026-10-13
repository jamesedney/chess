import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONTROL,
  makeClock,
  startTurn,
  endTurn,
  timeLeft,
  flagged,
  userControl,
  controlText,
  clockText,
} from '../../src/gameclock.js';
import { replayCandidates, recordReplay } from '../../src/replay.js';
import { logGame, validate } from '../../src/state.js';
import { review, lostGame, row, stateWith, NOW, DAY } from './fixtures-v5.mjs';

const T0 = 1_000_000;
const sec = n => T0 + n * 1000;

test('makeClock starts with the full base time, stopped', () => {
  assert.deepEqual(makeClock({ base: 300, inc: 2 }), { base: 300, inc: 2, left: 300, running: false, at: null });
  assert.deepEqual(DEFAULT_CONTROL, { base: 300, inc: 0 });
  assert.equal(timeLeft(makeClock(DEFAULT_CONTROL), sec(999)), 300);
});

test('a turn charges the seconds spent and adds the increment: 300+2, 10 s spent → 292', () => {
  const c = makeClock({ base: 300, inc: 2 });
  assert.equal(startTurn(c, sec(0)), c);
  assert.equal(c.running, true);
  assert.equal(c.at, sec(0));
  assert.equal(timeLeft(c, sec(4)), 296);
  assert.equal(endTurn(c, sec(10)), 10);
  assert.equal(c.left, 292);
  assert.equal(c.running, false);
  assert.equal(c.at, null);
  assert.equal(timeLeft(c, sec(60)), 292);
});

test('no time is lost while the opponent thinks: two turns 30 s apart with one 5 s turn → 295', () => {
  const c = makeClock({ base: 300, inc: 0 });
  startTurn(c, sec(0));
  endTurn(c, sec(0));
  // The opponent thinks for 25 s; the clock is stopped.
  assert.equal(timeLeft(c, sec(25)), 300);
  startTurn(c, sec(25));
  assert.equal(endTurn(c, sec(30)), 5);
  assert.equal(c.left, 295);
});

test('startTurn on a running clock keeps its start; endTurn on a stopped clock spends nothing', () => {
  const c = makeClock({ base: 300, inc: 2 });
  startTurn(c, sec(0));
  startTurn(c, sec(3));
  assert.equal(c.at, sec(0));
  assert.equal(endTurn(c, sec(5)), 5);
  assert.equal(c.left, 297);
  assert.equal(endTurn(c, sec(50)), 0);
  assert.equal(c.left, 297);
});

test('flagged at 0, one past, and not one short; timeLeft never negative', () => {
  const c = makeClock({ base: 10, inc: 0 });
  startTurn(c, sec(0));
  assert.equal(flagged(c, sec(9)), false);
  assert.equal(timeLeft(c, sec(9)), 1);
  assert.equal(flagged(c, sec(10)), true);
  assert.equal(timeLeft(c, sec(10)), 0);
  assert.equal(flagged(c, sec(11)), true);
  assert.equal(timeLeft(c, sec(11)), 0);
  // Ending the turn past zero leaves zero, not a negative number.
  endTurn(c, sec(15));
  assert.equal(c.left, 0);
  assert.equal(timeLeft(c, sec(99)), 0);
  assert.equal(flagged(c, sec(99)), true);
  // A stopped clock with time left is not flagged whatever the hour.
  const d = makeClock({ base: 5, inc: 0 });
  assert.equal(flagged(d, sec(1000)), false);
});

test('the increment keeps a clock alive after a turn that used it up', () => {
  const c = makeClock({ base: 3, inc: 2 });
  startTurn(c, sec(0));
  assert.equal(endTurn(c, sec(3)), 3);
  assert.equal(c.left, 2);
  assert.equal(flagged(c, sec(3)), false);
});

test('userControl: the most played blitz control over 42 days, text like "3+2"', () => {
  const ledger = [
    ...Array.from({ length: 3 }, (_, i) => row({ t: NOW - i * DAY, base: 180, inc: 2 })),
    ...Array.from({ length: 2 }, (_, i) => row({ t: NOW - i * DAY, base: 300, inc: 0 })),
    // Rapid rows do not count, however many.
    ...Array.from({ length: 5 }, (_, i) => row({ t: NOW - i * DAY, tc: 'rapid', base: 600, inc: 0 })),
    // Bullet rows do not count either.
    ...Array.from({ length: 5 }, (_, i) => row({ t: NOW - i * DAY, tc: 'bullet', base: 60, inc: 0 })),
  ];
  assert.deepEqual(userControl(ledger, { now: NOW }), { base: 180, inc: 2, text: '3+2' });
});

test('userControl: rows older than the window are ignored, exactly at the edge count', () => {
  const ledger = [
    row({ t: NOW - 42 * DAY, base: 180, inc: 0 }),
    row({ t: NOW - 42 * DAY, base: 180, inc: 0 }),
    row({ t: NOW - 42 * DAY - 1, base: 180, inc: 0 }),
    row({ t: NOW - 42 * DAY - 1, base: 180, inc: 0 }),
    row({ t: NOW - 42 * DAY - 1, base: 180, inc: 0 }),
    row({ t: NOW, base: 300, inc: 3 }),
    row({ t: NOW, base: 300, inc: 3 }),
    row({ t: NOW, base: 300, inc: 3 }),
  ];
  assert.deepEqual(userControl(ledger, { now: NOW }), { base: 300, inc: 3, text: '5+3' });
  assert.deepEqual(userControl(ledger, { now: NOW, days: 60 }), { base: 180, inc: 0, text: '3+0' });
});

test('userControl: the fallback on an empty ledger, with no blitz rows, or without a known base', () => {
  assert.deepEqual(userControl([], { now: NOW }), { base: 300, inc: 0, text: '5+0' });
  assert.deepEqual(userControl([row({ t: NOW, tc: 'rapid', base: 600 })], { now: NOW }), { base: 300, inc: 0, text: '5+0' });
  assert.deepEqual(userControl([row({ t: NOW, base: null, inc: null })], { now: NOW }), { base: 300, inc: 0, text: '5+0' });
  assert.deepEqual(userControl([], { now: NOW, fallback: { base: 180, inc: 2 } }), { base: 180, inc: 2, text: '3+2' });
  // The fallback is a copy: nothing can change the default by mistake.
  const out = userControl([], { now: NOW });
  out.base = 1;
  assert.equal(DEFAULT_CONTROL.base, 300);
});

test('controlText and clockText', () => {
  assert.equal(controlText({ base: 300, inc: 0 }), '5+0');
  assert.equal(controlText({ base: 180, inc: 2 }), '3+2');
  assert.equal(controlText({ base: 90, inc: 1 }), '1.5+1');
  assert.equal(clockText(7), '0:07');
  assert.equal(clockText(41), '0:41');
  assert.equal(clockText(300), '5:00');
  assert.equal(clockText(0), '0:00');
  assert.equal(clockText(-3), '0:00');
});

/** Clocks for the ten-move fixture: White has 41 s before ply 8. */
const CLOCKS = [295, 296, 250, 280, 120, 270, 41, 260, 30, 255];

test('replay clock: the seconds you had before the mistake, with the increment', () => {
  const r = lostGame({ clocks: CLOCKS, tc: { base: 300, inc: 0 } });
  const [c] = replayCandidates(stateWith({ reviews: [r] }));
  assert.equal(c.ply, 8);
  assert.deepEqual(c.clock, { left: 41, inc: 0 });
  const withInc = lostGame({ clocks: CLOCKS, tc: { base: 180, inc: 2 } });
  assert.deepEqual(replayCandidates(stateWith({ reviews: [withInc] }))[0].clock, { left: 41, inc: 2 });
});

test('replay clock: left floors at 10', () => {
  const clocks = [...CLOCKS];
  clocks[6] = 4;
  const r = lostGame({ clocks, tc: { base: 300, inc: 0 } });
  assert.deepEqual(replayCandidates(stateWith({ reviews: [r] }))[0].clock, { left: 10, inc: 0 });
  clocks[6] = 10;
  assert.deepEqual(replayCandidates(stateWith({ reviews: [lostGame({ clocks, tc: { base: 300, inc: 0 } })] }))[0].clock, {
    left: 10,
    inc: 0,
  });
  clocks[6] = 11;
  assert.deepEqual(replayCandidates(stateWith({ reviews: [lostGame({ clocks, tc: { base: 300, inc: 0 } })] }))[0].clock, {
    left: 11,
    inc: 0,
  });
});

test('replay clock: a mistake on the first move starts from the base time', () => {
  // White, winning before ply 0 is impossible, so use a hold: worse before, lost after.
  const r = review({
    clocks: CLOCKS,
    tc: { base: 300, inc: 2 },
    evals: { 0: -100, 1: -450 },
    marks: [{ ply: 0, cls: 'blunder', loss: 35, bestSan: 'd4' }],
  });
  const [c] = replayCandidates(stateWith({ reviews: [r] }));
  assert.equal(c.ply, 0);
  assert.deepEqual(c.clock, { left: 300, inc: 2 });
});

test('replay clock without clocks: one minute for blitz, none for rapid', () => {
  // The fixture keeps tc only with clocks; a clockless review with a known control is set by hand.
  const clockless = tc => ({ ...lostGame(), tc });
  const clockOf = r => replayCandidates(stateWith({ reviews: [r] }))[0].clock;
  assert.deepEqual(clockOf(clockless({ base: 300, inc: 0 })), { left: 60, inc: 0 });
  // The increment is not used without clocks: a flat minute.
  assert.deepEqual(clockOf(clockless({ base: 180, inc: 2 })), { left: 60, inc: 0 });
  assert.equal(clockOf(clockless({ base: 301, inc: 0 })), null);
  assert.equal(clockOf(clockless({ base: 600, inc: 0 })), null);
  // No time control known at all: no clock.
  assert.equal(clockOf(lostGame()), null);
  assert.equal(clockOf({ ...lostGame(), tc: null }), null);
});

test('recordReplay stores flagged as a count across tries and the last time left', () => {
  const state = stateWith({ reviews: [lostGame({ clocks: CLOCKS, tc: { base: 300, inc: 0 } })] });
  const [c] = replayCandidates(state);
  // A plain try keeps the old record shape.
  assert.deepEqual(recordReplay(state, c.id, false, '2026-10-11'), { tries: 1, success: false, last: '2026-10-11' });
  assert.deepEqual(recordReplay(state, c.id, false, '2026-10-12', { flagged: true, left: 0 }), {
    tries: 2,
    success: false,
    last: '2026-10-12',
    flagged: 1,
    left: 0,
  });
  assert.deepEqual(recordReplay(state, c.id, true, '2026-10-13', { left: 17 }), {
    tries: 3,
    success: true,
    last: '2026-10-13',
    flagged: 1,
    left: 17,
  });
  // Another flag adds up; a try without a clock keeps the last time left.
  assert.deepEqual(recordReplay(state, c.id, false, '2026-10-14', { flagged: true, left: 0 }).flagged, 2);
  assert.equal(recordReplay(state, c.id, false, '2026-10-15').left, 0);
  assert.equal(state.replays[c.id].flagged, 2);
  assert.equal(replayCandidates(state)[0].record.flagged, 2);
  assert.equal(validate(state), null);
});

test('logGame stores tc, left, fl, b and f for a clocked game; validate accepts them and rejects fl: 2', () => {
  const state = stateWith();
  logGame(state, { level: 'maia1500', result: 0, date: '2026-10-13', clock: makeClock({ base: 300, inc: 0 }), left: 0, flagged: true });
  assert.deepEqual(state.games.at(-1), { d: '2026-10-13', level: 'maia1500', r: 0, tc: '300+0', left: 0, fl: 1, b: 0, f: 0 });
  logGame(state, {
    level: 'maia1500',
    result: 1,
    date: '2026-10-13',
    clock: makeClock({ base: 180, inc: 2 }),
    left: 41.4,
    blunders: 2,
    fast: 1,
  });
  assert.deepEqual(state.games.at(-1), { d: '2026-10-13', level: 'maia1500', r: 1, tc: '180+2', left: 41, fl: 0, b: 2, f: 1 });
  logGame(state, { level: 'maia1500', result: 0.5, date: '2026-10-13' });
  assert.deepEqual(state.games.at(-1), { d: '2026-10-13', level: 'maia1500', r: 0.5 });
  assert.equal(validate(state), null);
  state.games[0].fl = 2;
  assert.equal(validate(state), 'game');
});
