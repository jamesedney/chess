import test from 'node:test';
import assert from 'node:assert/strict';
import { NOW, DAY, review, lostGame, mistakeFor, row, stateWith } from './fixtures-v5.mjs';
import { pointsProfile, profileLines, trend, seriousErrors, adaptRule } from '../../src/profile.js';
import { tiltProfile, ruleLine } from '../../src/tilt.js';
import { diagnose, classifyLoss } from '../../src/leak.js';
import { planSession, STRETCH, PLAN_VERSION } from '../../src/program.js';

/** Clocks for a 10-ply game where your move at `ply` takes `spent` seconds (5+0). */
function clocksWith(ply, spent) {
  const clocks = [];
  let w = 300;
  let b = 300;
  for (let i = 0; i < 10; i++) {
    const t = i === ply ? spent : 10;
    if (i % 2 === 0) clocks.push((w -= t));
    else clocks.push((b -= t));
  }
  return clocks;
}

/** A lost game whose decisive move (5. Nxf7??) took `spent` seconds; linked to a ledger loss. */
function timedLoss(spent, { created = NOW - DAY, term = 'resign' } = {}) {
  const r = lostGame({ created, clocks: clocksWith(8, spent), tc: { base: 300, inc: 0 } });
  return { r, l: row({ k: r.gameKey, t: created, term }) };
}

/** Rows spread one per hour so each starts its own sitting (no tilt). */
const spaced = (n, start, make) => Array.from({ length: n }, (_, i) => row({ t: start - i * 3 * 3600000, ...make(i) }));

test('the profile reads every serious mistake: how many were fast and how many hung a piece', () => {
  const games = Array.from({ length: 10 }, (_, i) => timedLoss(i < 6 ? 1 : 20));
  const s = stateWith({ reviews: games.map(g => g.r), ledger: games.map(g => g.l) });
  const errors = seriousErrors(s, s.reviews);
  assert.equal(errors.length, 10);
  assert.equal(errors.filter(e => e.fast).length, 6);
  assert.ok(errors.every(e => e.hung));
  const p = pointsProfile(s, { now: NOW });
  assert.deepEqual(p.errors, { n: 10, timed: 10, fast: 6, hung: 10 });
  assert.equal(p.flags.fast, true);
  assert.equal(p.flags.hung, true);
  assert.equal(p.reviewedLosses, 10);
  const lines = profileLines(p).map(l => l.text);
  assert.ok(lines.includes('6 of 10 serious mistakes were played in under 4.5 seconds.'));
  assert.ok(lines.includes('10 of 10 serious mistakes left a piece or your king to be taken.'));
  // Under 8 mistakes is too few to flag anything.
  const few = stateWith({ reviews: games.slice(0, 5).map(g => g.r), ledger: games.map(g => g.l) });
  assert.equal(pointsProfile(few, { now: NOW }).flags.fast, false);
});

test('the profile flags late games in a sitting, a weak colour and poor repertoire recall, and leaves even ones alone', () => {
  const ledger = [];
  for (let s = 0; s < 12; s++) {
    const t0 = NOW - DAY - s * 6 * 3600000;
    // Games 1 to 3 of the sitting won, games 4 and 5 lost, a minute apart.
    for (let g = 0; g < 5; g++) ledger.push(row({ t: t0 + g * 6 * 60000, r: g < 3 ? 1 : 0, n: 80 }));
  }
  const black = Array.from({ length: 4 }, () => review({ colour: 'b', result: '1-0', created: NOW - DAY, evals: { 20: 150 } }));
  const log = Array.from({ length: 12 }, (_, i) => ({ d: '2026-10-12', k: 'o', t: 'b', c: i < 3 ? 1 : 0 }));
  const s = stateWith({ ledger, reviews: black, mistakes: [], log });
  const p = pointsProfile(s, { now: NOW });
  assert.deepEqual(p.early, { games: 36, score: 1 });
  assert.deepEqual(p.late, { games: 24, score: 0 });
  assert.equal(p.flags.late, true);
  assert.deepEqual(p.opening.b, { games: 4, avg: -150 });
  assert.equal(p.flags.opening, true);
  assert.deepEqual(p.recall, { n: 12, clean: 3 });
  assert.equal(p.flags.recall, true);
  // Every game is over 30 moves: no short games to compare, so no flag.
  assert.equal(p.flags.short, false);
  const lines = profileLines(p).map(l => l.text);
  assert.ok(lines.includes('You score 0% from the 4th game of a sitting on and 100% before it.'));
  // The play rule follows: 3 games, as your rule.
  const tilt = adaptRule(tiltProfile(ledger, { now: NOW }), p);
  assert.equal(tilt.rule.games, 3);
  assert.equal(tilt.rule.label, 'Your rule');
  assert.equal(ruleLine(tilt), 'Play rule: 3 games · stop after 2 losses in a row · 2 min between games');
  // Without the flag the rule is untouched.
  const plain = tiltProfile([], { now: NOW });
  assert.equal(adaptRule(plain, { flags: { late: false } }), plain);
  assert.ok(lines.includes('As Black you stand −1.5 at move 10 on average (4 games).'));
  assert.ok(lines.includes('You recalled 3 of 12 repertoire positions from memory.'));
});

test('is it moving: fast mistakes and games lost by move 30, the last two weeks against the two before', () => {
  const recent = Array.from({ length: 5 }, () => timedLoss(1, { created: NOW - 2 * DAY }));
  const older = Array.from({ length: 5 }, () => timedLoss(20, { created: NOW - 20 * DAY }));
  const ledger = [
    ...spaced(10, NOW - DAY, i => ({ r: i < 4 ? 0 : 1, n: i < 4 ? 40 : 80 })),
    ...spaced(10, NOW - 16 * DAY, () => ({ r: 1, n: 80 })),
  ];
  const s = stateWith({ reviews: [...recent, ...older].map(g => g.r), ledger });
  const t = trend(s, { now: NOW });
  assert.deepEqual(t.now.fast, { n: 5, k: 5 });
  assert.deepEqual(t.before.fast, { n: 5, k: 0 });
  assert.deepEqual(t.now.shortLosses, { n: 10, k: 4 });
  assert.deepEqual(t.before.shortLosses, { n: 10, k: 0 });
});

test('a loss on time is not a clock loss when the move that lost it was played with minutes left', () => {
  const plenty = timedLoss(20, { term: 'time' });
  const s = stateWith({ reviews: [plenty.r], ledger: [plenty.l] });
  // The decisive move hung a piece with four minutes left: safety, not the clock.
  assert.equal(classifyLoss(plenty.r, plenty.l, s).chess, 'safety');
  // Without a review, losing on time is all there is to go on.
  assert.equal(classifyLoss(null, plenty.l, s).chess, 'clock');
});

test('the everyday diagnosis reads 30 days of losses: chess leaks from reviewed losses only, time and tilt from all', () => {
  // Five reviewed losses, all to a hung piece played slowly, and ten unreviewed losses on time.
  const reviewed = Array.from({ length: 5 }, (_, i) => timedLoss(20, { created: NOW - (i + 1) * DAY }));
  const onTime = spaced(10, NOW - 6 * DAY, () => ({ term: 'time' }));
  const s = stateWith({ reviews: reviewed.map(g => g.r), ledger: [...reviewed.map(g => g.l), ...onTime] });
  let d = diagnose(s, { now: NOW });
  assert.equal(d.mode, 'window');
  assert.equal(d.lost, 15);
  assert.equal(d.reviewed, 5);
  assert.equal(d.counted, 5);
  assert.equal(d.counts.safety, 5);
  // Ten of fifteen losses on time is two thirds of every loss, but all five read losses hung a piece: safety leads.
  assert.equal(d.leak, 'safety');
  assert.equal(d.line, 'Last 30 days: 15 losses. Of the 5 read, 5 began with a piece hung in one move. Habit: ' + d.habit);
  // With only three reviewed, the reviewed losses cannot name a leak; ten of thirteen on time can.
  const fewer = stateWith({ reviews: reviewed.slice(0, 3).map(g => g.r), ledger: [...reviewed.slice(0, 3).map(g => g.l), ...onTime] });
  d = diagnose(fewer, { now: NOW });
  assert.equal(d.leak, 'clock');
  assert.equal(d.line.startsWith('Last 30 days: 13 losses. 10 of them began with the clock.'), true);
  // Losses older than 30 days are not read.
  const old = stateWith({ reviews: [], ledger: spaced(10, NOW - 40 * DAY, () => ({ term: 'time' })) });
  assert.equal(diagnose(old, { now: NOW }).lost, 0);
});

/** Wins spaced a day apart and ending now, so the newest games are not a streak and nothing stops tonight. */
const winsUntilNow = n => spaced(n, NOW - 3600000, () => ({ r: 1, n: 80 }));

test('a leak in the last 30 days rebuilds the day: its block first and required, Nemesis after it with the habit', () => {
  const games = Array.from({ length: 10 }, (_, i) => timedLoss(i < 6 ? 1 : 20, { created: NOW - (i + 1) * 2 * DAY }));
  const s = stateWith({ reviews: games.map(g => g.r), ledger: [...games.map(g => g.l), ...winsUntilNow(12)], minutes: 60 });
  for (const r of s.reviews) r.debriefed = true;
  const plan = planSession(s, { now: NOW, puzzles: s.mistakes });
  assert.equal(plan.plan, PLAN_VERSION);
  assert.equal(plan.streak.leak, 'rushed');
  const ids = plan.blocks.map(b => b.id);
  const leak = plan.blocks.find(b => b.id === 'leak');
  assert.equal(leak.optional, undefined);
  assert.match(plan.blocks.find(b => b.id === 'game').detail, /count three/);
  // Nemesis follows the leak block, carrying the habit; nothing from a curriculum.
  assert.ok(ids.indexOf('nemesis') > ids.indexOf('leak'));
  assert.match(plan.blocks.find(b => b.id === 'nemesis').params.objective, /count three/);
  assert.ok(!ids.includes('unit') && !ids.includes('lesson'));
  void STRETCH;
});

test('without a leak, fast and hung mistakes across your games make Safe or hanging? required and set the game objective', () => {
  // Wins with a fast hung piece in each: the profile sees them, the loss diagnosis does not.
  const reviews = Array.from({ length: 8 }, (_, i) => {
    const r = lostGame({ result: '1-0', created: NOW - (i + 1) * DAY, clocks: clocksWith(8, 1), tc: { base: 300, inc: 0 } });
    return r;
  });
  const s = stateWith({ reviews, ledger: winsUntilNow(12), minutes: 60 });
  for (const r of s.reviews) r.debriefed = true;
  const plan = planSession(s, { now: NOW, puzzles: s.mistakes });
  assert.equal(plan.streak, null);
  const ids = plan.blocks.map(b => b.id);
  const warm = plan.blocks.find(b => b.id === 'warmup');
  assert.match(warm.detail, /count three/);
  if (warm.type === 'safe') assert.equal(warm.optional, false);
  assert.match(plan.blocks.find(b => b.id === 'game').detail, /count three/);
  // Weak-skill puzzles aim above the skill's rating.
  const weak = plan.blocks.find(b => b.id === 'weak');
  if (weak) assert.ok(weak.params.rating >= s.puzzle.rating + STRETCH - 1);
  assert.ok(ids.includes('nemesis'));
});
