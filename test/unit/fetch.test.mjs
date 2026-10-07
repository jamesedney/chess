import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchLichess, fetchChessCom } from '../../src/pages/review.js';

const pgn = (w, b, variant = '') =>
  `[Event "x"]\n[White "${w}"]\n[Black "${b}"]\n${variant ? `[Variant "${variant}"]\n` : ''}\n1. e4 e5 *\n`;

test('Lichess games are fetched as PGN and variants are skipped', async () => {
  let asked;
  const fake = async (url, opts) => {
    asked = { url, opts };
    return new Response([pgn('me', 'you'), pgn('you', 'me', 'Chess960'), pgn('x', 'me')].join('\n\n'), { status: 200 });
  };
  const games = await fetchLichess('me', fake);
  assert.equal(games.length, 2);
  assert.match(asked.url, /^https:\/\/lichess\.org\/api\/games\/user\/me\?max=20/);
  assert.equal(asked.opts.headers.Accept, 'application/x-chess-pgn');
  await assert.rejects(
    fetchLichess('ghost', async () => new Response('', { status: 404 })),
    /No Lichess account called ghost/,
  );
  await assert.rejects(
    fetchLichess('me', async () => {
      throw new TypeError('offline');
    }),
    /Could not reach lichess.org/,
  );
});

test('Chess.com games come from the newest monthly archives', async () => {
  const fake = async url => {
    if (url.endsWith('/archives'))
      return Response.json({ archives: ['https://api.chess.com/a/2026/09', 'https://api.chess.com/a/2026/10'] });
    if (url.endsWith('/10'))
      return Response.json({
        games: [
          { rules: 'chess', pgn: pgn('Me', 'A') },
          { rules: 'chess960', pgn: pgn('Me', 'B') },
          { rules: 'chess', pgn: pgn('C', 'Me') },
        ],
      });
    return Response.json({ games: [{ rules: 'chess', pgn: pgn('Me', 'Old') }] });
  };
  const games = await fetchChessCom('Me', fake);
  assert.deepEqual(
    games.map(g => g.match(/White "(\w+)"/)[1]),
    ['C', 'Me', 'Me'],
  );
  assert.match(games[2], /Old/, 'older archive comes last');
  await assert.rejects(
    fetchChessCom('ghost', async () => new Response('', { status: 404 })),
    /No Chess.com account called ghost/,
  );
});
