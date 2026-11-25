import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lichessUrl,
  controlClass,
  gameKey,
  acceptGame,
  selectNew,
  fetchLichessNew,
  fetchChessComNew,
  DEFAULT_SYNC,
  BACKFILL_MAX,
  SYNC_MAX,
} from '../../src/sync.js';
import { readEvals, gameInfo, MATE_EVAL } from '../../src/analyse.js';

const DAY = 86400000;
const NOW = new Date(2026, 9, 8, 12).getTime();

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
  assert.deepEqual(acceptGame(GAME({}), ['me'], sync), { ok: true, colour: 'w', loss: false, plies: 22 });
  assert.equal(acceptGame(GAME({ Black: 'me', White: 'x' }), ['me'], sync).colour, 'b');
  assert.equal(acceptGame(GAME({}), ['someone'], sync).reason, 'not your game');
  assert.equal(acceptGame(GAME({ Result: '*' }), ['me'], sync).reason, 'unfinished');
  assert.equal(acceptGame(GAME({ Variant: 'Chess960' }), ['me'], sync).reason, 'variant');
  assert.equal(acceptGame(GAME({ Event: 'Casual blitz game' }), ['me'], sync).reason, 'casual');
  assert.equal(acceptGame(GAME({}), ['me'], { ...sync, ratedOnly: false }, { rated: false }).ok, true);
  assert.equal(acceptGame(GAME({ TimeControl: '60+0' }), ['me'], sync).reason, 'time control');
  assert.equal(acceptGame(GAME({}, '1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0'), ['me'], sync).reason, 'too short');
  // A game counts from five moves: a quick loss is the one most worth reading.
  const quickLoss = '1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. a3 a6 5. b3 b6 6. Qxf7# 1-0';
  assert.deepEqual(acceptGame(GAME({ White: 'rival', Black: 'me' }, quickLoss), ['me'], sync), {
    ok: true,
    colour: 'b',
    loss: true,
    plies: 11,
  });
  assert.equal(gameKey(GAME({})), 'lichess.org/abcd1234');
  assert.equal(gameKey(GAME({ Site: 'https://lichess.org/abcd1234/black' })), 'lichess.org/abcd1234');
});

test('new games are chosen once, every one of them, and unfinished games are not marked seen', () => {
  const sync = DEFAULT_SYNC();
  const fetched = [
    { pgn: GAME({ Site: 'https://lichess.org/g1', UTCTime: '10:00:00' }) },
    { pgn: GAME({ Site: 'https://lichess.org/g2', Result: '*' }) },
    { pgn: GAME({ Site: 'https://lichess.org/g3', UTCTime: '10:30:00' }) },
    { pgn: GAME({ Site: 'https://lichess.org/g4', UTCTime: '11:00:00' }) },
  ];
  const chosen = selectNew(fetched, { usernames: ['me'], sync, source: 'lichess', now: NOW });
  assert.deepEqual(
    chosen.map(c => c.key),
    ['lichess.org/g4', 'lichess.org/g3', 'lichess.org/g1'],
  );
  assert.equal(chosen[0].colour, 'w');
  assert.ok(!sync.seen.includes('lichess.org/g2'), 'an unfinished game is fetched again when it ends');
  // The next fetch starts a minute before the unfinished game began, so it is fetched again when it ends.
  assert.equal(sync.last.lichess, Math.min(NOW - 3600000, Date.UTC(2026, 9, 8, 9, 59, 0)));
  const reviewed = new Set(chosen.map(c => c.key));
  const again = selectNew(fetched, { usernames: ['me'], sync, source: 'lichess', now: NOW, reviewed });
  assert.equal(again.length, 0, 'nothing read is queued twice');
  // With every game finished the next fetch starts an hour before this one.
  selectNew([fetched[0]], { usernames: ['me'], sync, source: 'lichess', now: NOW, reviewed });
  assert.equal(sync.last.lichess, NOW - 3600000);
});

test('every game of the last 60 days is queued, losses first and the shortest first; not once read, failed or older', () => {
  const sync = DEFAULT_SYNC();
  const loss = (id, moves, extra = {}) => ({
    pgn: GAME({ Site: `https://lichess.org/${id}`, White: 'rival', Black: 'me', UTCDate: '2026.10.07' }, moves),
    ...extra,
  });
  const long = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 1-0';
  const short = '1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. a3 a6 5. b3 b6 6. Qxf7# 1-0';
  const fetched = [
    { pgn: GAME({ Site: 'https://lichess.org/w1' }) },
    { pgn: GAME({ Site: 'https://lichess.org/w-old', UTCDate: '2026.09.01' }), fresh: false },
    loss('l-long', long),
    loss('l-short', short),
    loss('l-old', short, { fresh: false }),
    loss('l-done', short, { fresh: false }),
    loss('l-failed', short, { fresh: false }),
    { pgn: GAME({ Site: 'https://lichess.org/l-ancient', White: 'rival', Black: 'me', UTCDate: '2026.07.01' }, short), fresh: false },
  ];
  sync.failed = ['lichess.org/l-failed'];
  const chosen = selectNew(fetched, { usernames: ['me'], sync, source: 'lichess', now: NOW, reviewed: new Set(['lichess.org/l-done']) });
  assert.deepEqual(
    chosen.map(c => c.key),
    ['lichess.org/l-short', 'lichess.org/l-old', 'lichess.org/l-long', 'lichess.org/w1', 'lichess.org/w-old'],
  );
  // A game seen by an earlier sync but never read is queued on the next one.
  assert.deepEqual(
    selectNew([loss('l-long', long)], { usernames: ['me'], sync, source: 'lichess', now: NOW }).map(c => c.key),
    ['lichess.org/l-long'],
  );
});

test('the first Lichess sync reaches back two months and 200 games, then 60 games a sync', async () => {
  const urls = [];
  const fetchImpl = async url => {
    urls.push(String(url));
    return {
      ok: true,
      status: 200,
      text: async () => GAME({ UTCDate: '2026.08.20' }) + '\n\n\n' + GAME({ Site: 'https://lichess.org/zz' }),
    };
  };
  const sync = DEFAULT_SYNC();
  const first = await fetchLichessNew('me', sync, { fetchImpl, now: NOW });
  const q = new URL(urls[0]).searchParams;
  assert.equal(q.get('max'), String(BACKFILL_MAX));
  assert.ok(Number(q.get('since')) <= NOW - 60 * DAY);
  assert.deepEqual(
    first.map(g => [g.source, g.fresh]),
    [
      ['lichess', false],
      ['lichess', true],
    ],
  );
  sync.backfillAt = NOW;
  sync.last.lichess = NOW - DAY;
  await fetchLichessNew('me', sync, { fetchImpl, now: NOW });
  const q2 = new URL(urls[1]).searchParams;
  assert.equal(q2.get('max'), String(SYNC_MAX));
  assert.equal(q2.get('since'), String(NOW - DAY));
  // A Lichess account linked after the first sync still gets its backfill.
  sync.last.lichess = 0;
  await fetchLichessNew('me', sync, { fetchImpl, now: NOW });
  assert.equal(new URL(urls[2]).searchParams.get('max'), String(BACKFILL_MAX));
  await assert.rejects(fetchLichessNew('me', sync, { fetchImpl: async () => ({ ok: false, status: 429 }) }), /rate-limiting/);
  await assert.rejects(fetchLichessNew('me', sync, { fetchImpl: async () => ({ ok: false, status: 404 }) }), /No Lichess account/);
});

test('Chess.com returns every standard game of the two newest archives, fresh only after the last sync', async () => {
  const sync = DEFAULT_SYNC();
  sync.last.chesscom = NOW - DAY;
  const archives = { archives: ['https://api.chess.com/pub/player/me/games/2026/10'] };
  const game = (link, end_time, extra = {}) => ({
    pgn: GAME({ Site: 'Chess.com', Link: link }),
    rules: 'chess',
    rated: true,
    time_class: 'blitz',
    end_time,
    ...extra,
  });
  const month = {
    games: [
      game('https://www.chess.com/game/live/1', Math.floor((NOW - 3 * DAY) / 1000)),
      game('https://www.chess.com/game/live/2', Math.floor((NOW - 60000) / 1000)),
      { pgn: 'x', rules: 'chess960', end_time: Math.floor(NOW / 1000) },
    ],
  };
  const fetched = await fetchChessComNew('Me', sync, {
    fetchImpl: async url => ({ ok: true, status: 200, json: async () => (url.endsWith('archives') ? archives : month) }),
    now: NOW,
  });
  assert.deepEqual(
    fetched.map(g => [gameKey(g.pgn), g.fresh, g.control]),
    [
      ['www.chess.com/game/live/2', true, 'blitz'],
      ['www.chess.com/game/live/1', false, 'blitz'],
    ],
  );
  await assert.rejects(fetchChessComNew('me', sync, { fetchImpl: async () => ({ ok: false, status: 404 }) }), /No Chess.com account/);
});

test('Lichess evaluations are read from the PGN, and a game says who it was against', () => {
  const pgn = '1. e4 { [%eval 0.17] } 1... e5 { [%eval 0.2] } 2. Qh5 { [%eval -0.5] } 2... Nc6 { [%eval #3] } 3. Qxf7+ { [%eval #-2] } 1-0';
  assert.deepEqual(readEvals(pgn, 5), [17, 20, -50, MATE_EVAL, -MATE_EVAL]);
  assert.deepEqual(readEvals(pgn, 6), [17, 20, -50, MATE_EVAL, -MATE_EVAL], 'one missing after the final move is fine');
  assert.equal(readEvals(pgn, 9), null);
  assert.equal(readEvals('1. e4 e5', 2), null);
  assert.deepEqual(gameInfo(GAME({}), 'w'), { opp: 'rival', date: '2026-10-08' });
  assert.deepEqual(gameInfo(GAME({ UTCDate: '????.??.??' }), 'b'), { opp: 'me', date: '' });
});
