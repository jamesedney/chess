// Local dates (dateKey) decide what "today" is; pin the zone so the fixtures mean the same everywhere.
process.env.TZ = 'UTC';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RULE,
  SITTING_MS,
  QUICK_MS,
  LIVE_MS,
  TONIGHT_MS,
  MIN_BUCKET,
  GAP,
  annotate,
  sittings,
  tiltProfile,
  stopState,
  resetParams,
  recordReset,
  sinceStop,
  ruleLine,
} from '../../src/tilt.js';
import { dateKey } from '../../src/state.js';
import { row, stateWith, lostGame, mistakeFor, NOW, DAY } from './fixtures-v5.mjs';

const MIN = 60000;
const RESULT = { L: 0, W: 1, D: 0.5 };
const REST_GAP = 5 * MIN; // never quick, same sitting
const QUICK_GAP = MIN; // quick when the game before was a loss

/**
 * A ledger from tokens, oldest first, the newest game ending at `end`:
 * 'L' | 'W' | 'D' a game 5 minutes after the one before (never quick),
 * 'l' | 'w' | 'd' a game 1 minute after the one before (quick when that was a loss),
 * '|' a 31-minute break (a new sitting). Every game lasts `d` seconds.
 */
function ledgerOf(tokens, { end = NOW, d = 300, ...rest } = {}) {
  const rows = [];
  let t = 0;
  let gap = 0;
  for (const tok of tokens.split(/\s+/).filter(Boolean)) {
    if (tok === '|') {
      gap = SITTING_MS + MIN;
      continue;
    }
    const start = t + (rows.length ? gap || (tok === tok.toLowerCase() ? QUICK_GAP : REST_GAP) : 0);
    t = start + d * 1000;
    rows.push(row({ t, d, r: RESULT[tok.toUpperCase()], ...rest }));
    gap = 0;
  }
  const shift = end - t;
  for (const r of rows) r.t += shift;
  return rows;
}

/** Two games `gap` ms apart, the first a loss (or `first`), the second ending now. */
const pair = (gap, { first = 0, second = 0, x = 1 } = {}) => [
  row({ t: NOW - gap - 300000, r: first, x }),
  row({ t: NOW, r: second, d: 300, x }),
];

test('constants', () => {
  assert.deepEqual(RULE, { games: 4, stopAfter: 2, waitMin: 2 });
  assert.equal(SITTING_MS, 30 * MIN);
  assert.equal(QUICK_MS, 120000);
  assert.equal(LIVE_MS, 20 * MIN);
  assert.equal(TONIGHT_MS, 3 * 3600000);
  assert.equal(MIN_BUCKET, 8);
  assert.equal(GAP, 0.15);
});

test('annotate: a 31-minute gap starts a new sitting, 29 (and exactly 30) do not', () => {
  const at = gap => annotate(pair(gap)).map(r => [r.sitting, r.idx]);
  assert.deepEqual(at(31 * MIN), [
    [0, 1],
    [1, 1],
  ]);
  assert.deepEqual(at(29 * MIN), [
    [0, 1],
    [0, 2],
  ]);
  assert.deepEqual(at(30 * MIN), [
    [0, 1],
    [0, 2],
  ]);
  assert.deepEqual(at(30 * MIN + 1), [
    [0, 1],
    [1, 1],
  ]);
});

test('annotate: idx counts within the sitting, rows come back in time order with their fields', () => {
  const rows = ledgerOf('L W | W L L');
  const out = annotate([...rows].reverse());
  assert.deepEqual(
    out.map(r => r.idx),
    [1, 2, 1, 2, 3],
  );
  assert.deepEqual(
    out.map(r => r.sitting),
    [0, 0, 1, 1, 1],
  );
  assert.deepEqual(
    out.map(r => r.k),
    rows.map(r => r.k),
  );
  assert.deepEqual(
    out.map(r => r.prevLoss),
    [false, true, false, false, true],
  );
  assert.equal(out[0].t, rows[0].t);
  assert.deepEqual(annotate([]), []);
  assert.deepEqual(annotate(undefined), []);
});

test('annotate: quick at 119 s and 120 s after a loss, not at 121 s, not after a win', () => {
  const quick = (gap, opts) => annotate(pair(gap, opts))[1].quick;
  assert.equal(quick(119000), true);
  assert.equal(quick(120000), true);
  assert.equal(quick(121000), false);
  assert.equal(quick(60000, { first: 1 }), false);
  assert.equal(quick(60000, { first: 0.5 }), false);
  assert.equal(annotate(pair(60000))[0].quick, false);
});

test('annotate: prevLoss and quick never cross a sitting boundary', () => {
  const [, second] = annotate(pair(31 * MIN));
  assert.equal(second.prevLoss, false);
  assert.equal(second.quick, false);
});

test('annotate: rows with x: 0 use t for both start and end, so a quick game can be missed but never invented', () => {
  // The second game's end is 6 minutes after the loss; with its 5-minute duration it started 60 s after.
  const exact = [row({ t: NOW - 6 * MIN, r: 0 }), row({ t: NOW, r: 0, d: 300, x: 1 })];
  assert.equal(annotate(exact)[1].quick, true);
  const approx = [row({ t: NOW - 6 * MIN, r: 0 }), row({ t: NOW, r: 0, d: 300, x: 0 })];
  assert.equal(annotate(approx)[1].quick, false);
  const noDuration = [row({ t: NOW - 6 * MIN, r: 0 }), row({ t: NOW, r: 0, d: null, x: 0 })];
  assert.equal(annotate(noDuration)[1].quick, false);
  // An x: 0 row that ends 60 s after the loss is quick: its real start was no later than that.
  const close = [row({ t: NOW - MIN, r: 0 }), row({ t: NOW, r: 0, d: null, x: 0 })];
  assert.equal(annotate(close)[1].quick, true);
  // The gap to the next game is measured from t when the previous row has x: 0.
  const prevApprox = [row({ t: NOW - 6 * MIN - 300000, r: 0, d: 300, x: 0 }), row({ t: NOW, r: 0, d: 300 })];
  assert.equal(annotate(prevApprox)[1].sitting, 0);
  assert.equal(annotate(prevApprox)[1].quick, false);
});

test('sittings: start, end and games', () => {
  const rows = ledgerOf('L w | W');
  const s = sittings(rows);
  assert.equal(s.length, 2);
  assert.equal(s[0].start, rows[0].t - 300000);
  assert.equal(s[0].end, rows[1].t);
  assert.deepEqual(
    s[0].games.map(g => g.idx),
    [1, 2],
  );
  assert.equal(s[0].games[1].quick, true);
  assert.equal(s[1].start, rows[2].t - 300000);
  assert.equal(s[1].end, rows[2].t);
  assert.equal(s[1].games.length, 1);
  assert.deepEqual(sittings([]), []);
});

// Quick 4 of 16 (25%): four groups of a loss then three quick losses and a quick win. Rest: the four
// group losses plus standalone games; 8 L + 8 W makes 8 of 20 (40%), a gap of exactly 0.15.
const GROUPS = 'L l l l w '.repeat(4);
const quickLedger = ({ L = 8, W = 8 } = {}) => ledgerOf('W '.repeat(W) + GROUPS + 'L '.repeat(L));

test('tiltProfile: the quick verdict speaks at a gap of exactly 0.15 with the exact line', () => {
  const p = tiltProfile(quickLedger(), { now: NOW });
  assert.deepEqual(p.afterLoss, { quick: { n: 16, score: 0.25 }, rest: { n: 20, score: 0.4 } });
  assert.deepEqual(p.verdicts, ['quick']);
  assert.deepEqual(p.lines, ['Straight after a loss: 4 of 16 (25%). Your other games: 40%.']);
  assert.equal(p.rule.default, false);
  assert.equal(p.rule.label, 'Your rule');
  assert.equal(p.games, 36);
});

test('tiltProfile: the quick verdict is silent at a gap under 0.15', () => {
  const p = tiltProfile(quickLedger({ L: 7, W: 7 }), { now: NOW });
  assert.equal(p.afterLoss.rest.n, 18);
  assert.ok(p.afterLoss.rest.score - p.afterLoss.quick.score > 0.13);
  assert.ok(p.afterLoss.rest.score - p.afterLoss.quick.score < 0.15);
  assert.deepEqual(p.verdicts, []);
  assert.deepEqual(p.lines, []);
  assert.equal(p.rule.default, true);
  assert.equal(p.rule.label, 'Default rule');
});

test('tiltProfile: the quick verdict needs 8 games in each bucket', () => {
  const quick7 = tiltProfile(ledgerOf('L l l l l l l w ' + 'W '.repeat(8)), { now: NOW });
  assert.equal(quick7.afterLoss.quick.n, 7);
  assert.equal(quick7.afterLoss.rest.n, 9);
  assert.deepEqual(quick7.verdicts, []);
  const quick8 = tiltProfile(ledgerOf('L l l l l l l l w ' + 'W '.repeat(8)), { now: NOW });
  assert.equal(quick8.afterLoss.quick.n, 8);
  assert.deepEqual(quick8.verdicts, ['quick']);
  const rest7 = tiltProfile(ledgerOf('L l l l l l l l w ' + 'W '.repeat(6)), { now: NOW });
  assert.equal(rest7.afterLoss.rest.n, 7);
  assert.deepEqual(rest7.verdicts, []);
  const rest8 = tiltProfile(ledgerOf('L l l l l l l l w ' + 'W '.repeat(7)), { now: NOW });
  assert.equal(rest8.afterLoss.rest.n, 8);
  assert.deepEqual(rest8.verdicts, ['quick']);
});

test('tiltProfile: the quick verdict is silent when quick games score better', () => {
  const p = tiltProfile(ledgerOf('L w '.repeat(8) + 'L '.repeat(8)), { now: NOW });
  assert.equal(p.afterLoss.quick.n, 8);
  assert.equal(p.afterLoss.rest.n, 16);
  assert.equal(p.afterLoss.quick.score, 1);
  assert.deepEqual(p.verdicts, []);
});

// Five sittings of six: games 1–4 score 8 of 20 (40%), games 5–6 score 2.5 of 10 (25%), a gap of exactly 0.15.
const DEEP = 'W W L L L L | W W L L W L | W W L L W L | W W L L D L | L L L L L L';

test('tiltProfile: the deep verdict speaks at a gap of exactly 0.15 with the exact line, half points included', () => {
  const p = tiltProfile(ledgerOf(DEEP), { now: NOW });
  assert.deepEqual(p.deep, { late: { n: 10, score: 0.25 }, early: { n: 20, score: 0.4 } });
  assert.deepEqual(p.verdicts, ['deep']);
  assert.deepEqual(p.lines, ['Games 5 and later in a sitting: 2.5 of 10 (25%). Games 1–4: 40%.']);
});

test('tiltProfile: the deep verdict is silent one step under 0.15', () => {
  const p = tiltProfile(ledgerOf(DEEP.replace('W W L L L L', 'W D L L L L')), { now: NOW });
  assert.equal(p.deep.late.score, 0.25);
  assert.equal(p.deep.early.score, 0.375);
  assert.deepEqual(p.verdicts, []);
});

test('tiltProfile: the deep verdict needs 8 games in each bucket', () => {
  const late7 = tiltProfile(ledgerOf('W W W W L L | W W W W L L | W W W W L L | W W W W L'), { now: NOW });
  assert.deepEqual(late7.deep, { late: { n: 7, score: 0 }, early: { n: 16, score: 1 } });
  assert.deepEqual(late7.verdicts, []);
  const late8 = tiltProfile(ledgerOf('W W W W L L | W W W W L L | W W W W L L | W W W W L L'), { now: NOW });
  assert.equal(late8.deep.late.n, 8);
  assert.deepEqual(late8.verdicts, ['deep']);
  const early7 = tiltProfile(ledgerOf('W W W W L L L L L L L L | W W W'), { now: NOW });
  assert.deepEqual(early7.deep, { late: { n: 8, score: 0 }, early: { n: 7, score: 1 } });
  assert.deepEqual(early7.verdicts, []);
  const early8 = tiltProfile(ledgerOf('W W W W L L L L L L L L | W W W W'), { now: NOW });
  assert.deepEqual(early8.deep, { late: { n: 8, score: 0 }, early: { n: 8, score: 1 } });
  assert.deepEqual(early8.verdicts, ['deep']);
});

test('tiltProfile: both verdicts can speak, quick first', () => {
  const p = tiltProfile(ledgerOf('W W W W ' + 'L l l l l l l l l l ' + '| W W W W L L L L L L L L'), { now: NOW });
  assert.deepEqual(p.verdicts, ['quick', 'deep']);
  assert.equal(p.lines.length, 2);
  assert.match(p.lines[0], /^Straight after a loss/);
  assert.match(p.lines[1], /^Games 5 and later/);
});

test('tiltProfile: runs, today, flagged, the window and an empty ledger', () => {
  const ledger = [
    ...ledgerOf('L L L L L W', { end: NOW - 15 * DAY }), // five in a row, older than 14 days
    row({ t: NOW - 10 * DAY, r: 0 }),
    row({ t: NOW - 10 * DAY + 10 * MIN, r: 0, term: 'time' }),
    row({ t: NOW - 10 * DAY + 20 * MIN, r: 1 }),
    row({ t: NOW - 22 * 3600000, r: 1 }), // yesterday, 23:00
    row({ t: NOW - 20 * 3600000, r: 1 }), // today, 01:00
    row({ t: NOW - 10 * MIN, r: 0, term: 'time' }),
    row({ t: NOW, r: 0, term: 'mate' }),
  ];
  const p = tiltProfile(ledger, { now: NOW });
  assert.equal(dateKey(new Date(NOW)), '2026-10-13');
  assert.deepEqual(p.runs, { current: 2, longest14: 2 });
  assert.deepEqual(p.today, { games: 3, score: 1 / 3, lastEnd: NOW });
  assert.deepEqual(p.flagged, { losses: 9, onTime: 2 });
  assert.equal(p.games, 13);
  assert.equal(tiltProfile(ledger, { now: NOW, days: 14 }).games, 7);
  assert.equal(tiltProfile(ledger, { now: NOW, days: 14 }).flagged.losses, 4);
  // The current run reads the whole ledger; the longest run reads the last 14 days only.
  assert.equal(tiltProfile(ledger, { now: NOW + 20 * DAY }).runs.current, 2);
  assert.equal(tiltProfile(ledger, { now: NOW + 20 * DAY }).runs.longest14, 0);
  assert.deepEqual(tiltProfile(ledger, { now: NOW + 20 * DAY }).today, { games: 0, score: null, lastEnd: null });

  const empty = tiltProfile([], { now: NOW });
  assert.deepEqual(empty, {
    games: 0,
    afterLoss: { quick: { n: 0, score: null }, rest: { n: 0, score: null } },
    deep: { late: { n: 0, score: null }, early: { n: 0, score: null } },
    runs: { current: 0, longest14: 0 },
    today: { games: 0, score: null, lastEnd: null },
    flagged: { losses: 0, onTime: 0 },
    verdicts: [],
    rule: {
      games: 4,
      stopAfter: 2,
      waitMin: 2,
      default: true,
      label: 'Default rule',
      text: 'Play 4 games. Stop after 2 losses in a row. Wait 2 minutes after a loss.',
    },
    lines: [],
  });
  assert.deepEqual(tiltProfile(undefined, { now: NOW }), empty);
});

test('tiltProfile: quick flags count games just outside the window too', () => {
  // The oldest game is outside the 42-day window but the game after it is still "straight after a loss".
  const ledger = ledgerOf('L w', { end: NOW - 42 * DAY + 2 * MIN });
  const p = tiltProfile(ledger, { now: NOW });
  assert.equal(p.games, 1);
  assert.equal(p.afterLoss.quick.n, 1);
});

test('stopState: live at 19 and 20 minutes after a loss, not at 21, not after a win or draw', () => {
  const after = (ms, r = 0) => stopState(stateWith({ ledger: [row({ t: NOW - ms, r })] }), NOW);
  assert.equal(after(19 * MIN).live, true);
  assert.equal(after(20 * MIN).live, true);
  assert.equal(after(21 * MIN).live, false);
  assert.equal(after(19 * MIN, 1).live, false);
  assert.equal(after(19 * MIN, 0.5).live, false);
  assert.equal(after(19 * MIN).minutesAgo, 19);
  assert.equal(after(19 * MIN + 59000).minutesAgo, 19);
  assert.equal(after(19 * MIN).run, 1);
});

test('stopState: tonight at two losses in a row within 3 hours, not at one loss, not at 3 h 1 min', () => {
  const runOf = (tokens, ms) => stopState(stateWith({ ledger: ledgerOf(tokens, { end: NOW - ms }) }), NOW);
  assert.equal(runOf('W L L', 40 * MIN).tonight, true);
  assert.equal(runOf('W L L', 3 * 3600000).tonight, true);
  assert.equal(runOf('W L L', 3 * 3600000 + MIN).tonight, false);
  assert.equal(runOf('W L', 40 * MIN).tonight, false);
  assert.equal(runOf('L L W', 40 * MIN).tonight, false);
  assert.equal(runOf('L L L', 40 * MIN).run, 3);
  // Both at once: live says the card is up, tonight shapes the plan.
  const both = runOf('W L L', 5 * MIN);
  assert.equal(both.live, true);
  assert.equal(both.tonight, true);
});

test('stopState: the newest row by time counts, whatever the array order', () => {
  const ledger = [row({ t: NOW - 5 * MIN, r: 0 }), row({ t: NOW - 3 * DAY, r: 1 })];
  const s = stopState(stateWith({ ledger }), NOW);
  assert.equal(s.live, true);
  assert.equal(s.minutesAgo, 5);
});

test('stopState: resetDone only for a reset after the loss, the latest one', () => {
  const ledger = [row({ t: NOW - 10 * MIN, r: 0 })];
  const at = resets => stopState(stateWith({ ledger, stop: { since: null, resets } }), NOW).resetDone;
  assert.equal(at([]), null);
  assert.equal(at([NOW - 11 * MIN]), null);
  assert.equal(at([NOW - 10 * MIN]), null);
  assert.equal(at([NOW - 10 * MIN + 1]), NOW - 10 * MIN + 1);
  assert.equal(at([NOW - 11 * MIN, NOW - 6 * MIN, NOW - 3 * MIN]), NOW - 3 * MIN);
  assert.equal(at([NOW - 3 * MIN, NOW - 6 * MIN]), NOW - 3 * MIN);
  assert.equal(stopState(stateWith({ ledger, stop: undefined }), NOW).resetDone, null);
});

test('stopState: the live text without a verdict, and with the quick verdict', () => {
  const plain = stopState(stateWith({ ledger: [row({ t: NOW - 4 * MIN, r: 0 })] }), NOW);
  assert.equal(plain.text, 'You lost 4 minutes ago. Wait 2 minutes. Reset: 4 minutes, then play.');
  const withVerdict = stopState(stateWith({ ledger: quickLedger({ W: 8, L: 8 }) }), NOW + 5 * MIN);
  assert.equal(withVerdict.live, true);
  assert.equal(
    withVerdict.text,
    'You lost 5 minutes ago. Straight after a loss: 4 of 16 (25%); other games 40%. Reset: 4 minutes, then play.',
  );
  assert.doesNotMatch(withVerdict.text, /sync/);
});

test('stopState: the minutes-ago wording at 0 and 1 minute', () => {
  const at = ms => stopState(stateWith({ ledger: [row({ t: NOW - ms, r: 0 })] }), NOW);
  assert.equal(at(0).text, 'You lost just now. Wait 2 minutes. Reset: 4 minutes, then play.');
  assert.equal(at(30000).minutesAgo, 0);
  assert.equal(at(MIN).text, 'You lost 1 minute ago. Wait 2 minutes. Reset: 4 minutes, then play.');
  // A row from the future (clock skew) reads as just now.
  assert.equal(at(-MIN).minutesAgo, 0);
  assert.equal(at(-MIN).live, true);
});

test('stopState: the tonight text when the card is no longer live', () => {
  const s = stopState(stateWith({ ledger: ledgerOf('W L L', { end: NOW - 40 * MIN }) }), NOW);
  assert.equal(s.live, false);
  assert.equal(s.tonight, true);
  assert.equal(s.minutesAgo, 40);
  assert.equal(s.text, 'Two losses in a row, 40 min ago. Four of your positions, then stop for tonight.');
  const three = stopState(stateWith({ ledger: ledgerOf('L L L', { end: NOW - 40 * MIN }) }), NOW);
  assert.equal(three.text, 'Three losses in a row, 40 min ago. Four of your positions, then stop for tonight.');
});

test('stopState: nothing to say with no recent loss, or an empty ledger', () => {
  const quiet = stopState(stateWith({ ledger: ledgerOf('L L', { end: NOW - 4 * 3600000 }) }), NOW);
  assert.deepEqual(quiet, { live: false, tonight: false, minutesAgo: 240, run: 2, resetDone: null, text: '' });
  assert.deepEqual(stopState(stateWith(), NOW), { live: false, tonight: false, minutesAgo: null, run: 0, resetDone: null, text: '' });
  assert.deepEqual(stopState({}, NOW), { live: false, tonight: false, minutesAgo: null, run: 0, resetDone: null, text: '' });
});

test('resetParams: safe when four Safe-or-hanging items exist, else pause on three mistakes, else vision', () => {
  const three = [lostGame(), lostGame(), lostGame()];
  const state = stateWith({ reviews: three });
  assert.equal(state.mistakes.length, 3);
  assert.deepEqual(resetParams(state, { safeCount: 4 }), { mode: 'safe', limit: 4 });
  assert.deepEqual(resetParams(state, { safeCount: 9 }), { mode: 'safe', limit: 4 });
  assert.deepEqual(resetParams(state, { safeCount: 3 }), { mode: 'mistakes', clock: 'pause', limit: 3 });
  assert.deepEqual(resetParams(state), { mode: 'mistakes', clock: 'pause', limit: 3 });
  assert.deepEqual(resetParams(stateWith({ reviews: three.slice(0, 2) })), { mode: 'vision' });
  assert.deepEqual(resetParams(stateWith({ reviews: three.slice(0, 2) }), { safeCount: 3 }), { mode: 'vision' });
  assert.deepEqual(resetParams(stateWith(), { safeCount: 4 }), { mode: 'safe', limit: 4 });
  assert.deepEqual(resetParams({}), { mode: 'vision' });
});

test('resetParams: archived mistakes do not count', () => {
  const reviews = [lostGame(), lostGame(), lostGame()];
  const mistakes = reviews.map(r => mistakeFor(r));
  mistakes[0].archived = true;
  assert.deepEqual(resetParams(stateWith({ reviews, mistakes })), { mode: 'vision' });
  mistakes[0].archived = false;
  assert.deepEqual(resetParams(stateWith({ reviews, mistakes })), { mode: 'mistakes', clock: 'pause', limit: 3 });
});

test('recordReset: pushes now, keeps the newest 50, creates the stop record when missing', () => {
  const state = stateWith();
  recordReset(state, NOW);
  assert.deepEqual(state.stop, { since: null, resets: [NOW] });
  for (let i = 1; i <= 60; i++) recordReset(state, NOW + i * MIN);
  assert.equal(state.stop.resets.length, 50);
  assert.equal(state.stop.resets[0], NOW + 11 * MIN);
  assert.equal(state.stop.resets[49], NOW + 60 * MIN);
  const bare = {};
  recordReset(bare, NOW);
  assert.deepEqual(bare.stop, { since: null, resets: [NOW] });
  const since = { stop: { since: '2026-10-01' } };
  recordReset(since, NOW);
  assert.deepEqual(since.stop, { since: '2026-10-01', resets: [NOW] });
});

test('sinceStop: null before the rule has shown', () => {
  assert.equal(sinceStop(stateWith({ ledger: ledgerOf('L l') }), NOW), null);
  assert.equal(sinceStop({}, NOW), null);
});

test('sinceStop: splits by the local date of stop.since and counts games within 30 minutes of a reset', () => {
  const since = '2026-10-10';
  const sinceMs = Date.parse('2026-10-10T00:00:00Z');
  const ledger = [
    // Before: four quick games scoring 1 and a loss run of 3, on the 5th.
    ...ledgerOf('L l W L l W L l W L w L L L W', { end: NOW - 8 * DAY }),
    // The last minute before the line still counts as before.
    row({ t: sinceMs - 1, r: 1 }),
    // Since: the first ms of the date counts; quick games 2 of 3, longest run 2.
    row({ t: sinceMs, r: 0 }),
    ...ledgerOf('L w L w L l', { end: NOW - DAY }),
    // After a reset at NOW − 2 h: games starting at +5 min (loss) and +30 min (win) count, +31 min does not.
    row({ t: NOW - 2 * 3600000 + 5 * MIN + 300000, r: 0, d: 300 }),
    row({ t: NOW - 2 * 3600000 + 30 * MIN + 60000, r: 1, d: 60 }),
    row({ t: NOW - 2 * 3600000 + 31 * MIN + 300000, r: 1, d: 300 }),
    // A game that ends after the reset but started before it does not count.
    row({ t: NOW - 2 * 3600000 + 2 * MIN, r: 1, d: 300 }),
  ];
  const state = stateWith({ ledger, stop: { since, resets: [NOW - 2 * 3600000] } });
  const s = sinceStop(state, NOW);
  assert.equal(s.since, since);
  assert.deepEqual(s.quick, { before: { n: 4, score: 0.25 }, since: { n: 3, score: 2 / 3 } });
  assert.deepEqual(s.runs, { before: 3, since: 2 });
  assert.deepEqual(s.afterReset, { n: 2, score: 0.5 });
  assert.equal(
    s.text,
    'Since the stop line (10 Oct): straight after a loss 2 of 3 (was 1 of 4). After a reset: 1 of 2. Longest loss run 2 (was 3).',
  );
});

test('sinceStop: the sentence leaves out what has not happened yet', () => {
  const since = '2026-10-13';
  const fresh = sinceStop(stateWith({ ledger: ledgerOf('L L W', { end: NOW - 5 * DAY }), stop: { since, resets: [] } }), NOW);
  assert.deepEqual(fresh.quick, { before: { n: 0, score: null }, since: { n: 0, score: null } });
  assert.deepEqual(fresh.runs, { before: 2, since: 0 });
  assert.deepEqual(fresh.afterReset, { n: 0, score: null });
  assert.equal(fresh.text, 'Since the stop line (13 Oct): Longest loss run 0 (was 2).');
  const noHistory = sinceStop(stateWith({ ledger: ledgerOf('L l w'), stop: { since: '2026-10-01', resets: [] } }), NOW);
  assert.deepEqual(noHistory.quick, { before: { n: 0, score: null }, since: { n: 2, score: 0.5 } });
  assert.equal(noHistory.text, 'Since the stop line (1 Oct): straight after a loss 1 of 2. Longest loss run 2.');
  assert.equal(
    sinceStop(stateWith({ stop: { since: '2026-10-01', resets: [] } }), NOW).text,
    'Since the stop line (1 Oct): Longest loss run 0.',
  );
});

test('ruleLine', () => {
  assert.equal(ruleLine(tiltProfile([], { now: NOW })), 'Play rule: 4 games · stop after 2 losses in a row · 2 min between games');
  assert.equal(
    ruleLine(tiltProfile(quickLedger(), { now: NOW })),
    'Play rule: 4 games · stop after 2 losses in a row · 2 min between games',
  );
  assert.equal(ruleLine(undefined), 'Play rule: 4 games · stop after 2 losses in a row · 2 min between games');
});
