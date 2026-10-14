import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEAK_ORDER,
  LEAKS,
  rushedLabel,
  fenAt,
  firstDecisiveError,
  classifyLoss,
  reviewFor,
  diagnoseStreak,
  streakMode,
  leakLine,
  lossAnatomy,
  windowHeadline,
} from '../../src/leak.js';
import { KINDS } from '../../src/mistake-kinds.js';
import { OBJECTIVES } from '../../data/curriculum.js';
import { annotate } from '../../src/tilt.js';
import { review, lostGame, mistakeFor, row, stateWith, NOW, DAY, MOVES, START, FEN_BEFORE_NXF7 } from './fixtures-v5.mjs';

const HOUR = 3600000;
const MIN = 60000;
/** 5+0: White's clocks fall by 5 s a move, so no move is rushed and none is in trouble. */
const TC = { base: 300, inc: 0 };
const CLOCKS = [295, 295, 290, 290, 285, 285, 280, 280, 275, 275];
/** The same game with the clock before 5. Nxf7 (clocks[6]) and after it (clocks[8]) set by hand. */
const clocksWith = (before, after) => CLOCKS.map((c, i) => (i === 6 ? before : i === 8 ? after : c));
const HABIT = KINDS['hung-piece'].habit;

/** `n` games in one control an hour apart (never the same sitting), the newest ending at `end`, oldest first. */
function games(results, { end = NOW, gap = HOUR, ...rest } = {}) {
  const out = results.split('').map((ch, i) => row({ t: end - (results.length - 1 - i) * gap, r: { L: 0, W: 1, D: 0.5 }[ch], ...rest }));
  out.forEach((r, i) => (r.k = 'lichess.org/g' + (i + 1)));
  return out;
}

/** A reviewed loss linked to a ledger row, with its saved mistake of `kind`. */
function reviewed(r, { kind = 'hung-piece', ...rest } = {}) {
  const rev = lostGame({ gameKey: r.k, ...rest });
  return { review: rev, mistake: mistakeFor(rev, kind) };
}

/** A state from a ledger with some rows reviewed: `which` maps row index to review options. */
function stateFor(ledger, which = {}, extra = {}) {
  const reviews = [];
  const mistakes = [];
  for (const [i, opts] of Object.entries(which)) {
    const { review: rev, mistake } = reviewed(ledger[Number(i)], opts);
    reviews.push(rev);
    if (rev.marks.some(m => m.mistakeId)) mistakes.push(mistake);
  }
  return stateWith({ reviews, mistakes, ledger, ...extra });
}

test('LEAK_ORDER, LEAKS: labels, habits and blocks', () => {
  assert.deepEqual(LEAK_ORDER, ['rushed', 'safety', 'clock', 'tilt', 'convert', 'opening', 'calc']);
  assert.deepEqual(Object.keys(LEAKS), LEAK_ORDER);
  assert.equal(LEAKS.rushed.label, 'a move played in under 4.5 seconds');
  assert.equal(LEAKS.rushed.habit, 'At every capture and check, count three before you touch the piece.');
  assert.equal(LEAKS.rushed.block, 'safe');
  assert.equal(LEAKS.safety.label, 'a piece hung in one move');
  assert.equal(LEAKS.safety.habit, 'Before you let go of a piece, check every square it leaves undefended.');
  assert.equal(LEAKS.safety.block, 'safe');
  assert.equal(LEAKS.clock.label, 'the clock');
  assert.equal(LEAKS.clock.habit, 'Under 30 seconds, play the simple move at once.');
  assert.equal(LEAKS.clock.block, 'pace');
  assert.equal(LEAKS.tilt.label, 'a game queued straight after a loss');
  assert.equal(LEAKS.tilt.habit, 'One loss: two minutes away from the board. Two losses in a row: stop for tonight.');
  assert.equal(LEAKS.tilt.block, null);
  assert.equal(LEAKS.convert.label, 'a won position thrown away');
  assert.equal(LEAKS.convert.habit, 'When ahead, trade pieces, not pawns, and ask what they threaten every move.');
  assert.equal(LEAKS.convert.block, 'replay');
  assert.equal(LEAKS.opening.label, 'the opening');
  assert.equal(LEAKS.opening.habit, OBJECTIVES.openings);
  assert.equal(LEAKS.opening.block, 'repertoire');
  assert.equal(LEAKS.calc.label, 'a miscalculation');
  assert.equal(LEAKS.calc.habit, OBJECTIVES.calculation);
  assert.equal(LEAKS.calc.block, 'pause');
});

test('rushedLabel names the rushed threshold of the control exactly', () => {
  assert.equal(rushedLabel(300), 'a move played in under 4.5 seconds'); // 4.5 s at 5+0
  assert.equal(rushedLabel(180), 'a move played in under 3 seconds'); // 3 s at 3+0
  assert.equal(rushedLabel(600), 'a move played in under 9 seconds'); // 9 s at 10+0
  assert.equal(rushedLabel(), 'a move played in under 4.5 seconds');
  assert.equal(rushedLabel(null), 'a move played in under 4.5 seconds');
});

test('fenAt: the position before a ply', () => {
  const r = lostGame();
  assert.equal(fenAt(r, 0), START);
  assert.equal(fenAt(r, 8), FEN_BEFORE_NXF7);
  assert.equal(fenAt(review({ moves: ['e4', 'Ke2'] }), 2), null); // Ke2 is illegal after e4
});

test('firstDecisiveError: the v4 fixture loses at ply 8 from a winning position', () => {
  const d = firstDecisiveError(lostGame());
  assert.equal(d.ply, 8);
  assert.equal(d.loss, 60);
  assert.equal(d.mark.cls, 'blunder');
  assert.equal(d.time, null);
  assert.equal(d.wasWinning, true);
});

test('firstDecisiveError picks the first crossing below −300', () => {
  const r = review({
    evals: { 4: 100, 5: 50, 8: 320, 9: -550, 10: -800 },
    marks: [
      { ply: 4, loss: 50 },
      { ply: 8, cls: 'blunder', loss: 60 },
      { ply: 9, cls: 'blunder', loss: 90 },
    ],
  });
  assert.equal(firstDecisiveError(r).ply, 8);
  // Exactly −300 after the move counts as lost; exactly −300 before it does not.
  assert.equal(firstDecisiveError(review({ evals: { 4: -299, 5: -300 }, marks: [{ ply: 4 }, { ply: 8 }] })).ply, 4);
  assert.equal(firstDecisiveError(review({ evals: { 4: -300, 5: -400, 8: 0, 9: -301 }, marks: [{ ply: 4 }, { ply: 8 }] })).ply, 8);
});

test('firstDecisiveError reads evals from your side for Black', () => {
  const r = review({ colour: 'b', result: '1-0', evals: { 8: -320, 9: 550 }, marks: [{ ply: 8, cls: 'blunder', loss: 60 }] });
  const d = firstDecisiveError(r);
  assert.equal(d.ply, 8);
  assert.equal(d.wasWinning, true);
  // The same numbers from White's side are a win for Black, not a loss.
  const w = review({
    colour: 'w',
    evals: { 8: -320, 9: 550 },
    marks: [
      { ply: 8, cls: 'blunder', loss: 60 },
      { ply: 4, loss: 10 },
    ],
  });
  assert.equal(firstDecisiveError(w).ply, 8); // the costliest, not a crossing
  assert.equal(firstDecisiveError(w).wasWinning, false);
});

test('firstDecisiveError falls back to the costliest mark, earliest on ties', () => {
  const r = review({
    evals: { 2: 50, 3: 40, 4: 30, 5: 20, 6: 10, 7: 0 },
    marks: [
      { ply: 6, loss: 90 },
      { ply: 2, loss: 30 },
      { ply: 4, loss: 90 },
    ],
  });
  const d = firstDecisiveError(r);
  assert.equal(d.ply, 4);
  assert.equal(d.loss, 90);
  assert.equal(d.wasWinning, false);
});

test('firstDecisiveError skips marks with a null eval on either side', () => {
  // Null is unknown, never 0: a null before or after a mark never makes a crossing.
  const r = review({
    evals: { 4: 100, 7: -550, 8: 320, 9: -550 },
    marks: [
      { ply: 4, loss: 70 },
      { ply: 6, loss: 80 },
      { ply: 8, loss: 60 },
    ],
  });
  assert.equal(firstDecisiveError(r).ply, 8);
  // With nothing crossing, a mark with unknown evals still counts for the fallback.
  const only = review({ evals: {}, marks: [{ ply: 4, loss: 70 }] });
  assert.equal(firstDecisiveError(only).ply, 4);
});

test('firstDecisiveError ignores cleared and inaccuracy marks', () => {
  const r = review({
    evals: { 2: 320, 3: -550, 4: 320, 5: -550, 8: 320, 9: -550 },
    marks: [
      { ply: 2, cls: 'blunder', loss: 90, cleared: true },
      { ply: 4, cls: 'inaccuracy', loss: 80 },
      { ply: 8, cls: 'blunder', loss: 60 },
    ],
  });
  assert.equal(firstDecisiveError(r).ply, 8);
  assert.equal(
    firstDecisiveError(
      review({
        marks: [
          { ply: 2, cleared: true },
          { ply: 4, cls: 'inaccuracy' },
        ],
      }),
    ),
    null,
  );
  assert.equal(firstDecisiveError(review()), null);
  assert.equal(firstDecisiveError(null), null);
});

test('firstDecisiveError reports wasWinning from the evals before the error only', () => {
  assert.equal(firstDecisiveError(review({ evals: { 8: 200, 9: -550 }, marks: [{ ply: 8 }] })).wasWinning, false);
  assert.equal(firstDecisiveError(review({ evals: { 3: 250, 8: 200, 9: -550 }, marks: [{ ply: 8 }] })).wasWinning, true);
  assert.equal(firstDecisiveError(review({ evals: { 2: 100, 3: -400, 9: 300 }, marks: [{ ply: 2 }] })).wasWinning, false);
});

test('firstDecisiveError carries the clock before the move when the game has clocks', () => {
  const d = firstDecisiveError(lostGame({ clocks: clocksWith(14, 12), tc: TC }));
  assert.deepEqual(d.time, { spent: 2, left: 14, rushed: true, trouble: true });
});

test('classifyLoss: a rushed hung piece is rushed, not safety', () => {
  const r = lostGame({ clocks: clocksWith(280, 278), tc: TC }); // 2 s on the move
  const state = stateWith({ reviews: [r] });
  assert.deepEqual(classifyLoss(r, null, state), { chess: 'rushed', tilt: false });
  // Exactly the threshold (4.5 s) is not rushed; the hung piece then shows.
  const slow = lostGame({ clocks: clocksWith(280, 275.5), tc: TC });
  assert.equal(classifyLoss(slow, null, stateWith({ reviews: [slow] })).chess, 'safety');
  const quick = lostGame({ clocks: clocksWith(280, 275.6), tc: TC });
  assert.equal(classifyLoss(quick, null, stateWith({ reviews: [quick] })).chess, 'rushed');
});

test('classifyLoss: safety from the mistake kind or an unexplained blunder', () => {
  const hung = lostGame();
  assert.equal(classifyLoss(hung, null, stateWith({ reviews: [hung] })).chess, 'safety');
  const mate = lostGame();
  assert.equal(classifyLoss(mate, null, stateWith({ reviews: [mate], mistakes: [mistakeFor(mate, 'allowed-mate')] })).chess, 'safety');
  const unexplained = review({ evals: { 8: 100, 9: -550 }, marks: [{ ply: 8, cls: 'blunder', loss: 60 }] });
  assert.equal(classifyLoss(unexplained, null, stateWith({ reviews: [unexplained] })).chess, 'safety');
  // A blunder whose saved mistake has another kind is not a safety loss.
  const tactic = lostGame({ evals: { 8: 100, 9: -550 } });
  const state = stateWith({ reviews: [tactic], mistakes: [mistakeFor(tactic, 'missed-tactic')] });
  assert.equal(classifyLoss(tactic, null, state).chess, 'opening');
  // A mistake (not a blunder) with no saved kind is not safety either.
  const slip = review({ evals: { 8: 100, 9: -550 }, marks: [{ ply: 8, cls: 'mistake', loss: 60 }] });
  assert.equal(classifyLoss(slip, null, stateWith({ reviews: [slip] })).chess, 'opening');
});

test('classifyLoss: a flagged ledger row without a review is clock; an unflagged one is nothing', () => {
  const flagged = row({ term: 'time' });
  const state = stateWith({ ledger: [flagged] });
  assert.deepEqual(classifyLoss(null, flagged, state), { chess: 'clock', tilt: false });
  assert.deepEqual(classifyLoss(null, row({ term: 'resign' }), state), { chess: null, tilt: false });
  assert.deepEqual(classifyLoss(null, null, state), { chess: null, tilt: false });
  // A win on time is not a clock loss.
  assert.deepEqual(classifyLoss(null, row({ term: 'time', r: 1 }), state), { chess: null, tilt: false });
  // A review without marks is as good as no review.
  assert.deepEqual(classifyLoss(review(), flagged, state), { chess: 'clock', tilt: false });
});

test('classifyLoss: clock from the flag, from time trouble, or late with under 20 seconds', () => {
  const tactic = kind => {
    const r = lostGame({ evals: { 8: 100, 9: -550 }, ...kind });
    return { r, state: stateWith({ reviews: [r], mistakes: [mistakeFor(r, 'missed-tactic')] }) };
  };
  const a = tactic({});
  assert.equal(classifyLoss(a.r, row({ term: 'time' }), a.state).chess, 'clock');
  const b = tactic({ clocks: clocksWith(15, 5), tc: TC }); // 15 s left before the move, 10 s spent
  assert.equal(classifyLoss(b.r, null, b.state).chess, 'clock');
  const c = tactic({ clocks: clocksWith(30, 20), tc: TC }); // exactly the trouble threshold is not trouble
  assert.equal(classifyLoss(c.r, null, c.state).chess, 'opening');
  // Ply 62 with 19 s left, in a 10+0 game where 19 s is already trouble: a clock loss.
  const moves = new Array(70).fill('a3');
  const clocks = new Array(70).fill(100);
  clocks[60] = 19;
  clocks[62] = 9;
  const late = review({
    moves,
    clocks,
    tc: { base: 600, inc: 0 },
    evals: { 62: 100, 63: -550 },
    marks: [{ ply: 62, cls: 'mistake', loss: 60 }],
  });
  assert.equal(classifyLoss(late, null, stateWith({ reviews: [late] })).chess, 'clock');
  // Safety and rushed come before the clock.
  const hung = lostGame();
  assert.equal(classifyLoss(hung, row({ term: 'time' }), stateWith({ reviews: [hung] })).chess, 'safety');
});

test('classifyLoss: convert when winning earlier, opening under ply 20, else calc', () => {
  const make = (ply, evals, moves = MOVES) => {
    const r = lostGame({ moves, evals, marks: [{ ply, cls: 'blunder', loss: 60, mistakeId: 'x' }] });
    r.marks[0].mistakeId = 'm' + r.id.slice(1);
    return { r, state: stateWith({ reviews: [r], mistakes: [mistakeFor(r, 'missed-tactic')] }) };
  };
  const long = new Array(30).fill('a3');
  const winning = make(8, { 8: 320, 9: -550 });
  assert.equal(classifyLoss(winning.r, null, winning.state).chess, 'convert');
  const earlier = make(12, { 3: 250, 12: 100, 13: -550 }, long);
  assert.equal(classifyLoss(earlier.r, null, earlier.state).chess, 'convert');
  const opening = make(12, { 12: 100, 13: -550 }, long);
  assert.equal(classifyLoss(opening.r, null, opening.state).chess, 'opening');
  const last = make(19, { 19: 100, 20: -550 }, long);
  assert.equal(classifyLoss(last.r, null, last.state).chess, 'opening');
  const calc = make(20, { 20: 100, 21: -550 }, long);
  assert.equal(classifyLoss(calc.r, null, calc.state).chess, 'calc');
});

test('classifyLoss: tilt for a quick row and for the fifth game of a sitting, on top of the chess category', () => {
  // Three games 1 minute apart: the second and third start straight after a loss.
  const quick = games('LLL', { gap: 300000 + MIN });
  let state = stateFor(quick, { 2: {} });
  const c = classifyLoss(state.reviews[0], quick[2], state);
  assert.deepEqual(c, { chess: 'safety', tilt: true });
  assert.deepEqual(classifyLoss(null, quick[0], state), { chess: null, tilt: false });
  assert.deepEqual(classifyLoss(null, quick[1], state), { chess: null, tilt: true });
  // Five games 5 minutes apart: the same sitting, never quick; the fifth is tilt, the fourth is not.
  const deep = games('WWWWL', { gap: 300000 + 5 * MIN });
  state = stateWith({ ledger: deep });
  assert.deepEqual(classifyLoss(null, deep[4], state), { chess: null, tilt: true });
  assert.deepEqual(classifyLoss(null, deep[3], state), { chess: null, tilt: false });
  // An annotated row is read as it is.
  const rows = annotate(deep);
  assert.equal(classifyLoss(null, rows[4], stateWith()).tilt, true);
  assert.equal(classifyLoss(null, rows[3], stateWith()).tilt, false);
  // A quick game that was not lost is not a loss at all here, but the flag still reads.
  const won = games('LW', { gap: 300000 + MIN });
  assert.equal(classifyLoss(null, won[1], stateWith({ ledger: won })).tilt, true);
});

test('reviewFor links a row to its review by game key or Site header', () => {
  const r = row({ k: 'lichess.org/abcd1234' });
  const byKey = review({ gameKey: 'lichess.org/abcd1234' });
  assert.equal(reviewFor(stateWith({ reviews: [review(), byKey] }), r), byKey);
  const bySite = review({ gameKey: 'moves:xyz', site: 'https://lichess.org/abcd1234/black' });
  assert.equal(reviewFor(stateWith({ reviews: [bySite] }), r), bySite);
  const chesscom = review({ gameKey: 'moves:xyz', site: 'Chess.com' });
  assert.equal(reviewFor(stateWith({ reviews: [chesscom] }), r), null);
  assert.equal(reviewFor(stateWith(), r), null);
  assert.equal(reviewFor(stateWith(), null), null);
});

test('diagnoseStreak: no main control means no leak and no streak mode', () => {
  const d = diagnoseStreak(stateWith(), { now: NOW });
  assert.equal(d.control, null);
  assert.equal(d.leak, null);
  assert.equal(d.line, null);
  assert.equal(d.counted, 0);
  assert.deepEqual(d.losses, []);
  assert.deepEqual(d.examples, []);
  assert.equal(streakMode(stateWith(), NOW), false);
  // Rows without a control count for nothing.
  const s = stateWith({ ledger: games('LLLLL', { tc: null }) });
  assert.equal(diagnoseStreak(s, { now: NOW }).control, null);
  assert.equal(streakMode(s, NOW), false);
});

test('diagnoseStreak: under 4 counted losses the leak stays null', () => {
  const ledger = games('LLLLLLLLLL');
  const s = stateFor(ledger, { 9: {}, 8: {}, 7: {} });
  const d = diagnoseStreak(s, { now: NOW });
  assert.equal(d.control, 'blitz');
  assert.equal(d.games10, 10);
  assert.equal(d.lost10, 10);
  assert.equal(d.score10, 0);
  assert.equal(d.run, 10);
  assert.equal(d.losses.length, 10);
  assert.equal(d.counted, 3);
  assert.equal(d.counts.safety, 3);
  assert.equal(d.leak, null);
  assert.equal(d.share, null);
  assert.equal(d.habit, null);
  assert.equal(d.line, null);
  assert.deepEqual(d.examples, []);
  // One more reviewed loss and the leak appears.
  const four = diagnoseStreak(stateFor(ledger, { 9: {}, 8: {}, 7: {}, 6: {} }), { now: NOW });
  assert.equal(four.counted, 4);
  assert.equal(four.leak, 'safety');
  assert.equal(four.share, 1);
  assert.equal(four.habit, HABIT);
});

test('diagnoseStreak: the leak needs 40% of the counted losses', () => {
  const ledger = games('LLLLLLLLLL');
  // 3 of 8: 3 safety reviews, 5 flagged losses with no review (clock) → clock leads, but 3 safety is 0.375.
  for (const i of [0, 1, 2, 3, 4]) ledger[i].term = 'time';
  const clock = diagnoseStreak(stateFor(ledger, { 9: {}, 8: {}, 7: {} }), { now: NOW });
  assert.equal(clock.counted, 8);
  assert.deepEqual([clock.counts.safety, clock.counts.clock], [3, 5]);
  assert.equal(clock.leak, 'clock');
  assert.equal(clock.share, 5 / 8);
  // 3 of 8 with the other 5 split: safety 3 (0.375), calc 3? No: 3 flagged, 2 convert → safety ties at 3 but 3/8 < 0.40.
  const spread = games('LLLLLLLLLL');
  for (const i of [0, 1, 2]) spread[i].term = 'time';
  const split = diagnoseStreak(stateFor(spread, { 9: {}, 8: {}, 7: {}, 6: { kind: 'missed-tactic' }, 5: { kind: 'missed-tactic' } }), {
    now: NOW,
  });
  assert.equal(split.counted, 8);
  assert.deepEqual([split.counts.safety, split.counts.clock, split.counts.convert], [3, 3, 2]);
  assert.equal(split.leak, null);
  // 4 of 10: safety 4, clock 3, convert 3 → 0.40 exactly, the leak.
  const ten = games('LLLLLLLLLL');
  for (const i of [0, 1, 2]) ten[i].term = 'time';
  const d = diagnoseStreak(
    stateFor(ten, { 9: {}, 8: {}, 7: {}, 6: {}, 5: { kind: 'missed-tactic' }, 4: { kind: 'missed-tactic' }, 3: { kind: 'missed-tactic' } }),
    { now: NOW },
  );
  assert.equal(d.counted, 10);
  assert.deepEqual([d.counts.safety, d.counts.clock, d.counts.convert], [4, 3, 3]);
  assert.equal(d.leak, 'safety');
  assert.equal(d.share, 0.4);
  // 2 of 5 is 0.40 too.
  const five = games('LLLLL');
  five[0].term = 'time';
  five[1].term = 'time';
  five[2].term = 'time';
  const two = diagnoseStreak(stateFor(five, { 4: { kind: 'missed-tactic' }, 3: { kind: 'missed-tactic' } }), { now: NOW });
  assert.equal(two.counted, 5);
  assert.equal(two.counts.clock, 3);
  assert.equal(two.leak, 'clock');
  assert.equal(two.share, 0.6);
});

test('diagnoseStreak: ties resolve by LEAK_ORDER', () => {
  const ledger = games('LLLLLLLL');
  for (const i of [0, 1, 2, 3]) ledger[i].term = 'time';
  const d = diagnoseStreak(stateFor(ledger, { 7: {}, 6: {}, 5: {}, 4: {} }), { now: NOW });
  assert.deepEqual([d.counts.safety, d.counts.clock], [4, 4]);
  assert.equal(d.leak, 'safety');
  // convert before opening before calc.
  const long = new Array(30).fill('a3');
  const mixed = games('LLLLLLLL');
  const d2 = diagnoseStreak(
    stateFor(mixed, {
      7: { kind: 'missed-tactic', evals: { 20: 100, 21: -550 }, moves: long, marks: [{ ply: 20, cls: 'blunder', loss: 60 }] },
      6: { kind: 'missed-tactic', evals: { 20: 100, 21: -550 }, moves: long, marks: [{ ply: 20, cls: 'blunder', loss: 60 }] },
      5: { kind: 'missed-tactic', evals: { 12: 100, 13: -550 }, moves: long, marks: [{ ply: 12, cls: 'blunder', loss: 60 }] },
      4: { kind: 'missed-tactic', evals: { 12: 100, 13: -550 }, moves: long, marks: [{ ply: 12, cls: 'blunder', loss: 60 }] },
    }),
    { now: NOW },
  );
  assert.deepEqual([d2.counts.opening, d2.counts.calc], [2, 2]);
  assert.equal(d2.leak, 'opening');
});

test('diagnoseStreak: ledger-only losses count for clock and for tilt', () => {
  const flagged = games('LLLLL', { term: 'time' });
  const clock = diagnoseStreak(stateWith({ ledger: flagged }), { now: NOW });
  assert.equal(clock.counted, 5);
  assert.equal(clock.leak, 'clock');
  assert.equal(clock.habit, 'Under 30 seconds, play the simple move at once.');
  assert.equal(
    clock.line,
    'Losing 5 of your last 5. The leak: 5 of 5 losses began with the clock. Habit: Under 30 seconds, play the simple move at once.',
  );
  assert.deepEqual(clock.examples, []);
  // Six losses a minute apart: five queued straight after a loss.
  const tilt = diagnoseStreak(stateWith({ ledger: games('LLLLLL', { gap: 300000 + MIN }) }), { now: NOW });
  assert.equal(tilt.counted, 5);
  assert.equal(tilt.counts.tilt, 5);
  assert.equal(tilt.leak, 'tilt');
  assert.equal(tilt.share, 1);
  assert.equal(
    tilt.line,
    'Losing 6 of your last 6. The leak: 5 of 5 losses began with a game queued straight after a loss. ' +
      'Habit: One loss: two minutes away from the board. Two losses in a row: stop for tonight.',
  );
  // Tilt is counted on top of the chess category: a reviewed quick loss counts for both.
  const both = games('LLLLLL', { gap: 300000 + MIN });
  const d = diagnoseStreak(stateFor(both, { 5: {}, 4: {}, 3: {}, 2: {} }), { now: NOW });
  assert.equal(d.counted, 5);
  assert.deepEqual([d.counts.safety, d.counts.tilt], [4, 5]);
  assert.equal(d.leak, 'tilt');
  assert.equal(d.examples.length, 4);
});

test('diagnoseStreak: examples are the leak’s decisive positions, newest first', () => {
  const ledger = games('LLLLLL');
  ledger[0].term = 'time';
  const s = stateFor(ledger, { 5: {}, 3: {}, 1: {}, 4: { kind: 'missed-tactic' }, 2: {} });
  const d = diagnoseStreak(s, { now: NOW });
  assert.equal(d.leak, 'safety');
  const id = i => s.reviews.find(r => r.gameKey === ledger[i].k).id;
  assert.deepEqual(d.examples, [
    { reviewId: id(5), ply: 8 },
    { reviewId: id(3), ply: 8 },
    { reviewId: id(2), ply: 8 },
    { reviewId: id(1), ply: 8 },
  ]);
  assert.deepEqual(
    d.losses.map(l => [l.row.k, l.reviewId, l.chess, l.tilt, l.ply]),
    [
      [ledger[5].k, id(5), 'safety', false, 8],
      [ledger[4].k, id(4), 'convert', false, 8],
      [ledger[3].k, id(3), 'safety', false, 8],
      [ledger[2].k, id(2), 'safety', false, 8],
      [ledger[1].k, id(1), 'safety', false, 8],
      [ledger[0].k, null, 'clock', false, null],
    ],
  );
});

test('diagnoseStreak: the line text is exact', () => {
  // The last 10 games: 7 losses and 3 wins; 3 older losses within 30 days make 10 losses, 8 of them counted.
  const ledger = games('LLLWLLLLWWLLL');
  for (const i of [0, 1, 2]) ledger[i].term = 'time';
  const s = stateFor(ledger, { 12: {}, 11: {}, 10: {}, 7: {}, 6: {} });
  const d = diagnoseStreak(s, { now: NOW });
  assert.equal(d.games10, 10);
  assert.equal(d.lost10, 7);
  assert.equal(d.losses.length, 10);
  assert.equal(d.counted, 8);
  assert.equal(d.counts.safety, 5);
  assert.equal(d.counts.clock, 3);
  assert.equal(d.leak, 'safety');
  assert.equal(d.share, 5 / 8);
  assert.equal(d.habit, HABIT);
  assert.equal(d.line, `Losing 7 of your last 10. The leak: 5 of 8 losses began with a piece hung in one move. Habit: ${HABIT}`);
  assert.equal(leakLine(d), d.line);
  assert.equal(streakMode(s, NOW), true);
});

test('diagnoseStreak: only the main control, only losses within 30 days, at most 10 of them', () => {
  // Fourteen blitz losses two days apart: the oldest four are past 30 days, and only ten are read anyway.
  const ledger = games('LLLLLLLLLLLLLL', { gap: 2 * DAY });
  const d = diagnoseStreak(stateFor(ledger, Object.fromEntries(ledger.map((_, i) => [i, {}]))), { now: NOW });
  assert.equal(d.losses.length, 10);
  assert.equal(d.losses[0].row.k, ledger[13].k);
  assert.equal(d.losses[9].row.k, ledger[4].k);
  // Exactly 30 days old is in; a day more is out.
  const edge = games('LLLLL', { gap: 10 * DAY });
  edge[0].t = NOW - 31 * DAY;
  edge[1].t = NOW - 30 * DAY;
  const e = diagnoseStreak(stateWith({ ledger: edge }), { now: NOW });
  assert.equal(e.losses.length, 4);
  assert.equal(e.losses[3].row.k, edge[1].k);
  // The `losses` option reads fewer.
  assert.equal(diagnoseStreak(stateWith({ ledger: edge }), { now: NOW, losses: 2 }).losses.length, 2);
  // Rapid losses do not count against a blitz player; wins are not losses.
  const mixed = [...games('LLLLLWW'), ...games('LLL', { tc: 'rapid', term: 'time', end: NOW - 1000 })];
  const m = diagnoseStreak(stateWith({ ledger: mixed }), { now: NOW });
  assert.equal(m.control, 'blitz');
  assert.equal(m.losses.length, 5);
  assert.equal(m.counts.clock, 0);
});

test('diagnoseStreak: the rushed label uses the main control’s most common base', () => {
  const rushed = base => {
    const ledger = games('LLLLL', { base });
    const tc = { base, inc: 0 };
    // Every reviewed loss: 1 second on the losing move.
    const s = stateFor(ledger, Object.fromEntries(ledger.map((_, i) => [i, { clocks: clocksWith(base - 20, base - 21), tc }])));
    return diagnoseStreak(s, { now: NOW });
  };
  const five = rushed(300);
  assert.equal(five.leak, 'rushed');
  assert.equal(five.base, 300);
  assert.equal(five.label, 'a move played in under 4.5 seconds');
  assert.equal(
    five.line,
    'Losing 5 of your last 5. The leak: 5 of 5 losses began with a move played in under 4.5 seconds. ' +
      'Habit: At every capture and check, count three before you touch the piece.',
  );
  const three = rushed(180);
  assert.equal(three.base, 180);
  assert.equal(three.label, 'a move played in under 3 seconds');
  assert.match(three.line, /began with a move played in under 3 seconds\./);
  // The most common base wins; rows without a base fall back to 5+0.
  const ledger = [...games('LL', { base: 180, end: NOW - DAY }), ...games('LLL', { base: 300 })];
  assert.equal(diagnoseStreak(stateWith({ ledger }), { now: NOW }).base, 300);
  assert.equal(diagnoseStreak(stateWith({ ledger: games('LLL', { base: null }) }), { now: NOW }).base, 300);
  // Other leaks keep their fixed label.
  assert.equal(diagnoseStreak(stateWith({ ledger: games('LLLL', { term: 'time' }) }), { now: NOW }).label, 'the clock');
});

test('streakMode: on at a score of 0.40 with 8 games, off above it', () => {
  assert.equal(streakMode(stateWith({ ledger: games('LLLLLLWWWW') }), NOW), true); // 4 of 10
  assert.equal(streakMode(stateWith({ ledger: games('LLLLLDWWWW') }), NOW), false); // 4.5 of 10
  assert.equal(streakMode(stateWith({ ledger: games('LLLLLWWW') }), NOW), true); // 3 of 8 = 0.375
  assert.equal(streakMode(stateWith({ ledger: games('LLLLDWWW') }), NOW), false); // 3.5 of 8 = 0.4375
  // Only the last 10 games count: ten wins before a losing ten is still a streak, and the reverse is not.
  assert.equal(streakMode(stateWith({ ledger: games('WWWWWWWWWWLLLLLLWWWW') }), NOW), true);
  assert.equal(streakMode(stateWith({ ledger: games('LLLLLLLLLLWWWWWWWWWW') }), NOW), false);
});

test('streakMode: on at a loss run of 3 within 7 days, off at 8 days or under 3', () => {
  assert.equal(streakMode(stateWith({ ledger: games('WWWWLLL') }), NOW), true);
  assert.equal(streakMode(stateWith({ ledger: games('WWWWWLL') }), NOW), false);
  assert.equal(streakMode(stateWith({ ledger: games('WWWWLLL', { end: NOW - 7 * DAY }) }), NOW), true);
  assert.equal(streakMode(stateWith({ ledger: games('WWWWLLL', { end: NOW - 8 * DAY }) }), NOW), false);
  // A run ended by a win in another control still counts in the main one; a run in another control does not.
  const blitz = games('WWWWLLL', { end: NOW - HOUR });
  assert.equal(streakMode(stateWith({ ledger: [...blitz, row({ r: 1, tc: 'rapid' })] }), NOW), true);
  const rapidRun = games('LLL', { tc: 'rapid' });
  assert.equal(streakMode(stateWith({ ledger: [...games('WWWWWWWW', { end: NOW - HOUR }), ...rapidRun] }), NOW), false);
});

test('streakMode: off under 8 games without a run', () => {
  assert.equal(streakMode(stateWith({ ledger: games('LWLWLWL') }), NOW), false);
  assert.equal(streakMode(stateWith({ ledger: games('LLWLLWL') }), NOW), false);
  assert.equal(streakMode(stateWith({ ledger: games('L') }), NOW), false);
  // Out-of-order rows are read in time order.
  const shuffled = games('WWWWLLL').reverse();
  assert.equal(streakMode(stateWith({ ledger: shuffled }), NOW), true);
});

test('leakLine is null without a leak', () => {
  assert.equal(leakLine(null), null);
  assert.equal(leakLine(diagnoseStreak(stateWith(), { now: NOW })), null);
  assert.equal(leakLine({ leak: null }), null);
  const d = { leak: 'clock', lost10: 6, games10: 9, counted: 4, counts: { clock: 2 } };
  assert.equal(
    leakLine(d),
    'Losing 6 of your last 9. The leak: 2 of 4 losses began with the clock. Habit: Under 30 seconds, play the simple move at once.',
  );
});

test('lossAnatomy on the v4 fixture', () => {
  assert.equal(lossAnatomy(lostGame(), stateWith()), 'Lost at move 5 (opening), from +3.2.');
  assert.equal(lossAnatomy(lostGame({ clocks: clocksWith(14, 12), tc: TC })), 'Lost at move 5 (opening), from +3.2, with 0:14 left.');
  assert.equal(lossAnatomy(lostGame({ evals: { 8: 100, 9: -550 } })), 'Lost at move 5 (opening).');
  // The best earlier eval, not the one before the error.
  assert.equal(lossAnatomy(lostGame({ evals: { 3: 410, 8: 210, 9: -550 } })), 'Lost at move 5 (opening), from +4.1.');
  // Black's move numbers and evals from Black's side.
  const black = review({ colour: 'b', result: '1-0', evals: { 7: -320, 8: 550 }, marks: [{ ply: 7, cls: 'blunder', loss: 60 }] });
  assert.equal(lossAnatomy(black), 'Lost at move 4 (opening), from +3.2.');
  // A game from a position: the move number counts from there, and the phase is read from the board.
  const endgame = review({
    startFen: '8/8/4k3/8/8/4K3/4P3/8 w - - 0 40',
    moves: ['Kd4', 'Kd6'],
    evals: { 0: 100, 1: -550 },
    marks: [{ ply: 0, cls: 'blunder', loss: 60 }],
  });
  assert.equal(lossAnatomy(endgame), 'Lost at move 40 (endgame).');
  assert.equal(lossAnatomy(review()), null);
  assert.equal(lossAnatomy(lostGame({ result: '1-0' })), null);
  assert.equal(lossAnatomy(null), null);
});

test('windowHeadline: null under 10 games, exact text at 26', () => {
  const nine = games('WWWWLLLLD');
  assert.equal(windowHeadline(nine, { now: NOW }), null);
  const ten = games('WWWWLLLLLD');
  assert.equal(windowHeadline(ten, { now: NOW }), 'Last 14 days: 4 wins, 5 losses, 1 draw (45%).');
  const twentySix = games('W'.repeat(9) + 'L'.repeat(16) + 'D');
  assert.equal(windowHeadline(twentySix, { now: NOW }), 'Last 14 days: 9 wins, 16 losses, 1 draw (37%).');
  // No draws: the draw count is left out; one win or one loss reads in the singular.
  assert.equal(windowHeadline(games('WLLLLLLLLL'), { now: NOW }), 'Last 14 days: 1 win, 9 losses (10%).');
  assert.equal(windowHeadline(games('LWWWWWWWWW'), { now: NOW }), 'Last 14 days: 9 wins, 1 loss (90%).');
  // The window: games older than 14 days are out, 14 days exactly is in; `days` changes the text.
  const spread = games('W'.repeat(12), { gap: DAY });
  assert.equal(windowHeadline(spread, { now: NOW }), 'Last 14 days: 12 wins, 0 losses (100%).');
  // The oldest of the 12 ended 11 days ago: 5 days on, 10 are in (14 days exactly is in); 6 days on, 9 are.
  assert.equal(windowHeadline(spread, { now: NOW + 5 * DAY }), 'Last 14 days: 10 wins, 0 losses (100%).');
  assert.equal(windowHeadline(spread, { now: NOW + 6 * DAY }), null);
  assert.equal(windowHeadline(spread, { now: NOW, days: 7 }), null);
  assert.equal(windowHeadline(games('W'.repeat(10), { gap: HOUR }), { now: NOW, days: 7 }), 'Last 7 days: 10 wins, 0 losses (100%).');
  assert.equal(windowHeadline([], { now: NOW }), null);
  // One control when asked.
  const mixed = [...games('WWWWWWWWWW', { tc: 'rapid', end: NOW - DAY }), ...games('LLLLLLLLLL')];
  assert.equal(windowHeadline(mixed, { now: NOW, control: 'blitz' }), 'Last 14 days: 0 wins, 10 losses (0%).');
  assert.equal(windowHeadline(mixed, { now: NOW }), 'Last 14 days: 10 wins, 10 losses (50%).');
});
