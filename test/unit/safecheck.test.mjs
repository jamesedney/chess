import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../../vendor/chess.js';
import { winPercentLoss } from '../../src/evaluation.js';
import {
  SAFE_SECONDS,
  PASS,
  MIN_ITEMS,
  MAX_LAST,
  isTense,
  isHangingMark,
  safeBank,
  hasSafeBank,
  safeItems,
  judgeSafe,
  runSummary,
  recordSafeRun,
  safeStats,
} from '../../src/safecheck.js';
import { review, lostGame, mistakeFor, stateWith, NOW, DAY, FEN_BEFORE_NXF7 } from './fixtures-v5.mjs';

// After 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6 4.Ng5 d5 5.exd5 Nxd5 6.Nxf7: Black can take the knight.
const CAPTURE_FEN = 'r1bqkb1r/ppp2Npp/2n5/3np3/2B5/8/PPPP1PPP/RNBQK2R b KQkq - 0 6';
// After 1.e4 e5 2.f3: Qh4+ is the only forcing move, no capture at all.
const CHECK_FEN = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5P2/PPPP2PP/RNBQKBNR b KQkq - 0 2';
// After 1.e4 e5 2.Nf3 Nc6 3.Bb5: nothing to take, no check.
const QUIET_FEN = 'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3';
// The lost game after 5. Nxf7??: Black to move, Qxg2 wins.
const AFTER_NXF7 = 'r1b1kbnr/pppp1Npp/8/6q1/2BnP3/8/PPPP1PPP/RNBQK2R b KQkq - 0 5';

// An Italian where every White move from 4. d3 on leaves Black a capture or a check.
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
const TENSE_USER_PLIES = [6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32];
const flatEvals = (moves, value = 0) => Object.fromEntries(moves.map((_, i) => [i, value]).concat([[moves.length, value]]));

/** A game full of safe, tense moves: every evaluation equal. */
function safeGame(opts = {}) {
  return review({ moves: TENSE_MOVES, evals: flatEvals(TENSE_MOVES), result: '1/2-1/2', ...opts });
}

const ids = items => items.map(it => it.id);
const answers = items => items.map(it => it.answer);
const opts = extra => ({ Chess, rng: () => 0, now: NOW, ...extra });

test('constants match the spec', () => {
  assert.equal(SAFE_SECONDS, 5);
  assert.deepEqual(PASS, { accuracy: 0.7, medianMs: 3500 });
  assert.equal(MIN_ITEMS, 6);
  assert.equal(MAX_LAST, 50);
});

// ---------- isTense ----------

test('isTense: a capture of a piece, a check only, neither, a bad position', () => {
  assert.equal(isTense(CAPTURE_FEN, Chess), true);
  assert.equal(isTense(CHECK_FEN, Chess), true);
  assert.equal(isTense(QUIET_FEN, Chess), false);
  assert.equal(isTense('not a position', Chess), false);
});

test('isTense: a pawn capture alone is not tension', () => {
  // 1.d4 d5 2.c4: Black can only take a pawn, no checks.
  const fen = 'rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR b KQkq c3 0 2';
  assert.equal(isTense(fen, Chess), false);
});

// ---------- isHangingMark ----------

test('isHangingMark: kind, capture refute, quiet refute, missing refute', () => {
  const r = lostGame();
  const mark = r.marks[0];
  const hung = mistakeFor(r, 'hung-piece');
  const positional = mistakeFor(r, 'positional');
  assert.equal(isHangingMark(mark, hung, AFTER_NXF7, Chess), true, 'hung-piece kind');
  assert.equal(isHangingMark(mark, mistakeFor(r, 'allowed-mate'), AFTER_NXF7, Chess), true, 'allowed-mate kind');
  assert.equal(isHangingMark(mark, positional, AFTER_NXF7, Chess), true, 'Qxg2 is a capture');
  assert.equal(isHangingMark({ ...mark, refute: 'g5e7' }, positional, AFTER_NXF7, Chess), false, 'Qe7 is quiet');
  assert.equal(isHangingMark({ ...mark, refute: 'g5e7' }, null, AFTER_NXF7, Chess), false, 'quiet and no kind');
  assert.equal(isHangingMark({ ...mark, refute: null }, hung, AFTER_NXF7, Chess), false, 'no refute');
  assert.equal(isHangingMark({ ...mark, refute: undefined }, hung, AFTER_NXF7, Chess), false, 'refute never set');
  assert.equal(isHangingMark({ ...mark, cleared: true }, hung, AFTER_NXF7, Chess), false, 'cleared');
  assert.equal(isHangingMark({ ...mark, cls: 'mistake' }, hung, AFTER_NXF7, Chess), false, 'not a blunder');
  assert.equal(isHangingMark(null, hung, AFTER_NXF7, Chess), false);
});

test('isHangingMark: a check refute counts; an old mistake without a kind reads its explanation', () => {
  // 1.e4 e5 2.f3?? and Black's Qh4+ is a check that captures nothing.
  const mark = { ply: 2, cls: 'blunder', loss: 35, refute: 'd8h4' };
  assert.equal(isHangingMark(mark, { kind: 'positional' }, CHECK_FEN, Chess), true);
  const quiet = { ...mark, refute: 'g8f6' };
  assert.equal(isHangingMark(quiet, { kind: 'positional' }, CHECK_FEN, Chess), false);
  assert.equal(isHangingMark(quiet, { explanation: 'f3 left your king on e1 exposed: Qh4+ wins material.' }, CHECK_FEN, Chess), true);
  assert.equal(isHangingMark({ ...quiet, explanation: 'f3 allowed a forced mate in 3.' }, null, CHECK_FEN, Chess), true);
  assert.equal(isHangingMark({ ...quiet, refute: 'zz99' }, { kind: 'positional' }, CHECK_FEN, Chess), false, 'illegal refute');
});

// ---------- safeItems ----------

test('safeItems: empty state gives nothing', () => {
  assert.deepEqual(safeItems(stateWith(), opts()), []);
  assert.deepEqual(safeItems(stateWith({ reviews: [review({ evals: {} })] }), opts()), []);
  assert.deepEqual(safeBank(stateWith(), opts()), { hanging: [], safe: [] });
});

test('safeItems: a hanging item carries the position, the played move and the refutation', () => {
  const r = lostGame();
  const items = safeItems(stateWith({ reviews: [r] }), opts());
  assert.equal(items.length, 1);
  const it = items[0];
  assert.deepEqual(it, {
    id: r.id + ':8',
    reviewId: r.id,
    ply: 8,
    fen: FEN_BEFORE_NXF7,
    played: 'Nxf7',
    uci: 'e5f7',
    opponent: 'rival',
    colour: 'w',
    answer: 'hanging',
    refute: 'g5g2',
    refuteSan: 'Qxg2',
    bestSan: 'Bxf7+',
    loss: 60,
    explanation: 'Bxf7+ wins the queen after Kd8 Nxg5.',
    needsRefute: false,
  });
});

test('safeItems: a safe item comes from a tense user ply with both evals known and under 5 points lost', () => {
  const g = safeGame();
  const items = safeItems(stateWith({ reviews: [g] }), opts({ limit: 100 }));
  assert.deepEqual(
    items.map(it => it.ply),
    TENSE_USER_PLIES,
  );
  assert.ok(items.every(it => it.answer === 'safe' && it.refute === null && it.refuteSan === null && !it.needsRefute));
  const first = items[0];
  assert.equal(first.id, g.id + ':6');
  assert.equal(first.played, 'd3');
  assert.equal(first.uci, 'd2d3');
  assert.equal(first.bestSan, 'd3');
  assert.equal(first.loss, 0);
  assert.equal(first.opponent, 'rival');
  assert.equal(first.explanation, null);
  assert.equal(first.fen.split(' ')[1], 'w');
});

test('safeItems: safes need both evals known', () => {
  const g = review({ moves: TENSE_MOVES, evals: { 6: 0, 7: 0, 8: 0, 10: 0, 11: 0 } });
  const items = safeItems(stateWith({ reviews: [g] }), opts({ limit: 100 }));
  // Ply 8 lacks the eval after it; ply 10 lacks the eval before it is not the issue, ply 9 is: 10 needs evals[10] and [11].
  assert.deepEqual(
    items.map(it => it.ply),
    [6, 10],
  );
});

test('safeItems: the 5-point line is measured from the mover, both colours', () => {
  const change = after => winPercentLoss(0, -after);
  assert.ok(change(-54) < 5 && change(-55) >= 5, 'the test positions sit either side of the line');
  const under = review({ moves: TENSE_MOVES, evals: { 6: 0, 7: -54 } });
  const over = review({ moves: TENSE_MOVES, evals: { 6: 0, 7: -55 } });
  const gain = review({ moves: TENSE_MOVES, evals: { 6: 0, 7: 300 } });
  assert.equal(safeItems(stateWith({ reviews: [under] }), opts()).length, 1);
  assert.equal(safeItems(stateWith({ reviews: [over] }), opts()).length, 0);
  assert.equal(safeItems(stateWith({ reviews: [gain] }), opts()).length, 1, 'improving is never a loss');
  // Black's plies: White's evaluation rising is Black's loss. Ply 7 (Bc5) leaves White a capture or check.
  const blackOk = review({ colour: 'b', moves: TENSE_MOVES, evals: { 7: 100, 8: 100 } });
  const blackBad = review({ colour: 'b', moves: TENSE_MOVES, evals: { 7: 0, 8: 130 } });
  const blackGain = review({ colour: 'b', moves: TENSE_MOVES, evals: { 7: 130, 8: 0 } });
  const black = safeItems(stateWith({ reviews: [blackOk] }), opts());
  assert.equal(black.length, 1);
  assert.equal(black[0].ply, 7);
  assert.equal(black[0].played, 'Bc5');
  assert.equal(black[0].colour, 'b');
  assert.equal(black[0].opponent, 'rival');
  assert.equal(safeItems(stateWith({ reviews: [blackBad] }), opts()).length, 0);
  assert.equal(safeItems(stateWith({ reviews: [blackGain] }), opts()).length, 1);
});

test('safeItems: a quiet ply is never a safe item', () => {
  // 3. Bc4 (ply 4) leaves Black nothing to take and no check.
  const g = review({ moves: TENSE_MOVES, evals: { 4: 0, 5: 0 } });
  assert.equal(safeItems(stateWith({ reviews: [g] }), opts()).length, 0);
});

test('safeItems: marked plies are not safe unless the mark is an inaccuracy', () => {
  const marked = review({ moves: TENSE_MOVES, evals: { 6: 0, 7: 0 }, marks: [{ ply: 6, cls: 'mistake' }] });
  assert.equal(safeItems(stateWith({ reviews: [marked] }), opts()).length, 0);
  const cleared = review({ moves: TENSE_MOVES, evals: { 6: 0, 7: 0 }, marks: [{ ply: 6, cls: 'blunder', refute: 'c5f2', cleared: true }] });
  assert.equal(safeItems(stateWith({ reviews: [cleared] }), opts()).length, 0, 'a cleared mark is still a mark');
  const inacc = review({ moves: TENSE_MOVES, evals: { 6: 0, 7: 0 }, marks: [{ ply: 6, cls: 'inaccuracy', loss: 12, bestSan: 'd4' }] });
  const items = safeItems(stateWith({ reviews: [inacc] }), opts());
  assert.equal(items.length, 1);
  assert.equal(items[0].answer, 'safe');
  assert.equal(items[0].bestSan, 'd4');
});

test('safeItems: a blunder with a quiet refutation and no hanging kind is left out', () => {
  const r = lostGame();
  r.marks[0].refute = 'g5e7';
  const s = stateWith({ reviews: [r] });
  s.mistakes[0].kind = 'positional';
  assert.deepEqual(safeItems(s, opts()), []);
  s.mistakes[0].kind = 'hung-piece';
  assert.equal(safeItems(s, opts()).length, 1);
});

test('safeItems: a pre-5.0 mark without a refutation is hanging by kind and needs one', () => {
  const r = lostGame();
  delete r.marks[0].refute;
  const items = safeItems(stateWith({ reviews: [r] }), opts());
  assert.equal(items.length, 1);
  assert.equal(items[0].answer, 'hanging');
  assert.equal(items[0].needsRefute, true);
  assert.equal(items[0].refute, null);
  assert.equal(items[0].refuteSan, null);
  // The same mark with a positional kind has nothing to say it hangs.
  const s = stateWith({ reviews: [r] });
  s.mistakes[0].kind = 'positional';
  assert.deepEqual(safeItems(s, opts()), []);
  // A stored refutation that does not play is treated as missing.
  const bad = lostGame();
  bad.marks[0].refute = 'a1a8';
  const [item] = safeItems(stateWith({ reviews: [bad] }), opts());
  assert.equal(item.needsRefute, true);
  assert.equal(item.refute, null);
});

test('safeItems: the explanation comes from the saved mistake, else the mark', () => {
  const r = lostGame();
  const s = stateWith({ reviews: [r] });
  s.mistakes[0].explanation = 'Nxf7 left your knight on f7 exposed: Qxg2 wins material.';
  r.marks[0].explanation = 'older text';
  assert.equal(safeItems(s, opts())[0].explanation, 'Nxf7 left your knight on f7 exposed: Qxg2 wins material.');
  s.mistakes = [];
  assert.equal(safeItems(s, opts())[0].explanation, 'older text');
});

test('safeItems: half and half, alternating, hanging first, newest game first', () => {
  const lost = [0, 1, 2, 3, 4, 5].map(i => lostGame({ created: NOW - i * DAY }));
  const safe = safeGame({ created: NOW - 10 * DAY });
  const s = stateWith({ reviews: [safe, ...lost.slice().reverse()] }); // stored oldest first
  const items = safeItems(s, opts());
  assert.equal(items.length, 10);
  assert.deepEqual(answers(items), ['hanging', 'safe', 'hanging', 'safe', 'hanging', 'safe', 'hanging', 'safe', 'hanging', 'safe']);
  assert.deepEqual(
    items.filter(it => it.answer === 'hanging').map(it => it.reviewId),
    lost.slice(0, 5).map(r => r.id),
    'the five newest losses',
  );
  assert.deepEqual(
    items.filter(it => it.answer === 'safe').map(it => it.ply),
    [6, 8, 10, 12, 14],
  );
  assert.equal(new Set(ids(items)).size, 10, 'no duplicates');
});

test('safeItems: a short side lets the other fill the run', () => {
  const s = stateWith({ reviews: [safeGame(), lostGame(), lostGame()] });
  const items = safeItems(s, opts());
  assert.equal(items.length, 10);
  assert.deepEqual(answers(items), ['hanging', 'safe', 'hanging', 'safe', 'safe', 'safe', 'safe', 'safe', 'safe', 'safe']);
  const only = safeItems(stateWith({ reviews: [lostGame(), lostGame()] }), opts());
  assert.deepEqual(answers(only), ['hanging', 'hanging']);
  const onlySafe = safeItems(stateWith({ reviews: [safeGame()] }), opts({ limit: 4 }));
  assert.deepEqual(answers(onlySafe), ['safe', 'safe', 'safe', 'safe']);
  const odd = safeItems(stateWith({ reviews: [safeGame(), lostGame(), lostGame(), lostGame()] }), opts({ limit: 5 }));
  assert.deepEqual(answers(odd), ['hanging', 'safe', 'hanging', 'safe', 'hanging'], 'an odd limit gives hanging the extra one');
});

test('safeItems: first ids go first, count once and stay within the limit', () => {
  const lost = [0, 1, 2, 3].map(i => lostGame({ created: NOW - i * DAY }));
  const safe = safeGame({ created: NOW - 10 * DAY });
  const s = stateWith({ reviews: [...lost, safe] });
  const first = [safe.id + ':20', lost[3].id + ':8', 'nope:1', safe.id + ':20'];
  const items = safeItems(s, opts({ first }));
  assert.equal(items.length, 10);
  assert.deepEqual(ids(items).slice(0, 2), [safe.id + ':20', lost[3].id + ':8']);
  assert.equal(new Set(ids(items)).size, 10, 'no duplicates');
  assert.deepEqual(answers(items), ['safe', 'hanging', 'hanging', 'safe', 'hanging', 'safe', 'hanging', 'safe', 'safe', 'safe']);
  assert.equal(items.filter(it => it.answer === 'hanging').length, 4, 'all four losses, the first one not repeated');
  assert.equal(safeItems(s, opts({ first, limit: 1 })).length, 1);
});

test('safeItems: the rng only chooses among surplus; the chosen keep newest-first order', () => {
  const lost = [0, 1, 2, 3, 4, 5, 6, 7].map(i => lostGame({ created: NOW - i * DAY }));
  const s = stateWith({ reviews: [...lost, safeGame()] });
  const newest = safeItems(s, opts({ rng: () => 0 }));
  const other = safeItems(s, opts({ rng: () => 0.999 }));
  const created = items => items.filter(it => it.answer === 'hanging').map(it => lost.find(r => r.id === it.reviewId).created);
  assert.notDeepEqual(ids(newest), ids(other));
  for (const items of [newest, other]) {
    const c = created(items);
    assert.equal(c.length, 5);
    assert.deepEqual(
      c,
      [...c].sort((a, b) => b - a),
      'newest first',
    );
    assert.equal(new Set(ids(items)).size, 10);
  }
  assert.deepEqual(safeItems(s, opts({ rng: () => 0 })), newest, 'deterministic');
});

test('safeItems: reviews that are not complete or do not replay are skipped', () => {
  const partial = lostGame();
  partial.complete = false;
  const broken = safeGame();
  broken.moves = ['e4', 'e5', 'Qh9'];
  assert.deepEqual(safeItems(stateWith({ reviews: [partial, broken] }), opts()), []);
  const partlyBroken = review({ moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'd3', 'Bc5', 'Qh9'], evals: { 6: 0, 7: 0 } });
  assert.equal(safeItems(stateWith({ reviews: [partlyBroken] }), opts()).length, 1, 'plies before the bad move still count');
});

test('hasSafeBank: at least three of each and six in all', () => {
  const three = [lostGame(), lostGame(), lostGame()];
  const safes = n =>
    review({ moves: TENSE_MOVES, evals: flatEvals(TENSE_MOVES), marks: TENSE_USER_PLIES.slice(n).map(ply => ({ ply, cls: 'mistake' })) });
  assert.equal(hasSafeBank(stateWith({ reviews: [...three, safes(3)] }), opts()), true);
  assert.equal(hasSafeBank(stateWith({ reviews: [...three, safes(2)] }), opts()), false);
  assert.equal(hasSafeBank(stateWith({ reviews: [...three.slice(1), safes(10)] }), opts()), false);
  assert.equal(hasSafeBank(stateWith(), opts()), false);
  const bank = safeBank(stateWith({ reviews: [...three, safes(3)] }), opts());
  assert.equal(bank.hanging.length, 3);
  assert.equal(bank.safe.length, 3);
});

// ---------- judgeSafe ----------

function hangingItem(explanation = 'Bxf7+ wins the queen after Kd8 Nxg5.') {
  const r = lostGame();
  const s = stateWith({ reviews: [r] });
  s.mistakes[0].explanation = explanation;
  return safeItems(s, opts())[0];
}

function safeItem() {
  return safeItems(stateWith({ reviews: [safeGame()] }), opts())[0];
}

test('judgeSafe: hit, miss, false alarm, correct rejection and too slow', () => {
  const h = hangingItem();
  const s = safeItem();
  const hit = judgeSafe(h, 'hanging', 1200);
  assert.deepEqual(hit, {
    correct: true,
    kind: 'hit',
    text: 'Nxf7 lost 60% winning chances: Qxg2 punishes it.',
    truth: 'hanging',
    ms: 1200,
  });
  const miss = judgeSafe(h, 'safe', 2000);
  assert.equal(miss.correct, false);
  assert.equal(miss.kind, 'miss');
  assert.equal(miss.text, 'Nxf7 lost 60% winning chances: Qxg2 punishes it.');
  const cr = judgeSafe(s, 'safe', 900);
  assert.deepEqual(cr, { correct: true, kind: 'cr', text: 'Safe. Their best reply only kept the balance.', truth: 'safe', ms: 900 });
  const fa = judgeSafe(s, 'hanging', 900);
  assert.equal(fa.correct, false);
  assert.equal(fa.kind, 'fa');
  assert.equal(fa.text, 'Safe. Their best reply only kept the balance.');
  const slowH = judgeSafe(h, null, 5000);
  assert.equal(slowH.correct, false);
  assert.equal(slowH.kind, 'slow');
  assert.equal(slowH.text, 'Too slow: in a game that is a move. Nxf7 lost 60% winning chances: Qxg2 punishes it.');
  assert.equal(slowH.truth, 'hanging');
  const slowS = judgeSafe(s, null, null);
  assert.equal(slowS.kind, 'slow');
  assert.equal(slowS.text, 'Too slow: in a game that is a move. Safe. Their best reply only kept the balance.');
  assert.equal(slowS.truth, 'safe');
  assert.equal(slowS.ms, null);
  assert.equal(judgeSafe(h, undefined, 100).kind, 'slow');
});

test('judgeSafe: the hanging text uses the explanation clause about the refutation', () => {
  const material = hangingItem('Nxf7 left your knight on f7 exposed: Qxg2 wins material. Bxf7+ was stronger.');
  assert.equal(judgeSafe(material, 'hanging', 1000).text, 'Nxf7 lost 60% winning chances: Qxg2 wins material.');
  const mate = hangingItem('Nxf7 allowed a forced mate in 2, starting with Qxg2. Bxf7+ was safer.');
  assert.equal(judgeSafe(mate, 'safe', 1000).text, 'Nxf7 lost 60% winning chances: Qxg2 forces mate in 2.');
  const unrelated = hangingItem('You played Nxf7. Better was Bxf7+. The knight is lost.');
  assert.equal(judgeSafe(unrelated, 'hanging', 1000).text, 'Nxf7 lost 60% winning chances: Qxg2 punishes it.');
  const none = hangingItem(null);
  assert.equal(judgeSafe(none, 'hanging', 1000).text, 'Nxf7 lost 60% winning chances: Qxg2 punishes it.');
  const pending = { ...hangingItem(), refute: null, refuteSan: null, needsRefute: true };
  assert.equal(judgeSafe(pending, 'hanging', 1000).text, 'Nxf7 lost 60% winning chances.');
});

// ---------- runSummary ----------

const verdict = (kind, ms = 1000) => ({
  kind,
  correct: kind === 'hit' || kind === 'cr',
  truth: kind === 'hit' || kind === 'miss' ? 'hanging' : kind === 'slow' ? 'hanging' : 'safe',
  ms,
});
const many = (kind, n, ms) => Array.from({ length: n }, () => verdict(kind, ms));

test('runSummary: counts, rates, accuracy and the text', () => {
  const list = [...many('hit', 4, 3100), verdict('miss', 2000), verdict('fa', 4000), ...many('cr', 4, 3100)];
  const s = runSummary(list);
  assert.equal(s.n, 10);
  assert.equal(s.hit, 4);
  assert.equal(s.miss, 1);
  assert.equal(s.fa, 1);
  assert.equal(s.cr, 4);
  assert.equal(s.slow, 0);
  assert.equal(s.hanging, 5);
  assert.equal(s.hitRate, 0.8);
  assert.equal(s.faRate, 0.2);
  assert.equal(s.accuracy, 0.6);
  assert.equal(s.medianMs, 3100);
  assert.equal(s.passed, false);
  assert.equal(s.text, '8 of 10 right · 1 false alarm · median 3.1 s');
});

test('runSummary: saying hanging every time scores 0, and so does saying safe', () => {
  const allHanging = runSummary([...many('hit', 5), ...many('fa', 5)]);
  assert.equal(allHanging.hitRate, 1);
  assert.equal(allHanging.faRate, 1);
  assert.equal(allHanging.accuracy, 0);
  assert.equal(allHanging.text, '5 of 10 right · 5 false alarms · median 1.0 s');
  const allSafe = runSummary([...many('miss', 5), ...many('cr', 5)]);
  assert.equal(allSafe.accuracy, 0);
  // More false alarms than hits never goes below 0.
  assert.equal(runSummary([verdict('hit'), verdict('miss'), ...many('fa', 3), verdict('cr')]).accuracy, 0);
});

test('runSummary: the median is over answered items only; a timeout counts against its side', () => {
  const s = runSummary([verdict('hit', 1000), verdict('cr', 3000), verdict('hit', 2000), verdict('slow', 5000)]);
  assert.equal(s.medianMs, 2000);
  assert.equal(s.slow, 1);
  assert.equal(s.hanging, 3, 'a timeout on a hanging item is a hanging item');
  assert.equal(s.hitRate, 2 / 3);
  assert.equal(s.text, '3 of 4 right · no false alarms · 1 too slow · median 2.0 s');
  const even = runSummary([verdict('hit', 1000), verdict('cr', 3000)]);
  assert.equal(even.medianMs, 2000);
  const slowSafe = runSummary([verdict('hit', 1000), { ...verdict('slow', null), truth: 'safe' }]);
  assert.equal(slowSafe.faRate, 0, 'a timeout on a safe item is not a false alarm');
  assert.equal(slowSafe.accuracy, 1);
  assert.equal(slowSafe.medianMs, 1000);
});

test('runSummary: the pass line is inclusive at 0.7 and 3500 ms', () => {
  assert.equal(runSummary([...many('hit', 7, 3500), ...many('miss', 3, 3500)]).passed, true);
  assert.equal(runSummary([...many('hit', 7, 3502), ...many('miss', 3, 3500)]).passed, false, 'the median is 3502');
  assert.equal(runSummary([...many('hit', 7, 3501), ...many('miss', 3, 3501)]).passed, false);
  assert.equal(runSummary([...many('hit', 69, 1000), ...many('miss', 31, 1000)]).passed, false, '0.69');
  assert.equal(runSummary([...many('hit', 70, 1000), ...many('miss', 30, 1000)]).passed, true, '0.70');
  // 0.9 − 0.2 is 0.7 even with floating point in the way.
  const mixed = runSummary([...many('hit', 9, 1000), verdict('miss', 1000), ...many('fa', 2, 1000), ...many('cr', 8, 1000)]);
  assert.equal(mixed.accuracy, 0.7);
  assert.equal(mixed.passed, true);
});

test('runSummary: an empty run', () => {
  const s = runSummary([]);
  assert.equal(s.n, 0);
  assert.equal(s.accuracy, 0);
  assert.equal(s.medianMs, null);
  assert.equal(s.passed, false);
  assert.equal(s.text, '0 of 0 right · no false alarms');
  const allSlow = runSummary(many('slow', 3, null));
  assert.equal(allSlow.medianMs, null);
  assert.equal(allSlow.passed, false);
  assert.equal(allSlow.text, '0 of 3 right · no false alarms · 3 too slow');
});

// ---------- recordSafeRun ----------

test('recordSafeRun: saves a row, counts runs and keeps the best accuracy', () => {
  const s = stateWith();
  const good = runSummary([...many('hit', 4, 3000), verdict('miss', 3000), verdict('fa', 3000), ...many('cr', 4, 3000)]);
  recordSafeRun(s, good, '2026-10-13');
  assert.deepEqual(s.calc.safe, { best: 60, runs: 1, last: [{ d: '2026-10-13', n: 10, h: 5, hit: 4, miss: 1, fa: 1, slow: 0, ms: 3000 }] });
  const worse = runSummary([...many('hit', 2, 4000), ...many('miss', 3, 4000), ...many('cr', 5, 4000)]);
  recordSafeRun(s, worse, '2026-10-14');
  assert.equal(s.calc.safe.best, 60);
  assert.equal(s.calc.safe.runs, 2);
  assert.equal(s.calc.safe.last.length, 2);
  assert.equal(s.calc.safe.last[1].ms, 4000);
  const perfect = runSummary([...many('hit', 5, 2000), ...many('cr', 5, 2000)]);
  recordSafeRun(s, perfect, '2026-10-15');
  assert.equal(s.calc.safe.best, 100);
  // Missing stats are created; the default date is today's key.
  const bare = stateWith();
  delete bare.calc.safe;
  recordSafeRun(bare, perfect);
  assert.equal(bare.calc.safe.runs, 1);
  assert.match(bare.calc.safe.last[0].d, /^\d{4}-\d{2}-\d{2}$/);
});

test('recordSafeRun: keeps the last 50 runs', () => {
  const s = stateWith();
  for (let i = 0; i < 55; i++) recordSafeRun(s, runSummary([verdict('hit', 1000 + i)]), 'day' + i);
  assert.equal(s.calc.safe.runs, 55);
  assert.equal(s.calc.safe.last.length, MAX_LAST);
  assert.equal(s.calc.safe.last[0].d, 'day5');
  assert.equal(s.calc.safe.last[49].d, 'day54');
});

// ---------- safeStats ----------

const run = ({ n = 10, hit = 4, miss = 1, fa = 1, slow = 0, ms = 3000, d = '2026-10-01' } = {}) => ({
  d,
  n,
  h: hit + miss + slow,
  hit,
  miss,
  fa,
  slow,
  ms,
});

test('safeStats: nothing recorded', () => {
  assert.deepEqual(safeStats(stateWith()), { items: 0, accuracy: null, medianMs: null, before: { items: 0, accuracy: null } });
  const bare = stateWith();
  delete bare.calc.safe;
  assert.deepEqual(safeStats(bare), { items: 0, accuracy: null, medianMs: null, before: { items: 0, accuracy: null } });
});

test('safeStats: the last 50 positions against the 50 before', () => {
  const s = stateWith();
  const older = Array.from({ length: 5 }, () => run({ hit: 3, miss: 2, fa: 2, ms: 4000 })); // 60% − 40% = 20
  const oldest = Array.from({ length: 2 }, () => run({ hit: 0, miss: 5, fa: 5, ms: 9000 })); // ignored
  const recent = Array.from({ length: 5 }, () => run({ hit: 4, miss: 1, fa: 1, ms: 3000 })); // 80% − 20% = 60
  s.calc.safe.last = [...oldest, ...older, ...recent];
  assert.deepEqual(safeStats(s), { items: 50, accuracy: 60, medianMs: 3000, before: { items: 50, accuracy: 20 } });
  // Fewer than 50 so far: everything counts, nothing before.
  s.calc.safe.last = recent.slice(0, 4);
  assert.deepEqual(safeStats(s), { items: 40, accuracy: 60, medianMs: 3000, before: { items: 0, accuracy: null } });
});

test('safeStats: whole runs only, bigger runs weigh more, old rows without h still work', () => {
  const s = stateWith();
  s.calc.safe.last = [
    run({ n: 10, ms: 1000 }),
    run({ n: 4, hit: 2, miss: 0, fa: 0, ms: 2000 }),
    ...Array.from({ length: 4 }, () => run({ ms: 3000 })),
  ];
  const st = safeStats(s);
  assert.equal(st.items, 44, 'the newest 44 fit, the next run would pass 50');
  assert.equal(st.medianMs, 3000);
  assert.equal(st.before.items, 10);
  // Accuracy is aggregate: hits over hanging items, less false alarms over safe items.
  s.calc.safe.last = [run({ n: 10, hit: 5, miss: 0, fa: 0, ms: 1000 }), run({ n: 10, hit: 0, miss: 5, fa: 5, ms: 2000 })];
  assert.equal(safeStats(s).accuracy, 0, '5 of 10 hanging hit, 5 of 10 safe false alarms');
  assert.equal(safeStats(s).medianMs, 1500);
  const legacy = { d: '2026-09-01', n: 10, hit: 4, miss: 1, fa: 0, slow: 0, ms: null };
  s.calc.safe.last = [legacy];
  assert.deepEqual(safeStats(s), { items: 10, accuracy: 80, medianMs: null, before: { items: 0, accuracy: null } });
  // A run bigger than the window still counts on its own.
  s.calc.safe.last = [run({ n: 60, hit: 30, miss: 0, fa: 0 })];
  assert.equal(safeStats(s).items, 60);
  assert.equal(safeStats(s).accuracy, 100);
});
