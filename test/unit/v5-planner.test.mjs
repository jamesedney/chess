// The v5 planner, session rules, evidence rows and coach line: the streak
// branch (one leak), the stop line (reset block), Safe or hanging? as the
// warm-up, the clocked game and replay, and Same clock, better move.
// Local dates (dateKey) decide what "today" is; pin the zone so the fixtures mean the same everywhere.
process.env.TZ = 'UTC';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSession, baseline, blockDone, resetBlock, CLOCK_ROWS } from '../../src/program.js';
import { evidence, focus, MEASURES, MIN_GAMES } from '../../src/evidence.js';
import { diagnose } from '../../src/coach.js';
import { LEAKS, diagnoseStreak, streakMode } from '../../src/leak.js';
import { stopState, SITTING_MS, QUICK_MS } from '../../src/tilt.js';
import { MIN_POSITIONS } from '../../src/pressure.js';
import { CLOCK_DRILLS } from '../../src/timeprofile.js';
import { KINDS } from '../../src/mistake-kinds.js';
import { OBJECTIVES } from '../../data/skills.js';
import { review, lostGame, mistakeFor, row, stateWith, NOW, DAY } from './fixtures-v5.mjs';

const MIN = 60000;
const HOUR = 3600000;
const TC = { base: 300, inc: 0 };
/** 5+0: White's clocks fall by 5 s a move, so no move is rushed. */
const CLOCKS = [295, 295, 290, 290, 285, 285, 280, 280, 275, 275];
/** The same game with the clock before 5. Nxf7 (clocks[6]) and after it (clocks[8]) set by hand. */
const clocksWith = (before, after) => CLOCKS.map((c, i) => (i === 6 ? before : i === 8 ? after : c));
// An Italian where every White move from 4. d3 on leaves Black a capture or a check: a bank of safe items.
const TENSE_MOVES = [
  'e4',
  'e5',
  'Nf3',
  'Nc6',
  'Bc4',
  'Nf6',
  'd3',
  'Bc5',
  'c3',
  'd6',
  'Bb3',
  'a6',
  'Nbd2',
  'Ba7',
  'h3',
  'O-O',
  'O-O',
  'Ne7',
  'Re1',
  'Ng6',
  'Nf1',
  'Be6',
  'Bc2',
  'd5',
  'exd5',
  'Nxd5',
  'Ng3',
  'Qd7',
  'Qe2',
  'Rae8',
  'Be3',
  'Bxe3',
  'Qxe3',
  'Nxe3',
];
const flatEvals = moves => Object.fromEntries(moves.map((_, i) => [i, 0]).concat([[moves.length, 0]]));
/** A drawn game full of safe, tense moves. */
const safeGame = (opts = {}) => review({ moves: TENSE_MOVES, evals: flatEvals(TENSE_MOVES), result: '1/2-1/2', ...opts });

/**
 * `n` blitz games an hour apart (never the same sitting, never quick), the
 * newest ending at `end`, oldest first, keyed lichess.org/g1…: 'L' | 'W' | 'D'.
 */
function games(results, { end = NOW, gap = HOUR, ...rest } = {}) {
  const out = results.split('').map((ch, i) => row({ t: end - (results.length - 1 - i) * gap, r: { L: 0, W: 1, D: 0.5 }[ch], ...rest }));
  out.forEach((r, i) => (r.k = 'lichess.org/g' + (i + 1)));
  return out;
}

/**
 * A ledger from tokens, oldest first, the newest game ending at `end`:
 * 'L' | 'W' | 'D' a game 5 minutes after the one before (never quick),
 * 'l' | 'w' | 'd' a game 1 minute after the one before (quick when that was a loss),
 * '|' a 31-minute break (a new sitting). Every game lasts 300 s.
 */
function sitting(tokens, { end = NOW, ...rest } = {}) {
  const rows = [];
  let t = 0;
  let gap = 0;
  for (const tok of tokens.split(/\s+/).filter(Boolean)) {
    if (tok === '|') {
      gap = SITTING_MS + MIN;
      continue;
    }
    const start = t + (rows.length ? gap || (tok === tok.toLowerCase() ? MIN : 5 * MIN) : 0);
    t = start + 300000;
    rows.push(row({ t, d: 300, r: { L: 0, W: 1, D: 0.5 }[tok.toUpperCase()], ...rest }));
    gap = 0;
  }
  const shift = end - t;
  for (const r of rows) r.t += shift;
  return rows;
}

/** A reviewed loss linked to a ledger row, with its saved mistake of `kind`. */
function reviewed(r, { kind = 'hung-piece', ...rest } = {}) {
  const rev = lostGame({ gameKey: r.k, created: r.t, ...rest });
  return { review: rev, mistake: mistakeFor(rev, kind) };
}

/** A state from a ledger with some rows reviewed: `which` maps row index to review options. */
function stateFor(ledger, which = {}, extra = {}) {
  const reviews = [];
  const mistakes = [];
  for (const [i, opts] of Object.entries(which)) {
    const { review: rev, mistake } = reviewed(ledger[Number(i)], opts);
    reviews.push(rev);
    mistakes.push(mistake);
  }
  return stateWith({ reviews, mistakes, ledger, minutes: 60, ...extra });
}

/** Losing 7 of 10, the newest a day ago (no STOP card tonight), with `n` of the losses reviewed as hung pieces. */
function safetyStreak({ reviewedLosses = 5, extra = {} } = {}) {
  const ledger = games('LLLLLLLWWW', { end: NOW - DAY });
  const which = Object.fromEntries(Array.from({ length: reviewedLosses }, (_, i) => [i, {}]));
  return stateFor(ledger, which, extra);
}

const ids = plan => plan.blocks.map(b => b.id);
const byId = (plan, id) => plan.blocks.find(b => b.id === id);
const required = plan => plan.blocks.filter(b => !b.optional).map(b => b.id);
const started = (state, block) => ({ ...block, base: baseline(state) });
const log = (state, t, n = 1) => {
  for (let i = 0; i < n; i++) state.log.push({ d: '2026-10-13', k: 'p', t, c: 1 });
};

// ---------- Feature 1: one leak ----------

test('F1 planner: a safety leak rebuilds the day around Safe or hanging? and the habit', () => {
  const state = safetyStreak();
  state.reviews.push(safeGame({ created: NOW - 2 * DAY }));
  assert.equal(streakMode(state, NOW), true);
  assert.equal(diagnoseStreak(state, { now: NOW }).leak, 'safety');
  const puzzles = [{ id: 'p1' }, { id: 'p2' }];
  state.records = { p1: { tries: 1, due: NOW - HOUR }, p2: { tries: 1, due: NOW - HOUR } };
  const plan = planSession(state, { now: NOW, puzzles, target: 1400 });
  const list = ids(plan);
  // The two unreviewed losses (resigned, not queued after a loss) have no category and are not counted.
  assert.deepEqual(plan.streak, {
    leak: 'safety',
    share: 1,
    count: 5,
    counted: 5,
    line: `Losing 7 of your last 10. 5 of them began with a piece hung in one move. Habit: ${KINDS['hung-piece'].habit}`,
  });
  for (const id of ['lesson', 'unit', 'weak', 'drill', 'clock']) assert.ok(!list.includes(id), `${id} is skipped: ${list.join()}`);
  assert.ok(list.includes('nemesis'), 'Nemesis stays on a losing streak');
  // The debrief of the freshest game stays first among the required blocks; recall stays.
  assert.equal(required(plan)[0], 'debrief');
  assert.ok(list.indexOf('debrief') < list.indexOf('leak'));
  assert.ok(byId(plan, 'recall')?.optional);
  const leak = byId(plan, 'leak');
  assert.equal(leak.type, 'safe');
  assert.equal(leak.optional, undefined);
  assert.equal(leak.title, 'Safe or hanging? 10 of your positions');
  assert.equal(leak.detail, '5 seconds each. ' + KINDS['hung-piece'].habit);
  assert.equal(leak.est, 3);
  assert.equal(leak.count, 10);
  assert.equal(leak.params.mode, 'safe');
  assert.equal(leak.params.limit, 10);
  // The leak's decisive positions, newest first, lead the run.
  const examples = diagnoseStreak(state, { now: NOW }).examples.map(e => e.reviewId + ':' + e.ply);
  assert.equal(examples.length, 5);
  assert.deepEqual(leak.params.first, examples);
  const support = byId(plan, 'support');
  assert.equal(support.type, 'clock');
  assert.equal(support.optional, undefined);
  assert.deepEqual(support.params, { mode: 'mistakes', clock: 'pause', limit: 6 });
  assert.equal(support.count, 6);
  assert.equal(support.detail, CLOCK_DRILLS.pause.detail);
  assert.ok(list.indexOf('leak') < list.indexOf('support'));
  // The game: the habit is the objective, required at 20 minutes or more, clocked on your control.
  const game = byId(plan, 'game');
  assert.equal(game.params.objective, KINDS['hung-piece'].habit);
  assert.equal(game.detail, 'Objective: ' + KINDS['hung-piece'].habit);
  assert.equal(game.optional, false);
  assert.equal(game.params.clock, 1);
  assert.equal(game.title, 'Play a 5+0 game');
  // Under 20 minutes the game is optional and the required blocks still stand.
  state.minutes = 15;
  const short = planSession(state, { now: NOW, puzzles, target: 1400 });
  assert.equal(byId(short, 'game')?.optional ?? true, true);
  assert.ok(byId(short, 'leak') && byId(short, 'support'));
});

test('F1 planner: without a bank of safe positions the leak block is the vision sprint', () => {
  const state = safetyStreak();
  const plan = planSession(state, { now: NOW, target: 1400 });
  const leak = byId(plan, 'leak');
  assert.equal(leak.type, 'sprint');
  assert.equal(leak.title, 'Vision sprint');
  assert.equal(leak.optional, undefined);
  assert.deepEqual(leak.params, { mode: 'vision' });
  assert.equal(byId(plan, 'support').params.clock, 'pause');
  // The leak block is the day's sprint: no separate warm-up doubles it.
  assert.ok(!ids(plan).includes('warmup'));
});

test('F1 planner: a clock leak trains the pace drill, with Same clock as support at 6 positions and the pause drill at 5', () => {
  // Seven losses on time, none reviewed: ledger-only losses count for the clock.
  const ledger = games('LLLLLLLWWW', { end: NOW - DAY, term: 'time' });
  const state = stateWith({ ledger, minutes: 60 });
  assert.equal(diagnoseStreak(state, { now: NOW }).leak, 'clock');
  const plan = planSession(state, { now: NOW, target: 1400 });
  const leak = byId(plan, 'leak');
  assert.equal(leak.type, 'clock');
  assert.equal(leak.params.clock, 'pace');
  assert.deepEqual(leak.params, { mode: 'daily', clock: 'pace', limit: 10 });
  assert.equal(leak.title, 'Pace drill: 10 positions');
  assert.equal(leak.count, 10);
  assert.equal(leak.optional, undefined);
  assert.ok(!byId(plan, 'support'), 'no positions, no support');
  assert.ok(!ids(plan).includes('weak'));
  assert.equal(byId(plan, 'game').params.objective, LEAKS.clock.habit);
  // Saved positions from other games: five run the pause drill, six run on the real clock.
  const positions = n => {
    const reviews = Array.from({ length: n }, (_, i) => lostGame({ created: NOW - i * HOUR }));
    return stateWith({ ledger, minutes: 60, reviews, mistakes: reviews.map(r => mistakeFor(r)) });
  };
  const five = byId(planSession(positions(MIN_POSITIONS - 1), { now: NOW, target: 1400 }), 'support');
  assert.deepEqual(five.params, { mode: 'mistakes', clock: 'pause', limit: 6 });
  const six = byId(planSession(positions(MIN_POSITIONS), { now: NOW, target: 1400 }), 'support');
  assert.deepEqual(six, {
    id: 'support',
    type: 'clock',
    title: 'Same clock, better move: 6 positions',
    detail: 'The moments your games turned, on the clock you had.',
    est: 3,
    params: { mode: 'mistakes', clock: 'real', limit: 6 },
    count: 6,
    status: 'todo',
  });
});

test('F1 planner: a tilt leak keeps the rest of the day; the habit becomes the game objective', () => {
  // Seven losses in a row, each queued a minute after the one before: six of them straight after a loss.
  const ledger = sitting('L l l l l l l w w w', { end: NOW - DAY });
  const state = stateWith({ ledger, minutes: 60 });
  state.puzzle.rating = 1200;
  const d = diagnoseStreak(state, { now: NOW });
  assert.equal(d.leak, 'tilt');
  const plan = planSession(state, { now: NOW, target: 1400 });
  const list = ids(plan);
  assert.ok(list.includes('nemesis'), list.join());
  assert.ok(list.includes('weak'), list.join());
  assert.ok(!list.includes('leak') && !list.includes('support'));
  assert.equal(plan.streak.leak, 'tilt');
  assert.equal(byId(plan, 'nemesis').params.objective, LEAKS.tilt.habit);
  assert.equal(byId(plan, 'game').params.objective, LEAKS.tilt.habit);
  assert.equal(byId(plan, 'game').optional, false);
});

test('F1 planner: convert, opening and calc leaks map to the replay, repertoire and pause blocks', () => {
  // Reviewed losses from a winning position, not hung: convert.
  const ledger = games('LLLLLLLWWW', { end: NOW - DAY });
  const which = Object.fromEntries([0, 1, 2, 3, 4].map(i => [i, { kind: 'missed-tactic' }]));
  const convert = stateFor(ledger, which);
  assert.equal(diagnoseStreak(convert, { now: NOW }).leak, 'convert');
  const cplan = planSession(convert, { now: NOW, target: 1400 });
  const leak = byId(cplan, 'leak');
  assert.equal(leak.type, 'replay');
  assert.equal(leak.optional, undefined);
  assert.equal(leak.title, 'Play it again: convert the win');
  assert.ok(!ids(cplan).includes('replay'), 'the replay block is the leak block');
  // Five saved positions: the pause drill supports it; the game objective is the habit.
  assert.equal(byId(cplan, 'support').params.clock, 'pause');
  assert.equal(byId(cplan, 'game').params.objective, LEAKS.convert.habit);

  // The calc leak: losses from level positions after move 10, no clock.
  const calcLedger = games('LLLLLLLWWW', { end: NOW - DAY });
  const calcState = stateFor(calcLedger, {}, {});
  for (const i of [0, 1, 2, 3, 4]) {
    const r = calcLedger[i];
    const rev = review({
      gameKey: r.k,
      created: r.t,
      moves: TENSE_MOVES,
      evals: { 22: 0, 23: -550 },
      marks: [{ ply: 22, cls: 'mistake', loss: 50, mistakeId: 'x' + i }],
    });
    calcState.reviews.push(rev);
    calcState.mistakes.push({ ...mistakeFor(rev, 'missed-tactic'), id: 'x' + i, source: { reviewId: rev.id, ply: 22 } });
  }
  assert.equal(diagnoseStreak(calcState, { now: NOW }).leak, 'calc');
  const kplan = planSession(calcState, { now: NOW, target: 1400 });
  const kleak = byId(kplan, 'leak');
  assert.equal(kleak.type, 'clock');
  assert.deepEqual(kleak.params, { mode: 'mistakes', clock: 'pause', limit: 6 });
  assert.equal(kleak.title, 'Pause drill: 6 of your positions');
  assert.match(kleak.detail, new RegExp('^' + OBJECTIVES.calculation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.ok(!byId(kplan, 'support'), 'five positions: no second pause drill');
  assert.ok(!ids(kplan).includes('clock'), 'the leak block is the clock block');

  // The opening leak: the same games lost before move 10 with an ordinary mistake.
  const openState = stateFor(calcLedger, {}, {});
  for (const i of [0, 1, 2, 3, 4]) {
    const r = calcLedger[i];
    const rev = review({
      gameKey: r.k,
      created: r.t,
      moves: TENSE_MOVES,
      evals: { 6: 0, 7: -550 },
      marks: [{ ply: 6, cls: 'mistake', loss: 50 }],
    });
    openState.reviews.push(rev);
  }
  assert.equal(diagnoseStreak(openState, { now: NOW }).leak, 'opening');
  const oplan = planSession(openState, { now: NOW, target: 1400 });
  const oleak = byId(oplan, 'leak');
  assert.equal(oleak.type, 'repertoire');
  assert.deepEqual(oleak.params, { drill: 'repertoire', limit: 6 });
  assert.equal(oleak.count, 6);
  assert.equal(oleak.optional, undefined);
  assert.ok(!ids(oplan).includes('repertoire'), 'the repertoire block is the leak block');
  assert.equal(byId(oplan, 'game').params.objective, OBJECTIVES.openings);
});

test('F1 evidence: the leak row counts the losses that began with the leak, before and now', () => {
  // Before (20–23 days ago): four losses, all hung pieces. Now (1–4 days ago): one hung piece, three thrown wins.
  const ledger = [
    ...games('LLLL', { end: NOW - 20 * DAY, gap: DAY }),
    ...games('LLLLWW', { end: NOW - DAY, gap: DAY }).map((r, i) => ({ ...r, k: 'lichess.org/h' + (i + 1) })),
  ];
  const state = stateFor(ledger, {
    0: {},
    1: {},
    2: {},
    3: {},
    4: {},
    5: { kind: 'missed-tactic' },
    6: { kind: 'missed-tactic' },
    7: { kind: 'missed-tactic' },
  });
  const d = diagnoseStreak(state, { now: NOW });
  assert.equal(d.leak, 'safety');
  assert.deepEqual([d.counts.safety, d.counts.convert, d.counted], [5, 3, 8]);
  const ev = evidence(state, NOW);
  assert.equal(ev.leak, 'safety');
  const leak = ev.rows.find(r => r.id === 'leak');
  assert.equal(leak.before, 1);
  assert.equal(leak.now, 0.25);
  assert.equal(leak.verdict, 'better');
  assert.equal(leak.text, '4 of 4 → 1 of 4.');
  assert.deepEqual([ev.recent.ledger.losses, ev.before.ledger.losses], [4, 4]);
  // Without a leak the row is unknown.
  const none = evidence(stateWith({ ledger }), NOW);
  assert.equal(none.leak, null);
  assert.equal(none.rows.find(r => r.id === 'leak').verdict, 'unknown');
  // Under three classified losses in a window: unknown.
  const thin = stateFor(ledger.slice(2), { 0: {}, 1: {}, 2: {}, 3: {}, 4: {} });
  assert.equal(evidence(thin, NOW).rows.find(r => r.id === 'leak').verdict, 'unknown');
});

test('F1 evidence: the fast row counts blunders played in under 4.5 seconds per clocked game', () => {
  const rushed = created => lostGame({ created, tc: TC, clocks: clocksWith(280, 278) });
  const calm = created => lostGame({ created, tc: TC, clocks: CLOCKS });
  const state = stateWith({
    reviews: [
      calm(NOW - DAY),
      calm(NOW - 2 * DAY),
      calm(NOW - 3 * DAY),
      rushed(NOW - 20 * DAY),
      rushed(NOW - 21 * DAY),
      rushed(NOW - 22 * DAY),
    ],
  });
  const ev = evidence(state, NOW);
  const fast = ev.rows.find(r => r.id === 'fast');
  assert.equal(fast.before, 1);
  assert.equal(fast.now, 0);
  assert.equal(fast.verdict, 'better');
  assert.equal(fast.text, '1.0 → 0.0.');
  assert.equal(fast.label, 'Blunders played in under 4.5 seconds, per game');
  // Two clocked games in a window are not enough, however many games were reviewed.
  const two = stateWith({ reviews: [...state.reviews.slice(0, 2), lostGame({ created: NOW - DAY }), ...state.reviews.slice(3)] });
  assert.equal(evidence(two, NOW).rows.find(r => r.id === 'fast').verdict, 'unknown');
  // The rows come in the spec's order.
  assert.deepEqual(
    MEASURES.map(m => m.id),
    ['blunders', 'threats', 'rushed', 'convert', 'score', 'afterLoss', 'run', 'leak', 'fast'],
  );
  assert.deepEqual(
    ev.rows.map(r => r.id),
    MEASURES.map(m => m.id),
  );
  assert.equal(MIN_GAMES, 3);
});

test('F1 focus: a safety leak asks for the pause drill and safety before any debrief habit', () => {
  const state = safetyStreak();
  // Five debriefs tagged "missed my chance" would otherwise point at tactics.
  for (const r of state.reviews) r.marks[0].reason = 'chance';
  const f = focus(state, NOW);
  assert.deepEqual(f, { drill: 'pause', skill: 'safety', reason: diagnoseStreak(state, { now: NOW }).line });
  assert.deepEqual(focus({ ...state, ledger: [] }, NOW), { skill: 'tactics', reason: 'Your debriefs keep saying: missed my chance.' });
  // Each leak names its push; tilt falls through to the usual rules.
  const clockState = stateWith({ ledger: games('LLLLLLLWWW', { end: NOW - DAY, term: 'time' }) });
  assert.deepEqual(focus(clockState, NOW), { drill: 'pace', reason: diagnoseStreak(clockState, { now: NOW }).line });
  const tilt = stateWith({ ledger: sitting('L l l l l l l w w w', { end: NOW - DAY }) });
  assert.equal(focus(tilt, NOW), null);
});

test('F1 coach: the leak line is the first finding in streak mode', () => {
  const state = safetyStreak();
  const d = diagnose(state, NOW);
  assert.equal(d.findings[0], diagnoseStreak(state, { now: NOW }).line);
  assert.match(d.findings[0], /^Losing 7 of your last 10\. 5 of them began with a piece hung in one move\./);
  assert.ok(d.findings.length > 1, 'the usual findings follow');
  const calm = diagnose({ ...state, ledger: [] }, NOW);
  assert.ok(!calm.findings.some(f => f.startsWith('Losing')));
});

// ---------- Feature 2: the stop line ----------

test('F2 planner: two losses in a row tonight put the reset first and drop the game', () => {
  // Forty minutes after the second loss: the card is no longer live, but tonight is shaped.
  const ledger = sitting('W L L', { end: NOW - 40 * MIN });
  const state = stateWith({ ledger, minutes: 60 });
  const stop = stopState(state, NOW);
  assert.deepEqual([stop.live, stop.tonight], [false, true]);
  const plan = planSession(state, { now: NOW, target: 1400 });
  assert.equal(plan.blocks[0].id, 'reset');
  assert.deepEqual(plan.blocks[0], {
    id: 'reset',
    type: 'reset',
    title: 'Reset: 4 minutes',
    detail: 'Two losses in a row, 40 min ago. Four of your positions, then stop for tonight.',
    est: 4,
    params: { mode: 'vision' },
    count: 4,
    status: 'todo',
  });
  assert.ok(!ids(plan).includes('game'), ids(plan).join());
  assert.ok(ids(plan).includes('nemesis'), 'the rest of the plan stands');
  // The reset runs the pause drill on three of your positions, or Safe or hanging? on four.
  const own = stateWith({ ledger, minutes: 60, reviews: [lostGame(), lostGame(), lostGame()] });
  assert.deepEqual(resetBlock(own, NOW).params, { mode: 'mistakes', clock: 'pause', limit: 3 });
  const bank = stateWith({ ledger, minutes: 60, reviews: [lostGame(), lostGame(), lostGame(), safeGame()] });
  assert.deepEqual(resetBlock(bank, NOW).params, { mode: 'safe', limit: 4 });
  assert.equal(byId(planSession(bank, { now: NOW, target: 1400 }), 'reset').params.mode, 'safe');
  // One loss, or two losses more than three hours ago: the plan is unchanged.
  for (const rows of [sitting('L W L', { end: NOW - 40 * MIN }), sitting('W L L', { end: NOW - 3 * HOUR - MIN })]) {
    const same = planSession(stateWith({ ledger: rows, minutes: 60 }), { now: NOW, target: 1400 });
    assert.ok(!ids(same).includes('reset'));
    assert.ok(ids(same).includes('game'));
    assert.deepEqual(ids(same), ids(planSession(stateWith({ minutes: 60 }), { now: NOW, target: 1400 })));
  }
});

test('F2 blockDone: the reset is done per its mode', () => {
  const state = stateWith();
  const block = params => started(state, { id: 'reset', type: 'reset', params, count: 4 });
  const safe = block({ mode: 'safe', limit: 4 });
  log(state, 'pause', 4);
  assert.equal(blockDone(state, safe), false, 'pause rows do not count for a safe reset');
  log(state, 'safe', 3);
  assert.equal(blockDone(state, safe), false);
  log(state, 'safe');
  assert.equal(blockDone(state, safe), true);
  const pause = block({ mode: 'mistakes', clock: 'pause', limit: 3 });
  log(state, 'safe', 3);
  assert.equal(blockDone(state, pause), false);
  log(state, 'pause', 3);
  assert.equal(blockDone(state, pause), true);
  const vision = block({ mode: 'vision' });
  assert.equal(blockDone(state, vision), false);
  state.vision.runs++;
  assert.equal(blockDone(state, vision), true);
});

test('F2 evidence: the score reads the ledger with three rows in each window, else the reviews', () => {
  // Three losses 20 days ago, three wins this week: the ledger says 0% → 100%.
  const ledger = [...games('LLL', { end: NOW - 20 * DAY, gap: DAY }), ...games('WWW', { end: NOW - DAY, gap: DAY })];
  // The reviews say the opposite: wins before, losses now.
  const reviews = [
    ...[20, 21, 22].map(d => review({ result: '1-0', created: NOW - d * DAY })),
    ...[1, 2, 3].map(d => review({ result: '0-1', created: NOW - d * DAY })),
  ];
  const ev = evidence(stateWith({ ledger, reviews }), NOW);
  assert.equal(ev.scoreSource, 'ledger');
  const score = ev.rows.find(r => r.id === 'score');
  assert.deepEqual([score.before, score.now, score.verdict, score.text], [0, 1, 'better', '0% → 100%.']);
  assert.deepEqual([ev.recent.ledger.main, ev.before.ledger.main], [3, 3]);
  // Two rows in a window: the reviews decide.
  const thin = evidence(stateWith({ ledger: ledger.slice(1), reviews }), NOW);
  assert.equal(thin.scoreSource, 'reviews');
  const rscore = thin.rows.find(r => r.id === 'score');
  assert.deepEqual([rscore.before, rscore.now, rscore.verdict], [1, 0, 'worse']);
  // Rated rows only when the sync asks for them.
  const casual = ledger.map(r => ({ ...r, rated: 0 }));
  assert.equal(evidence(stateWith({ ledger: casual, reviews }), NOW).scoreSource, 'reviews');
  const any = stateWith({ ledger: casual, reviews });
  any.sync.ratedOnly = false;
  assert.equal(evidence(any, NOW).scoreSource, 'ledger');
});

test('F2 evidence: the score straight after a loss and the longest loss run', () => {
  // Before: three wins queued straight after a loss. Now: a loss and three more queued straight after it.
  const ledger = [...sitting('L w L w L w', { end: NOW - 20 * DAY }), ...sitting('L l l l', { end: NOW - DAY })];
  const ev = evidence(stateWith({ ledger }), NOW);
  const after = ev.rows.find(r => r.id === 'afterLoss');
  assert.equal(after.label, 'Score straight after a loss');
  assert.deepEqual([after.before, after.now, after.verdict, after.text], [1, 0, 'worse', '100% → 0%.']);
  assert.deepEqual([ev.before.ledger.quick, ev.recent.ledger.quick], [3, 3]);
  const run = ev.rows.find(r => r.id === 'run');
  assert.equal(run.label, 'Longest loss run');
  assert.deepEqual([run.before, run.now, run.verdict, run.text], [1, 4, 'worse', '1.0 → 4.0.']);
  // Two quick games in a window: no verdict; under three rows: no run verdict.
  const few = evidence(
    stateWith({ ledger: [...sitting('L w L w', { end: NOW - 20 * DAY }), ...sitting('L l l l', { end: NOW - DAY })] }),
    NOW,
  );
  assert.equal(few.rows.find(r => r.id === 'afterLoss').verdict, 'unknown');
  assert.equal(few.rows.find(r => r.id === 'run').verdict, 'worse');
  const two = evidence(stateWith({ ledger: [...sitting('L w', { end: NOW - 20 * DAY }), ...sitting('L l l l', { end: NOW - DAY })] }), NOW);
  assert.equal(two.rows.find(r => r.id === 'run').verdict, 'unknown');
  // Training counts the new drills.
  const trained = stateWith({ ledger });
  trained.log = [
    { d: '2026-10-12', k: 'p', t: 'safe', c: 1 },
    { d: '2026-10-12', k: 'p', t: 'real', c: 0 },
    { d: '2026-10-12', k: 'p', t: 'pace', c: 1 },
    { d: '2026-10-12', k: 'p', t: 'Tactics', c: 1 },
  ];
  assert.deepEqual(evidence(trained, NOW).recent.training, {
    puzzles: 4,
    ownMistakes: 0,
    debriefs: 0,
    replays: 0,
    repertoire: 0,
    clock: 1,
    safe: 1,
    real: 1,
  });
});

// ---------- Feature 3: Safe or hanging? ----------

test('F3 blockDone: a safe block counts the safe rows only', () => {
  const state = stateWith();
  const block = started(state, { id: 'warmup', type: 'safe', params: { mode: 'safe', limit: 2, first: [] }, count: 2 });
  log(state, 'pause', 2);
  log(state, 'Tactics', 2);
  assert.equal(blockDone(state, block), false);
  log(state, 'safe');
  assert.equal(blockDone(state, block), false);
  log(state, 'safe');
  assert.equal(blockDone(state, block), true);
});

test('F3 planner: the warm-up is Safe or hanging? when your games hang pieces and six items exist', () => {
  const hung = [lostGame({ created: NOW - DAY }), lostGame({ created: NOW - 2 * DAY }), lostGame({ created: NOW - 3 * DAY })];
  const state = stateWith({ reviews: [...hung, safeGame({ created: NOW - 4 * DAY })], minutes: 60 });
  const plan = planSession(state, { now: NOW, target: 1400 });
  const warm = byId(plan, 'warmup');
  assert.equal(warm.type, 'safe');
  assert.equal(warm.optional, true);
  assert.equal(warm.est, 2);
  assert.equal(warm.title, 'Safe or hanging? 10 of your positions');
  assert.deepEqual(warm.params, { mode: 'safe', limit: 10, first: [] });
  assert.equal(warm.count, 10);
  assert.equal(plan.blocks[0].id, 'warmup');
  // Without the safe positions the vision sprint stays; so does a bank from games that hang nothing.
  const noBank = planSession(stateWith({ reviews: hung, minutes: 60 }), { now: NOW, target: 1400 });
  assert.equal(byId(noBank, 'warmup').type, 'sprint');
  const noLeak = planSession(stateWith({ reviews: [safeGame(), safeGame(), safeGame({ created: NOW - DAY })], minutes: 60 }), {
    now: NOW,
    target: 1400,
  });
  assert.equal(byId(noLeak, 'warmup').type, 'sprint');
});

// ---------- Feature 4: blitz clock on Play ----------

test('F4 planner: the session game runs on your most played control at ten blitz rows', () => {
  assert.equal(CLOCK_ROWS, 10);
  const ten = stateWith({ ledger: games('WWWWWWWWWW', { end: NOW - DAY, base: 180, inc: 2 }), minutes: 60 });
  const game = byId(planSession(ten, { now: NOW, target: 1400 }), 'game');
  assert.equal(game.title, 'Play a 3+2 game');
  assert.equal(game.params.clock, 1);
  assert.equal(game.est, 10);
  assert.match(game.detail, /^Objective: /);
  const nine = stateWith({ ledger: games('WWWWWWWWW', { end: NOW - DAY, base: 180, inc: 2 }), minutes: 60 });
  const plain = byId(planSession(nine, { now: NOW, target: 1400 }), 'game');
  assert.equal(plain.title, 'Play a game');
  assert.equal(plain.params.clock, undefined);
  assert.equal(plain.est, 15);
  // Rapid rows do not count; rows older than 42 days do not either.
  const rapid = stateWith({ ledger: games('WWWWWWWWWW', { end: NOW - DAY, tc: 'rapid', base: 600 }), minutes: 60 });
  assert.equal(byId(planSession(rapid, { now: NOW, target: 1400 }), 'game').params.clock, undefined);
  const old = stateWith({ ledger: games('WWWWWWWWWW', { end: NOW - 43 * DAY }), minutes: 60 });
  assert.equal(byId(planSession(old, { now: NOW, target: 1400 }), 'game').params.clock, undefined);
});

test('F4 planner: the replay block takes its time from the clock you had', () => {
  const clocked = stateWith({ reviews: [lostGame({ tc: TC, clocks: clocksWith(41, 39) })], minutes: 60 });
  const replay = byId(planSession(clocked, { now: NOW, target: 1400 }), 'replay');
  assert.equal(replay.type, 'replay');
  assert.equal(replay.est, Math.ceil(41 / 60) + 2);
  assert.equal(replay.title, 'Play it again: convert the win');
  assert.equal(replay.detail, 'From your game against rival, before Nxf7, with 0:41 on your clock.');
  const long = stateWith({ reviews: [lostGame({ tc: TC, clocks: CLOCKS })], minutes: 60 });
  assert.equal(byId(planSession(long, { now: NOW, target: 1400 }), 'replay').est, 7);
  // Without clocks a blitz review replays on one minute; a rapid one has no clock and the old estimate.
  const blitz = stateWith({ reviews: [{ ...lostGame(), tc: TC }], minutes: 60 });
  assert.equal(byId(planSession(blitz, { now: NOW, target: 1400 }), 'replay').est, 3);
  const rapid = stateWith({ reviews: [{ ...lostGame(), tc: { base: 600, inc: 0 } }], minutes: 60 });
  const r = byId(planSession(rapid, { now: NOW, target: 1400 }), 'replay');
  assert.equal(r.est, 6);
  assert.equal(r.detail, 'From your game against rival, before Nxf7.');
});

// ---------- Feature 5: Same clock, better move ----------

test('F5 planner: Same clock is the clock block when nothing else is wrong, required when you lose on time', () => {
  const reviews = Array.from({ length: MIN_POSITIONS }, (_, i) => lostGame({ created: NOW - i * HOUR }));
  const positions = ledger => stateWith({ ledger, minutes: 60, reviews, mistakes: reviews.map(r => mistakeFor(r)) });
  // Four losses of eight, one on time: a quarter of your losses, so the block is required.
  const onTime = games('WLWLWLWL', { end: NOW - DAY }).map((r, i) => (i === 7 ? { ...r, term: 'time' } : r));
  assert.equal(streakMode(positions(onTime), NOW), false);
  const plan = planSession(positions(onTime), { now: NOW, target: 1400 });
  const clock = byId(plan, 'clock');
  assert.equal(clock.optional, false);
  assert.deepEqual(clock.params, { mode: 'mistakes', clock: 'real', limit: 6 });
  assert.equal(clock.title, 'Same clock, better move: 6 positions');
  assert.equal(clock.count, 6);
  assert.ok(!ids(plan).includes('support'));
  // No losses on time: optional.
  const calm = planSession(positions(games('WLWLWLWL', { end: NOW - DAY })), { now: NOW, target: 1400 });
  assert.equal(byId(calm, 'clock').optional, true);
  assert.equal(byId(calm, 'clock').params.clock, 'real');
  // Three losses, one on time: a third, but too few losses to say.
  const few = planSession(positions(games('WWLWLWL', { end: NOW - DAY }).map((r, i) => (i === 6 ? { ...r, term: 'time' } : r))), {
    now: NOW,
    target: 1400,
  });
  assert.equal(byId(few, 'clock').optional, true);
  // Five positions: no Same clock block outside streak mode.
  const five = stateWith({ ledger: onTime, minutes: 60, reviews: reviews.slice(1), mistakes: reviews.slice(1).map(r => mistakeFor(r)) });
  assert.ok(!byId(planSession(five, { now: NOW, target: 1400 }), 'clock'));
  // Done when six real-clock rows are logged.
  const state = positions(onTime);
  const block = started(state, clock);
  log(state, 'pause', 6);
  assert.equal(blockDone(state, block), false);
  log(state, 'real', 6);
  assert.equal(blockDone(state, block), true);
});

test('F5 planner: a clock habit from your reviews still wins the clock block', () => {
  // Critical moves played in under a second: the pause drill, not Same clock.
  const tc = { base: 180, inc: 0 };
  const game = created =>
    review({
      created,
      tc,
      clocks: [179, 179, 178.5, 178, 178, 177, 177.6, 176, 177.2, 175],
      evals: { 2: 300, 3: 0, 4: 0, 6: 0 },
      marks: [{ ply: 2, cls: 'blunder', loss: 40 }, { ply: 4 }, { ply: 6 }],
      debriefed: true,
    });
  const reviews = Array.from({ length: MIN_POSITIONS }, (_, i) => lostGame({ created: NOW - 10 * DAY - i * HOUR }));
  const state = stateWith({
    reviews: [game(NOW - 4 * DAY), game(NOW - 5 * DAY), ...reviews],
    mistakes: reviews.map(r => mistakeFor(r)),
    minutes: 60,
  });
  const clock = byId(planSession(state, { now: NOW, target: 1400 }), 'clock');
  assert.equal(clock.params.clock, 'pause');
  assert.equal(QUICK_MS, 120000);
});
