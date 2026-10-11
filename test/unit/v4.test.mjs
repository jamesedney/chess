import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, migrate, validate, CURRENT_VERSION } from '../../src/state.js';
import { pickMoments, needsDebrief, suggestReason, tagMoment, habits, REASONS } from '../../src/debrief.js';
import { replayCandidates, opponentLevel, judgeReplay, recordReplay, nextReplay, goalText } from '../../src/replay.js';
import { buildRepertoire, repertoireCards, dueCards, weakLines, lineText } from '../../src/repertoire.js';
import { timeProfile, profileText } from '../../src/timeprofile.js';
import { evidence, headlineText, focus } from '../../src/evidence.js';
import { schedule } from '../../src/srs.js';
import { planSession, baseline, blockDone } from '../../src/program.js';
import { place } from '../../src/curriculum.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const NOW = Date.parse('2026-10-11T12:00:00Z');
const DAY = 86400000;
const MOVES = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4', 'Nxe5', 'Qg5', 'Nxf7', 'Qxg2'];
let seq = 0;

/** A reviewed game. evals: { ply: whiteCentipawns }, marks: [{ ply, cls, loss, bestSan, ... }]. */
function review({ colour = 'w', result = '0-1', moves = MOVES, evals = {}, marks = [], created = NOW, clocks, tc, ...rest } = {}) {
  const ev = new Array(moves.length + 1).fill(null);
  for (const [k, v] of Object.entries(evals)) ev[Number(k)] = v;
  return {
    id: 'r' + ++seq,
    key: 'k' + seq,
    complete: true,
    created,
    white: colour === 'w' ? 'me' : 'rival',
    black: colour === 'w' ? 'rival' : 'me',
    result,
    colour,
    startFen: START,
    moves,
    evals: ev,
    marks: marks.map(m => ({ cls: 'mistake', loss: 20, best: 'a2a3', bestSan: 'a3', ...m })),
    ...(clocks ? { clocks, tc } : {}),
    ...rest,
  };
}

test('debrief: the decisive moments, a suggested reason, tagging and habits', () => {
  const r = review({
    marks: [
      { ply: 2, cls: 'inaccuracy', loss: 6 },
      { ply: 4, loss: 12 },
      { ply: 6, loss: 15 },
      { ply: 8, cls: 'blunder', loss: 40 },
    ],
  });
  assert.deepEqual(
    pickMoments(r).map(m => m.ply),
    [4, 6, 8],
  );
  assert.deepEqual(
    pickMoments(r, 2).map(m => m.ply),
    [6, 8],
  );
  assert.equal(needsDebrief(r), true);
  assert.equal(needsDebrief(review({ marks: [{ ply: 2, cls: 'inaccuracy' }] })), false);
  // Reasons: the clock first, then the kind of mistake.
  const timed = review({ clocks: [298, 299, 296, 297, 295, 296, 293, 25, 292, 20], tc: { base: 300, inc: 0 } });
  assert.equal(suggestReason(timed, { ply: 4 }), 'rushed'); // 296 -> 295: one second
  assert.equal(suggestReason(r, { ply: 4 }, { kind: 'hung-piece' }), 'threat');
  assert.equal(suggestReason(r, { ply: 4 }, { kind: 'missed-tactic' }), 'chance');
  assert.equal(suggestReason(r, { ply: 4 }, { kind: 'positional' }), 'plan');
  assert.equal(suggestReason(r, { ply: 4 }, null), 'calc');
  // Tagging every moment completes the debrief.
  assert.equal(tagMoment(r, 4, 'threat'), false);
  assert.equal(tagMoment(r, 6, 'nonsense'), false);
  tagMoment(r, 6, 'threat');
  assert.equal(tagMoment(r, 8, 'calc'), true);
  assert.equal(r.debriefed, true);
  assert.equal(needsDebrief(r), false);
  const state = { ...defaults(), reviews: [r] };
  const h = habits(state);
  assert.equal(h.total, 3);
  assert.equal(h.list[0].id, 'threat');
  assert.equal(h.list[0].count, 2);
  assert.ok(REASONS.every(x => x.skill || x.drill));
});

test('play it again: winning positions not won, holdable ones lost, and the opponent', () => {
  // White, winning by 3 before the blunder on ply 6, lost the game.
  const convert = review({ evals: { 6: 320, 7: -150 }, marks: [{ ply: 6, cls: 'blunder', loss: 45, bestSan: 'O-O' }], oppElo: 1480 });
  // White, slightly worse (-1) before ply 4, lost after it.
  const hold = review({ evals: { 4: -100, 5: -450 }, marks: [{ ply: 4, cls: 'blunder', loss: 35, bestSan: 'd3' }], created: NOW - DAY });
  // A won game has nothing to replay.
  const won = review({ result: '1-0', evals: { 6: 320 }, marks: [{ ply: 6 }] });
  const state = { ...defaults(), reviews: [convert, hold, won] };
  const list = replayCandidates(state);
  assert.deepEqual(
    list.map(c => [c.goal, c.ply]),
    [
      ['convert', 6],
      ['hold', 4],
    ],
  );
  const c = list[0];
  assert.equal(c.fen, 'r1bqkbnr/pppp1ppp/8/4p3/2BnP3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4');
  assert.equal(c.played, 'Nxe5');
  assert.equal(c.best, 'O-O');
  assert.equal(c.opponent, 'rival');
  assert.match(goalText(c), /winning here \(\+3\.2\)/);
  // Opponents: Maia near its levels, Stockfish otherwise.
  assert.equal(opponentLevel(1480), 'maia1500');
  assert.equal(opponentLevel(1050), 'maia1100');
  assert.equal(opponentLevel(2350), 'elo2400');
  assert.equal(opponentLevel(null, 1800), 'maia1900');
  // Judging.
  assert.equal(judgeReplay('convert', { result: 'win' }), true);
  assert.equal(judgeReplay('convert', { result: 'draw' }), false);
  assert.equal(judgeReplay('hold', { result: 'draw' }), true);
  assert.equal(judgeReplay('hold', { result: 'loss' }), false);
  assert.equal(judgeReplay('convert', { evalUser: 450 }), true);
  assert.equal(judgeReplay('convert', { evalUser: 200 }), false);
  assert.equal(judgeReplay('hold', { evalUser: -50 }), true);
  // Records: success sticks, the next one moves on.
  recordReplay(state, c.id, false, '2026-10-11');
  assert.equal(nextReplay(state).id, c.id);
  recordReplay(state, c.id, true, '2026-10-11');
  assert.deepEqual(state.replays[c.id], { tries: 2, success: true, last: '2026-10-11' });
  assert.equal(nextReplay(state).goal, 'hold');
});

test('repertoire: your moves, better moves where you lost ground, due cards and weak lines', () => {
  const games = [
    review({ result: '0-1' }),
    review({ result: '0-1', marks: [{ ply: 4, loss: 18, bestSan: 'Bb5' }] }),
    review({ result: '1/2-1/2' }),
    review({ colour: 'b', moves: ['d4', 'd5', 'c4', 'e6'], result: '1-0' }),
  ];
  const nodes = buildRepertoire(games);
  const white = [...nodes.values()].filter(n => n.colour === 'w');
  assert.deepEqual(
    white.map(n => n.ply),
    [0, 2, 4, 6, 8],
  );
  const cards = repertoireCards(games);
  const first = cards[0];
  assert.equal(first.ply, 0);
  assert.equal(first.answer, 'e4');
  assert.equal(first.games, 3);
  const bc4 = cards.find(c => c.ply === 4);
  assert.equal(bc4.fix, true);
  assert.equal(bc4.answer, 'Bb5');
  assert.equal(bc4.played, 'Bc4');
  assert.match(bc4.why, /Better than Bc4/);
  assert.equal(lineText(bc4.line), '1. e4 e5 2. Nf3 Nc6');
  // The single Black game is not a card yet (one game, no mistake).
  assert.ok(!cards.some(c => c.colour === 'b'));
  // Due: all at first, fixes first; a card answered cleanly waits.
  const state = { ...defaults(), reviews: games, rep: {} };
  const due = dueCards(state, NOW);
  assert.equal(due[0].id, bc4.id);
  state.rep[bc4.id] = schedule(undefined, true, NOW);
  assert.ok(!dueCards(state, NOW).some(c => c.id === bc4.id));
  // You score 1/6 after 1. e4 e5 2. Nf3 Nc6: a weak line.
  assert.ok(weakLines(games).some(l => l.line === '1. e4 e5 2. Nf3 Nc6' && l.games === 3));
});

test('clock profile: rushing critical moves, running short, or balanced', () => {
  const tc = { base: 180, inc: 0 };
  // Ten plies, White to move on even plies. Each critical White move took under a second.
  const rushedGame = created =>
    review({
      created,
      tc,
      clocks: [179, 179, 178.5, 178, 178, 177, 177.6, 176, 177.2, 175],
      marks: [{ ply: 2 }, { ply: 4 }, { ply: 6 }],
    });
  const rushed = timeProfile({ ...defaults(), reviews: [rushedGame(NOW), rushedGame(NOW - DAY)] }, NOW);
  assert.equal(rushed.games, 2);
  assert.equal(rushed.verdict, 'rushed');
  assert.equal(rushed.drill, 'pause');
  assert.match(profileText(rushed), /in a hurry/);
  // Down to ten seconds by move 5 and flagged at the end, twice.
  const shortGame = created => review({ created, tc, result: '0-1', clocks: [150, 170, 100, 160, 40, 150, 10, 140, 1, 130], marks: [] });
  const slow = timeProfile({ ...defaults(), reviews: [shortGame(NOW), shortGame(NOW - DAY)] }, NOW);
  assert.equal(slow.verdict, 'slow');
  assert.equal(slow.flagged, 2);
  assert.equal(slow.drill, 'pace');
  assert.equal(timeProfile({ ...defaults(), reviews: [] }, NOW).verdict, null);
});

test('evidence: recent games against the weeks before, and the focus it sets', () => {
  const old = Array.from({ length: 4 }, (_, i) =>
    review({
      created: NOW - (20 + i) * DAY,
      marks: [
        { ply: 2, cls: 'blunder' },
        { ply: 4, cls: 'blunder' },
      ],
    }),
  );
  const recent = Array.from({ length: 3 }, (_, i) => review({ created: NOW - (1 + i) * DAY, marks: [{ ply: 2, cls: 'blunder' }] }));
  const state = { ...defaults(), reviews: [...recent, ...old] };
  state.log = [
    { d: '2026-10-10', k: 'b', t: 'threat', c: 1 },
    { d: '2026-10-10', k: 'p', t: 'pace', c: 1 },
  ];
  const ev = evidence(state, NOW);
  const blunders = ev.rows.find(r => r.id === 'blunders');
  assert.equal(blunders.verdict, 'better');
  assert.equal(blunders.text, '2.0 → 1.0.');
  assert.equal(ev.recent.games, 3);
  assert.equal(ev.before.games, 4);
  assert.equal(ev.recent.training.debriefs, 1);
  assert.equal(ev.recent.training.clock, 1);
  assert.match(headlineText(ev), /^Working: blunders 2\.0 → 1\.0/);
  // Too few games: unknown, no headline.
  const thin = evidence({ ...defaults(), reviews: recent }, NOW);
  assert.ok(thin.rows.every(r => r.verdict === 'unknown'));
  assert.equal(headlineText(thin), null);
  // Focus: a strong debrief habit wins when the clock says nothing.
  const tagged = Array.from({ length: 5 }, (_, i) => review({ created: NOW - i * DAY, marks: [{ ply: 2, reason: 'chance' }] }));
  assert.deepEqual(focus({ ...defaults(), reviews: tagged }, NOW), {
    skill: 'tactics',
    reason: 'Your debriefs keep saying: missed my chance.',
  });
  assert.equal(focus({ ...defaults(), reviews: [] }, NOW), null);
});

test('state v7: replays and repertoire records, and old games are not debriefed again', () => {
  assert.equal(CURRENT_VERSION, 7);
  const v6 = { ...defaults(), version: 6, reviews: [review()] };
  delete v6.replays;
  delete v6.rep;
  const m = migrate(v6);
  assert.equal(m.version, 7);
  assert.deepEqual(m.replays, {});
  assert.deepEqual(m.rep, {});
  assert.equal(m.reviews[0].debriefed, true);
  assert.equal(validate(m), null);
  assert.equal(validate({ ...m, replays: { x: { tries: 'a' } } }), 'replay');
});

test('planner: a clock drill for a clock habit, a game to play again, and repertoire positions due', () => {
  const tc = { base: 180, inc: 0 };
  // Two recent games, lost from a winning position, with critical moves played in under a second.
  const game = created =>
    review({
      created,
      tc,
      clocks: [179, 179, 178.5, 178, 178, 177, 177.6, 176, 177.2, 175],
      evals: { 2: 300, 3: 0, 4: 0, 6: 0 },
      marks: [{ ply: 2, cls: 'blunder', loss: 40 }, { ply: 4 }, { ply: 6 }],
      debriefed: true,
    });
  const state = { ...defaults(), reviews: [game(NOW - 4 * DAY), game(NOW - 5 * DAY)], minutes: 60 };
  state.puzzle.rating = 1200;
  place(state, 1200, '2026-10-11');
  const plan = planSession(state, { now: NOW, target: 1400 });
  const ids = plan.blocks.map(b => b.id);
  const clock = plan.blocks.find(b => b.id === 'clock');
  assert.ok(clock, ids.join());
  assert.equal(clock.params.clock, 'pause');
  assert.equal(clock.optional, undefined, 'the main problem is not optional');
  assert.match(clock.detail, /too fast/);
  const replay = plan.blocks.find(b => b.id === 'replay');
  assert.ok(replay, ids.join());
  assert.equal(replay.title, 'Play it again: convert the win');
  const rep = plan.blocks.find(b => b.id === 'repertoire');
  assert.ok(rep, ids.join());
  assert.deepEqual(rep.params, { drill: 'repertoire', limit: rep.count });
  // Done when the work is logged.
  const started = { ...clock, base: baseline(state) };
  assert.equal(blockDone(state, started), false);
  for (let i = 0; i < clock.count; i++) state.log.push({ d: '2026-10-11', k: 'p', t: 'pause', c: 1 });
  assert.equal(blockDone(state, started), true);
  const replayStarted = { ...replay, base: baseline(state) };
  recordReplay(state, replay.params.replay, false, '2026-10-11');
  assert.equal(blockDone(state, replayStarted), true);
  const repStarted = { ...rep, base: baseline(state) };
  for (let i = 0; i < rep.count; i++) state.log.push({ d: '2026-10-11', k: 'o', t: 'w', c: 1 });
  assert.equal(blockDone(state, repStarted), true);
});
