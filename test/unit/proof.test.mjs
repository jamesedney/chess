import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOW, DAY, review, lostGame, row, stateWith } from './fixtures-v5.mjs';
import {
  criticalMoves,
  habitIn,
  habitTrend,
  judge,
  advanceExperiment,
  currentExperiment,
  experimentLine,
  PHASE_DAYS,
  MIN_GAMES,
} from '../../src/proof.js';

/** 5+0 clocks for a 10-ply game where White spends `w` seconds on each move and Black 10. */
function clocks(w) {
  const out = [];
  let a = 300;
  let b = 300;
  for (let i = 0; i < 10; i++) {
    if (i % 2 === 0) out.push((a -= w));
    else out.push((b -= 10));
  }
  return out;
}

test('critical moves are your captures and checks, with the seconds each took and whether that was fast', () => {
  // MOVES: e4 e5 Nf3 Nc6 Bc4 Nd4 Nxe5 Qg5 Nxf7 Qxg2 — White's captures: Nxe5 (ply 6), Nxf7 (ply 8).
  const slow = review({ clocks: clocks(20), tc: { base: 300, inc: 0 } });
  assert.deepEqual(
    criticalMoves(slow).map(c => [c.ply, c.san, c.spent, c.fast]),
    [
      [6, 'Nxe5', 20, false],
      [8, 'Nxf7', 20, false],
    ],
  );
  const fast = review({ clocks: clocks(2), tc: { base: 300, inc: 0 } });
  assert.ok(criticalMoves(fast).every(c => c.fast));
  // Black's view counts Black's captures: Qxg2 at ply 9.
  const black = review({ colour: 'b', clocks: clocks(20), tc: { base: 300, inc: 0 } });
  assert.deepEqual(
    criticalMoves(black).map(c => c.san),
    ['Qxg2'],
  );
  assert.deepEqual(criticalMoves(review()), [], 'no clocks, nothing to read');
});

test('the habit in a window: fast critical moves and hung pieces a game, from the main control only', () => {
  const games = [
    lostGame({ created: NOW - DAY, clocks: clocks(2), tc: { base: 300, inc: 0 } }),
    lostGame({ created: NOW - 2 * DAY, clocks: clocks(20), tc: { base: 300, inc: 0 } }),
    lostGame({ created: NOW - 20 * DAY, clocks: clocks(2), tc: { base: 300, inc: 0 } }),
    lostGame({ created: NOW - DAY, clocks: clocks(2), tc: { base: 600, inc: 0 } }), // rapid: not the main control
  ];
  const s = stateWith({ reviews: games, ledger: [row({ t: NOW - DAY })] });
  const h = habitIn(s, NOW - 14 * DAY, Infinity, 'blitz');
  assert.equal(h.games, 2);
  assert.deepEqual(h.critical, { n: 4, fast: 2 });
  assert.deepEqual(h.hung, { n: 2, perGame: 1 });
  const t = habitTrend(s, { now: NOW });
  assert.equal(t.control, 'blitz');
  assert.equal(t.now.games, 2);
  assert.equal(t.before.games, 1);
});

test('a verdict needs games in both phases; the gate is kept when fast moves or hung pieces fall enough', () => {
  const h = (games, fast, hung) => ({ games, critical: { n: 20, fast }, hung: { n: hung * games, perGame: hung } });
  assert.equal(judge(h(3, 2, 1), h(10, 10, 1)).keep, null);
  assert.equal(judge(h(10, 4, 1), h(10, 10, 1)).keep, true, 'fast moves 20% on against 50% off');
  assert.equal(judge(h(10, 10, 0.5), h(10, 10, 1)).keep, true, 'half a hung piece a game fewer');
  const same = judge(h(10, 10, 1), h(10, 10, 1));
  assert.equal(same.keep, false);
  assert.match(same.text, /made no difference/);
  assert.match(judge(h(10, 4, 1), h(10, 10, 1)).text, /20% with the gate on, 50% off/);
});

test('the experiment runs on for 14 days, off for 14, judges, and steps the gate down when it is kept', () => {
  const fastGames = (from, n) =>
    Array.from({ length: n }, (_, i) => lostGame({ created: from + i * DAY, clocks: clocks(2), tc: { base: 300, inc: 0 } }));
  const slowGames = (from, n) =>
    Array.from({ length: n }, (_, i) => lostGame({ created: from + i * DAY, clocks: clocks(20), tc: { base: 300, inc: 0 } }));
  const s = stateWith({ ledger: [row({ t: NOW })] });
  // Day 0: nothing running, the gate at its default: an experiment starts with the gate on.
  let e = advanceExperiment(s, NOW);
  assert.equal(e.phase, 'on');
  assert.equal(e.stage, 3);
  assert.equal(s.gate.set, 'proof');
  assert.equal(currentExperiment(s), e);
  assert.match(experimentLine(e, NOW + 2 * DAY), /^Gate on \(captures and checks\), day 3 of 14/);
  assert.equal(advanceExperiment(s, NOW + 5 * DAY), null, 'nothing to do mid-phase');
  // With the gate on you play slowly; day 14: the gate goes off.
  s.reviews.push(...slowGames(NOW + DAY, 9));
  e = advanceExperiment(s, NOW + PHASE_DAYS * DAY);
  assert.equal(e.phase, 'off');
  assert.equal(s.gate.stage, 0);
  assert.equal(e.on.games, 9);
  assert.match(experimentLine(e, NOW + PHASE_DAYS * DAY), /^Gate off, day 1 of 14/);
  // With it off you play fast again; day 28: the verdict keeps the gate and steps it down to captures only.
  s.reviews.push(...fastGames(NOW + (PHASE_DAYS + 1) * DAY, 9));
  e = advanceExperiment(s, NOW + 2 * PHASE_DAYS * DAY);
  assert.equal(e.phase, 'done');
  assert.equal(e.verdict.keep, true);
  assert.equal(s.gate.stage, 2);
  assert.equal(currentExperiment(s), null);
  // The next experiment starts at the new stage.
  const next = advanceExperiment(s, NOW + 2 * PHASE_DAYS * DAY + 1);
  assert.equal(next.stage, 2);
  assert.equal(s.experiments.length, 2);
  // A gate set by hand is left alone.
  const manual = stateWith({ gate: { stage: 3, set: 'you', since: null } });
  assert.equal(advanceExperiment(manual, NOW), null);
  assert.equal(MIN_GAMES, 8);
});

test('a dropped gate stays off; an inconclusive experiment runs again at the same stage', () => {
  const s = stateWith({ ledger: [row({ t: NOW })] });
  advanceExperiment(s, NOW);
  advanceExperiment(s, NOW + PHASE_DAYS * DAY);
  // No games with clocks in either phase: inconclusive, the stage stays.
  let e = advanceExperiment(s, NOW + 2 * PHASE_DAYS * DAY);
  assert.equal(e.verdict.keep, null);
  assert.equal(s.gate.stage, 3);
  // Same play on and off: dropped, off until turned on by hand.
  const same = (from, n) =>
    Array.from({ length: n }, (_, i) => lostGame({ created: from + i * DAY, clocks: clocks(2), tc: { base: 300, inc: 0 } }));
  const t0 = NOW + 2 * PHASE_DAYS * DAY + 1;
  advanceExperiment(s, t0);
  s.reviews.push(...same(t0 + DAY, 9));
  advanceExperiment(s, t0 + PHASE_DAYS * DAY);
  s.reviews.push(...same(t0 + (PHASE_DAYS + 1) * DAY, 9));
  e = advanceExperiment(s, t0 + 2 * PHASE_DAYS * DAY);
  assert.equal(e.verdict.keep, false);
  assert.equal(s.gate.stage, 0);
  assert.equal(advanceExperiment(s, t0 + 2 * PHASE_DAYS * DAY + 1), null, 'off: no new experiment on its own');
});
