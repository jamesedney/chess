import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, validate, migrate, logGame, CURRENT_VERSION } from '../../src/state.js';
import {
  lichessUrl,
  controlClass,
  gameKey,
  acceptGame,
  selectNew,
  fetchLichessNew,
  fetchChessComNew,
  DEFAULT_SYNC,
} from '../../src/sync.js';
import { adaptLevel, LADDER, LEVELS } from '../../src/strength.js';
import { nextStep, focusTags, recommendedLesson } from '../../src/guide.js';
import { choosePuzzle } from '../../src/srs.js';
import { readEvals, MATE_EVAL } from '../../src/analyse.js';

const NOW = new Date(2026, 9, 8, 12).getTime();
const TODAY = '2026-10-08';

const GAME = (
  headers,
  moves = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Na5 10. Bc2 c5 11. d4 Qc7 1-0',
) =>
  Object.entries({
    Event: 'Rated blitz game',
    Site: 'https://lichess.org/abcd1234',
    White: 'me',
    Black: 'rival',
    Result: '1-0',
    Variant: 'Standard',
    TimeControl: '300+0',
    UTCDate: '2026.10.08',
    UTCTime: '10:00:00',
    ...headers,
  })
    .map(([k, v]) => `[${k} "${v}"]`)
    .join('\n') +
  '\n\n' +
  moves;

test('state v4 adds sync settings and the game log', () => {
  const s = defaults();
  assert.equal(validate(s), null);
  const v3 = { ...migrate({ version: 1 }), version: 3 };
  delete v3.sync;
  delete v3.games;
  delete v3.settings.autoLevel;
  const up = migrate(v3);
  assert.equal(up.version, CURRENT_VERSION);
  assert.equal(up.sync.auto, true);
  assert.equal(up.settings.autoLevel, true);
  assert.deepEqual(up.games, []);
  logGame(up, { level: 'maia1100', result: 1, date: TODAY });
  assert.equal(validate(up), null);
  up.games.push({ d: TODAY, level: 'nope', r: 1 });
  assert.equal(validate(up), 'game');
});

test('the Lichess export URL carries the filters', () => {
  const url = lichessUrl('Me_1', DEFAULT_SYNC(), 1000);
  assert.match(url, /\/api\/games\/user\/Me_1\?/);
  assert.match(url, /since=1000/);
  assert.match(url, /rated=true/);
  assert.match(url, /evals=true/);
  assert.match(url, /perfType=blitz%2Crapid%2Cclassical/);
  const sync = { ...DEFAULT_SYNC(), ratedOnly: false, controls: ['bullet'] };
  assert.match(lichessUrl('x', sync, 0), /perfType=bullet%2CultraBullet/);
  assert.doesNotMatch(lichessUrl('x', sync, 0), /rated=/);
});

test('time controls are classed like Lichess does', () => {
  assert.equal(controlClass('60+0'), 'bullet');
  assert.equal(controlClass('180+2'), 'blitz');
  assert.equal(controlClass('600+0'), 'rapid');
  assert.equal(controlClass('1800+0'), 'classical');
  assert.equal(controlClass('1/259200'), 'correspondence');
  assert.equal(controlClass('-'), null);
});

test('games are accepted only when they are yours, finished, long enough and in scope', () => {
  const sync = DEFAULT_SYNC();
  assert.deepEqual(acceptGame(GAME({}), ['me'], sync), { ok: true, colour: 'w' });
  assert.equal(acceptGame(GAME({ Black: 'me', White: 'x' }), ['me'], sync).colour, 'b');
  assert.equal(acceptGame(GAME({}), ['someone'], sync).reason, 'not your game');
  assert.equal(acceptGame(GAME({ Result: '*' }), ['me'], sync).reason, 'unfinished');
  assert.equal(acceptGame(GAME({ Variant: 'Chess960' }), ['me'], sync).reason, 'variant');
  assert.equal(acceptGame(GAME({ Event: 'Casual blitz game' }), ['me'], sync).reason, 'casual');
  assert.equal(acceptGame(GAME({}), ['me'], { ...sync, ratedOnly: false }, { rated: false }).ok, true);
  assert.equal(acceptGame(GAME({ TimeControl: '60+0' }), ['me'], sync).reason, 'time control');
  assert.equal(acceptGame(GAME({}, '1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0'), ['me'], sync).reason, 'too short');
  assert.equal(gameKey(GAME({})), 'lichess.org/abcd1234');
  assert.equal(gameKey(GAME({ Site: 'https://lichess.org/abcd1234/black' })), 'lichess.org/abcd1234');
});

test('new games are chosen once, within the daily cap, and unfinished games are not marked seen', () => {
  const sync = DEFAULT_SYNC();
  sync.dailyCap = 2;
  const fetched = [
    { pgn: GAME({ Site: 'https://lichess.org/g1' }) },
    { pgn: GAME({ Site: 'https://lichess.org/g2', Result: '*' }) },
    { pgn: GAME({ Site: 'https://lichess.org/g3' }) },
    { pgn: GAME({ Site: 'https://lichess.org/g4' }) },
  ];
  const chosen = selectNew(fetched, { usernames: ['me'], sync, source: 'lichess', now: NOW });
  assert.deepEqual(
    chosen.map(c => c.key),
    ['lichess.org/g1', 'lichess.org/g3'],
  );
  assert.equal(chosen[0].colour, 'w');
  assert.ok(sync.seen.includes('lichess.org/g4'), 'a game over the cap is still seen: it comes back tomorrow only if fetched again');
  assert.ok(!sync.seen.includes('lichess.org/g2'), 'an unfinished game is fetched again when it ends');
  assert.equal(sync.today.n, 2);
  assert.equal(sync.last.lichess, NOW - 3600000);
  const again = selectNew(fetched, { usernames: ['me'], sync, source: 'lichess', now: NOW });
  assert.equal(again.length, 0, 'nothing is queued twice');
});

test('fetching maps site responses and errors', async () => {
  const sync = DEFAULT_SYNC();
  const lichess = await fetchLichessNew('me', sync, {
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => GAME({}) + '\n\n\n' + GAME({ Site: 'https://lichess.org/zz' }) }),
    now: NOW,
  });
  assert.equal(lichess.length, 2);
  assert.equal(lichess[0].source, 'lichess');
  await assert.rejects(fetchLichessNew('me', sync, { fetchImpl: async () => ({ ok: false, status: 429 }) }), /rate-limiting/);
  const archives = { archives: ['https://api.chess.com/pub/player/me/games/2026/09', 'https://api.chess.com/pub/player/me/games/2026/10'] };
  const month = {
    games: [
      {
        pgn: GAME({ Site: 'Chess.com', Link: 'https://www.chess.com/game/live/1' }),
        rules: 'chess',
        rated: true,
        time_class: 'blitz',
        end_time: Math.floor(NOW / 1000) - 60,
      },
      { pgn: 'x', rules: 'chess960', end_time: Math.floor(NOW / 1000) },
    ],
  };
  const chesscom = await fetchChessComNew('Me', sync, {
    fetchImpl: async url => ({ ok: true, status: 200, json: async () => (url.endsWith('archives') ? archives : month) }),
    now: NOW,
  });
  assert.equal(chesscom.length, 2, 'both months, standard chess only');
  assert.equal(chesscom[0].control, 'blitz');
  assert.equal(gameKey(chesscom[0].pgn), 'www.chess.com/game/live/1');
});

test('Lichess evaluations are read from the PGN', () => {
  const pgn = '1. e4 { [%eval 0.17] } 1... e5 { [%eval 0.2] } 2. Qh5 { [%eval -0.5] } 2... Nc6 { [%eval #3] } 3. Qxf7+ { [%eval #-2] } 1-0';
  assert.deepEqual(readEvals(pgn, 5), [17, 20, -50, MATE_EVAL, -MATE_EVAL]);
  assert.deepEqual(readEvals(pgn, 6), [17, 20, -50, MATE_EVAL, -MATE_EVAL], 'one missing after the final move is fine');
  assert.equal(readEvals(pgn, 9), null);
  assert.equal(readEvals('1. e4 e5', 2), null);
});

test('the opponent ladder moves one rung on a clear run of results', () => {
  assert.ok(LADDER.every(id => LEVELS.some(l => l.id === id)));
  const games = [];
  const at = (level, r, n) => {
    for (let i = 0; i < n; i++) games.push({ d: TODAY, level, r });
  };
  at('maia1100', 1, 4);
  assert.equal(adaptLevel(games, 'maia1100').change, null, 'needs five games');
  at('maia1100', 1, 1);
  assert.deepEqual(adaptLevel(games, 'maia1100'), { level: 'improver', change: 'up' });
  at('improver', 0, 5);
  assert.deepEqual(adaptLevel(games, 'improver'), { level: 'maia1100', change: 'down' });
  assert.equal(adaptLevel(games, 'maia1100').change, null, 'old wins at the lower level do not bounce it straight back up');
  at('maia1100', 0.5, 5);
  assert.equal(adaptLevel(games, 'maia1100').change, null, 'draws hold the level');
  assert.equal(adaptLevel(games, 'elo2400').change, null);
  at('full', 1, 5);
  assert.equal(adaptLevel(games, 'full').change, null, 'nowhere higher to go');
});

const FEN = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';
let n = 0;
const mistake = extra => ({
  id: 'mg' + (++n).toString(36),
  title: 'Instead of Qh4',
  fen: FEN,
  line: ['b8c6'],
  theme: 'Personal mistakes',
  tags: [],
  goal: 'Find the improvement.',
  explanation: 'x',
  played: 'Qh4',
  loss: 30,
  created: NOW - 3600000,
  kind: 'missed-tactic',
  ...extra,
});

test('focus tags and lesson recommendations come from recent mistakes', () => {
  const s = defaults();
  s.mistakes = [
    mistake({ tags: ['fork'] }),
    mistake({ tags: ['fork', 'short'] }),
    mistake({ kind: 'hung-piece' }),
    mistake({ tags: ['pin'], created: NOW - 40 * 86400000 }),
  ];
  assert.deepEqual(
    focusTags(s, NOW).map(f => f.tag),
    ['fork', 'hangingPiece'],
  );
  assert.equal(recommendedLesson(s, NOW).id, 'forks');
  s.lessons.forks = { step: 9, done: true };
  assert.equal(recommendedLesson(s, NOW), null, 'a finished lesson is not suggested again');
});

test('the guided loop picks the next step in order', () => {
  const s = defaults();
  const puzzles = [{ id: 'p001', fen: FEN, line: ['b8c6'], theme: 'Tactics', tags: ['fork'], rating: 900 }];
  // Fresh user: puzzles first.
  let step = nextStep(s, { now: NOW, puzzles });
  assert.equal(step.id, 'puzzles');
  assert.match(step.title, /^8 puzzles/);
  // A reviewed game with an unsolved mistake comes before anything else.
  const m = mistake({ source: { reviewId: 'r1', ply: 3 } });
  s.mistakes = [m];
  s.reviews = [
    {
      id: 'r1',
      complete: true,
      created: NOW - 60000,
      colour: 'w',
      white: 'me',
      black: 'rival',
      marks: [{ ply: 3, cls: 'blunder', mistakeId: m.id }],
    },
  ];
  step = nextStep(s, { now: NOW, puzzles });
  assert.equal(step.id, 'drill');
  assert.match(step.title, /against rival/);
  assert.deepEqual(step.action.params, { mode: 'mistakes', review: 'r1' });
  // Solved cleanly: puzzles now lean on what was missed.
  s.records[m.id] = { tries: 1, clean: 1, box: 1, due: NOW + 86400000, last: NOW };
  s.mistakes[0].tags = ['fork'];
  step = nextStep(s, { now: NOW, puzzles });
  assert.equal(step.id, 'puzzles');
  assert.match(step.title, /fork/i);
  assert.deepEqual(step.action.params.tags, ['fork']);
  // Due positions come before new puzzles.
  s.records.p001 = { tries: 1, clean: 1, box: 1, due: NOW - 1, last: NOW - 86400000 };
  assert.equal(nextStep(s, { now: NOW, puzzles }).id, 'due');
  // Goal met today: a lesson for a repeated pattern, then a game, then done.
  s.days[TODAY] = { attempts: 8, clean: 6 };
  s.mistakes.push(mistake({ tags: ['fork'] }));
  assert.equal(nextStep(s, { now: NOW, puzzles }).id, 'lesson');
  s.lessons.forks = { step: 9, done: true };
  assert.equal(nextStep(s, { now: NOW, puzzles }).id, 'done', 'a game reviewed today counts as having played');
  s.reviews[0].created = NOW - 2 * 86400000;
  step = nextStep(s, { now: NOW, puzzles });
  assert.equal(step.id, 'play');
  assert.match(step.title, /1100 player$/);
  s.games.push({ d: TODAY, level: 'maia1100', r: 1 });
  assert.equal(nextStep(s, { now: NOW, puzzles }).id, 'done');
  // A busy queue is mentioned, not blocking.
  const busy = nextStep(s, { now: NOW, puzzles, queue: { pending: 1, current: { label: 'me – x', progress: '' } } });
  assert.equal(busy.id, 'done');
  assert.match(busy.note, /being reviewed/);
});

test('focus tags steer new puzzles', () => {
  const puzzles = [
    { id: 'a', fen: FEN, line: ['b8c6'], theme: 'Tactics', tags: ['pin'], rating: 1000 },
    { id: 'b', fen: FEN, line: ['b8c6'], theme: 'Tactics', tags: ['fork'], rating: 1000 },
  ];
  const picks = new Set();
  for (let i = 0; i < 20; i++) picks.add(choosePuzzle({ puzzles, records: {}, target: 1000, focusTags: ['fork'], rng: () => 0.1 }).id);
  assert.deepEqual([...picks], ['b']);
});
