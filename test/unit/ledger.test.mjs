import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ledgerEntry,
  ledgerFrom,
  recordLedger,
  terminationOf,
  consumedSeconds,
  mainControl,
  rowsBetween,
  lossRun,
  longestRun,
  keyFromSite,
  validateLedger,
  startOf,
  endOf,
  score,
  MAX_LEDGER,
} from '../../src/ledger.js';
import { fetchLichessNew, fetchChessComNew, selectNew, DEFAULT_SYNC, LEDGER_MAX, SYNC_MAX } from '../../src/sync.js';
import { defaults, validate, migrate, logGame, CURRENT_VERSION } from '../../src/state.js';
import { applyDeepResult } from '../../src/deep.js';

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 13, 21, 0, 0);

/** A PGN with headers over `moves`; `clocks` (seconds left after each ply) become %clk comments. */
function pgn(headers, moves = 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7', { clocks = null, evals = false } = {}) {
  const sans = moves.split(' ');
  const body = sans
    .map((m, i) => {
      const num = i % 2 === 0 ? `${i / 2 + 1}. ` : '';
      const clk = clocks
        ? ` { [%clk ${Math.floor(clocks[i] / 3600)}:${String(Math.floor((clocks[i] % 3600) / 60)).padStart(2, '0')}:${String(clocks[i] % 60).padStart(2, '0')}] }`
        : '';
      return `${num}${m}${clk}`;
    })
    .join(' ');
  const h = {
    Event: 'Rated blitz game',
    Site: 'https://lichess.org/abcd1234',
    White: 'me',
    Black: 'rival',
    Result: '0-1',
    UTCDate: '2026.10.13',
    UTCTime: '20:30:00',
    WhiteElo: '1203',
    BlackElo: '1250',
    Variant: 'Standard',
    TimeControl: '300+0',
    Termination: 'Normal',
    ...headers,
  };
  return (
    Object.entries(h)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `[${k} "${v}"]`)
      .join('\n') +
    '\n\n' +
    body +
    ' ' +
    (h.Result || '*')
  );
}
const WHITE_CLOCKS = [298, 299, 290, 295, 285, 288, 280, 280, 270, 275]; // ply order: w, b, w, b ...
const START = Date.UTC(2026, 9, 13, 20, 30, 0);

test('a Lichess loss on time with clocks: exact end time, duration, elos and the loser’s side', () => {
  const row = ledgerEntry(pgn({ Termination: 'Time forfeit' }, undefined, { clocks: WHITE_CLOCKS }), {
    usernames: ['me'],
    source: 'lichess',
  });
  assert.equal(row.term, 'time');
  assert.equal(row.r, 0);
  assert.equal(row.c, 'w');
  assert.equal(row.x, 1);
  assert.equal(row.d, 30 + 25, 'White used 30 s, Black 25 s');
  assert.equal(row.t, START + 55000);
  assert.equal(startOf(row), START);
  assert.equal(endOf(row), row.t);
  assert.deepEqual(
    [row.me, row.opp, row.rated, row.src, row.tc, row.base, row.inc, row.n],
    [1203, 1250, 1, 'lichess', 'blitz', 300, 0, 10],
  );
  assert.equal(row.k, 'lichess.org/abcd1234');
  const plain = ledgerEntry(pgn({ Termination: 'Time forfeit' }), { usernames: ['me'], source: 'lichess' });
  assert.equal(plain.x, 0);
  assert.equal(plain.d, null);
  assert.equal(plain.t, START, 'without clocks the start is all that is known');
});

test('Lichess terminations: mate, draw, resignation, abandonment and the rest', () => {
  const mate = pgn({ Result: '1-0' }, 'e4 e5 Bc4 Nc6 Qh5 Nf6 Qxf7#');
  assert.equal(ledgerEntry(mate, { usernames: ['me'], source: 'lichess' }).term, 'mate');
  assert.equal(ledgerEntry(mate, { usernames: ['me'], source: 'lichess' }).r, 1);
  assert.equal(ledgerEntry(pgn({ Result: '1/2-1/2' }), { usernames: ['me'], source: 'lichess' }).term, 'draw');
  assert.equal(ledgerEntry(pgn({}), { usernames: ['me'], source: 'lichess' }).term, 'resign');
  assert.equal(ledgerEntry(pgn({ Termination: 'Abandoned' }), { usernames: ['me'], source: 'lichess' }).term, 'abandon');
  assert.equal(ledgerEntry(pgn({ Termination: 'Rules infraction' }), { usernames: ['me'], source: 'lichess' }).term, 'other');
  assert.equal(ledgerEntry(pgn({ Event: 'Casual blitz game' }), { usernames: ['me'], source: 'lichess' }).rated, 0);
});

test('a Chess.com game: the end time from the site, the loser’s result string, ratings from the JSON', () => {
  const p = pgn(
    {
      Site: 'Chess.com',
      Link: 'https://www.chess.com/game/live/77',
      Black: 'me',
      White: 'rival',
      Result: '1-0',
      Termination: 'rival won by checkmate',
    },
    'e4 e5 Bc4 Nc6 Qh5 Nf6 Qxf7#',
  );
  const row = ledgerEntry(p, {
    usernames: ['Me'],
    source: 'chesscom',
    ended: NOW - 60000,
    control: 'blitz',
    rated: true,
    results: { w: 'win', b: 'checkmated' },
    ratings: { w: 1300, b: 1188 },
  });
  assert.equal(row.k, 'www.chess.com/game/live/77');
  assert.equal(row.t, NOW - 60000);
  assert.equal(row.c, 'b');
  assert.equal(row.r, 0);
  assert.equal(row.term, 'mate');
  assert.deepEqual([row.me, row.opp, row.src], [1188, 1300, 'chesscom']);
  for (const [word, term] of Object.entries({
    timeout: 'time',
    resigned: 'resign',
    abandoned: 'abandon',
    agreed: 'draw',
    repetition: 'draw',
    stalemate: 'draw',
    insufficient: 'draw',
    '50move': 'draw',
    timevsinsufficient: 'draw',
  }))
    assert.equal(terminationOf({ results: { w: 'win', b: word }, colour: 'b', result: '1-0' }), term, word);
  // Unknown result strings fall back to the Termination sentence.
  assert.equal(
    terminationOf({ headers: { Termination: 'rival won on time' }, results: { w: 'win', b: 'lose' }, colour: 'b', result: '1-0' }),
    'time',
  );
  assert.equal(terminationOf({ headers: { Termination: 'Game drawn by agreement' }, colour: 'w', result: '1/2-1/2' }), 'draw');
  assert.equal(terminationOf({ headers: { Termination: 'me won - game abandoned' }, colour: 'w', result: '1-0' }), 'abandon');
  // EndDate/EndTime headers give the end when the site did not.
  const ended = ledgerEntry(
    pgn({ Site: 'Chess.com', Link: 'https://www.chess.com/game/live/78', UTCTime: '23:58:00', EndTime: '00:03:10' }),
    { usernames: ['me'], source: 'chesscom' },
  );
  assert.equal(ended.t, Date.UTC(2026, 9, 14, 0, 3, 10), 'an end time past midnight is the next day');
});

test('games that are not finished, not standard, not yours or unreadable make no row', () => {
  assert.equal(ledgerEntry(pgn({ Result: '*' }), { usernames: ['me'], source: 'lichess' }), null);
  assert.equal(ledgerEntry(pgn({ Variant: 'Chess960' }), { usernames: ['me'], source: 'lichess' }), null);
  assert.equal(ledgerEntry(pgn({}), { usernames: ['someone'], source: 'lichess' }), null);
  assert.equal(
    ledgerEntry(pgn({ UTCDate: undefined, UTCTime: undefined }), { usernames: ['me'], source: 'lichess' }),
    null,
    'no time, no row',
  );
  assert.equal(ledgerEntry('[White "me"]\n\n1. e9 *', { usernames: ['me'], source: 'lichess' }), null);
});

test('consumed seconds count both sides and the increment, and cap at the control', () => {
  assert.equal(consumedSeconds(WHITE_CLOCKS, { base: 300, inc: 0 }), 55);
  assert.equal(consumedSeconds(WHITE_CLOCKS, { base: 300, inc: 2 }), 55 + 2 * 10);
  assert.equal(consumedSeconds([0, 0], { base: 60, inc: 0 }), 120);
  assert.equal(consumedSeconds([0, 0, 0, 0], { base: 1, inc: 0 }), 2, 'capped at twice the base');
  assert.equal(consumedSeconds(null, { base: 300, inc: 0 }), null);
});

test('the ledger merges on key, stays in time order and keeps the newest 400', () => {
  const ledger = [];
  const row = (k, t, r = 0) => ({
    k,
    t,
    d: null,
    x: 0,
    r,
    c: 'w',
    tc: 'blitz',
    base: 300,
    inc: 0,
    term: 'resign',
    n: 40,
    me: null,
    opp: null,
    rated: 1,
    src: 'lichess',
  });
  assert.equal(recordLedger(ledger, [row('b', 2), row('a', 1)]), 2);
  assert.deepEqual(
    ledger.map(r => r.k),
    ['a', 'b'],
  );
  assert.equal(recordLedger(ledger, [row('a', 1, 1)]), 0, 'a known key is replaced, not added');
  assert.equal(ledger[0].r, 1);
  const many = Array.from({ length: MAX_LEDGER + 10 }, (_, i) => row('k' + i, 100 + i));
  recordLedger(ledger, many);
  assert.equal(ledger.length, MAX_LEDGER);
  assert.equal(ledger[0].k, 'k10', 'the oldest rows go: a, b and k0 to k9');
  assert.equal(validateLedger(ledger), null);
  // A row older than a full ledger is dropped at once and not counted as new.
  assert.equal(recordLedger(ledger, [row('older', 5)]), 0);
  assert.equal(ledger.length, MAX_LEDGER);
  assert.ok(!ledger.some(r => r.k === 'older'));
  // ledgerFrom skips such games before parsing them, by the end time the site gives.
  const fetched = [
    { pgn: pgn({ Site: 'https://lichess.org/old1' }), ended: 50, source: 'chesscom' },
    { pgn: pgn({ Site: 'https://lichess.org/new1' }), ended: 5000, source: 'chesscom' },
  ];
  assert.deepEqual(
    ledgerFrom(fetched, { usernames: ['me'], after: ledger[0].t }).map(r => r.k),
    ['lichess.org/new1'],
  );
});

test('main control, windows, loss runs and scores', () => {
  const row = (t, r, tc = 'blitz') => ({
    k: 'k' + t,
    t,
    d: null,
    x: 0,
    r,
    c: 'w',
    tc,
    base: 300,
    inc: 0,
    term: 'resign',
    n: 40,
    me: null,
    opp: null,
    rated: 1,
    src: 'lichess',
  });
  const ledger = [
    row(NOW - 5 * DAY, 1, 'rapid'),
    row(NOW - 4 * DAY, 1),
    row(NOW - 3 * DAY, 0),
    row(NOW - 2 * DAY, 0),
    row(NOW - DAY, 1, 'rapid'),
    row(NOW - 3600000, 0),
    row(NOW - 60000, 0),
  ];
  assert.equal(mainControl(ledger, { now: NOW }), 'blitz');
  assert.equal(mainControl([], { now: NOW }), null);
  assert.equal(mainControl(ledger, { now: NOW + 100 * DAY }), null, 'only recent games count');
  assert.equal(rowsBetween(ledger, NOW - 3 * DAY, NOW, { control: 'blitz' }).length, 4);
  assert.deepEqual(lossRun(ledger), { length: 2, endedAt: NOW - 60000 });
  assert.deepEqual(lossRun(ledger, { control: 'rapid' }), { length: 0, endedAt: null });
  assert.equal(longestRun(ledger), 2);
  assert.equal(longestRun(ledger.filter(r => r.tc === 'blitz')), 4);
  assert.equal(score(ledger), 3 / 7);
  assert.equal(score([]), null);
});

test('site keys match the sync’s game keys', () => {
  assert.equal(keyFromSite('https://lichess.org/abcd1234/black'), 'lichess.org/abcd1234');
  assert.equal(keyFromSite('https://www.chess.com/game/live/77'), 'www.chess.com/game/live/77');
  assert.equal(keyFromSite('Chess.com'), null);
});

test('the ledger is validated row by row', () => {
  const good = {
    k: 'x',
    t: 1,
    d: null,
    x: 0,
    r: 0,
    c: 'w',
    tc: 'blitz',
    base: 300,
    inc: 0,
    term: 'time',
    n: 10,
    me: 1200,
    opp: null,
    rated: 1,
    src: 'lichess',
  };
  assert.equal(validateLedger([good]), null);
  assert.equal(validateLedger([{ ...good, term: 'flag' }]), 'ledger row');
  assert.equal(validateLedger([{ ...good, t: NaN }]), 'ledger row');
  assert.equal(validateLedger([{ ...good, r: 0.3 }]), 'ledger row');
  assert.equal(validateLedger([{ ...good, me: 50 }]), 'ledger row');
  assert.equal(validateLedger('nope'), 'ledger');
  const s = defaults();
  s.ledger = [good];
  assert.equal(validate(s), null);
  s.ledger = [{ ...good, src: 'fics' }];
  assert.equal(validate(s), 'ledger row');
});

test('the first sync after 5.0 fills the ledger: 60 days and 200 games, then 60 games a sync', async () => {
  const urls = [];
  const fetchImpl = async url => {
    urls.push(String(url));
    return {
      ok: true,
      status: 200,
      text: async () => pgn({ UTCDate: '2026.08.20', UTCTime: '10:00:00' }) + '\n\n\n' + pgn({ Site: 'https://lichess.org/zz' }),
    };
  };
  const sync = DEFAULT_SYNC();
  sync.minMoves = 3; // the fixture games are short
  const first = await fetchLichessNew('me', sync, { fetchImpl, now: NOW });
  const q = new URL(urls[0]).searchParams;
  assert.equal(q.get('max'), String(LEDGER_MAX));
  assert.ok(Number(q.get('since')) <= NOW - 60 * DAY);
  assert.deepEqual(
    first.map(g => g.fresh),
    [false, true],
    'a game before the review window feeds the ledger only',
  );
  sync.ledgerAt = NOW;
  sync.last.lichess = NOW - DAY;
  await fetchLichessNew('me', sync, { fetchImpl, now: NOW });
  const q2 = new URL(urls[1]).searchParams;
  assert.equal(q2.get('max'), String(SYNC_MAX));
  assert.equal(q2.get('since'), String(NOW - DAY));
  // A Lichess account linked after the first sync still gets its backfill.
  sync.last.lichess = 0;
  await fetchLichessNew('me', sync, { fetchImpl, now: NOW });
  const q3 = new URL(urls[2]).searchParams;
  assert.equal(q3.get('max'), String(LEDGER_MAX));
  assert.ok(Number(q3.get('since')) <= NOW - 60 * DAY);
  // Ledger-only games are neither queued nor marked seen.
  const chosen = selectNew(first, { usernames: ['me'], sync, source: 'lichess', now: NOW });
  assert.deepEqual(
    chosen.map(c => c.key),
    ['lichess.org/zz'],
  );
  assert.ok(!sync.seen.includes('lichess.org/abcd1234'));
});

test('Chess.com returns every game in the archives, with results and ratings, fresh only after the last sync', async () => {
  const sync = DEFAULT_SYNC();
  sync.last.chesscom = NOW - DAY;
  const archives = { archives: ['https://api.chess.com/pub/player/me/games/2026/10'] };
  const game = (link, end_time, extra = {}) => ({
    pgn: pgn({ Site: 'Chess.com', Link: link }),
    rules: 'chess',
    rated: true,
    time_class: 'blitz',
    end_time,
    white: { username: 'me', rating: 1200, result: 'resigned' },
    black: { username: 'rival', rating: 1250, result: 'win' },
    ...extra,
  });
  const month = {
    games: [
      game('https://www.chess.com/game/live/1', Math.floor((NOW - 3 * DAY) / 1000)),
      game('https://www.chess.com/game/live/2', Math.floor((NOW - 60000) / 1000)),
    ],
  };
  const fetched = await fetchChessComNew('me', sync, {
    fetchImpl: async url => ({ ok: true, status: 200, json: async () => (url.endsWith('archives') ? archives : month) }),
    now: NOW,
  });
  assert.equal(fetched.length, 2);
  // Newest first, as the sync has always returned them.
  assert.deepEqual(
    fetched.map(g => g.fresh),
    [true, false],
  );
  const old = fetched[1];
  assert.deepEqual(old.results, { w: 'resigned', b: 'win' });
  assert.deepEqual(old.ratings, { w: 1200, b: 1250 });
  const rows = ledgerFrom(fetched, { usernames: ['me'] });
  assert.equal(rows.length, 2);
  const row = rows.find(r => r.k === 'www.chess.com/game/live/1');
  assert.equal(row.term, 'resign');
  assert.equal(row.t, Math.floor((NOW - 3 * DAY) / 1000) * 1000);
  assert.equal(row.me, 1200);
  // Known keys are skipped before any parsing; duplicates within a batch too.
  assert.equal(ledgerFrom([...fetched, fetched[1]], { usernames: ['me'], known: new Set(['www.chess.com/game/live/1']) }).length, 1);
});

test('state v9: ledger, stop line, streak, two drills and the practice clock', () => {
  assert.equal(CURRENT_VERSION, 9);
  const v8 = { ...defaults(), version: 8 };
  delete v8.ledger;
  delete v8.stop;
  delete v8.streak;
  delete v8.calc.safe;
  delete v8.calc.real;
  delete v8.settings.clock;
  delete v8.sync.ledgerAt;
  const m = migrate(v8);
  assert.equal(m.version, 9);
  assert.deepEqual(m.ledger, []);
  assert.deepEqual(m.stop, { since: null, resets: [] });
  assert.equal(m.streak, null);
  assert.deepEqual(m.calc.safe, { best: 0, runs: 0, last: [] });
  assert.equal(m.settings.clock, false);
  assert.equal(m.sync.ledgerAt, 0);
  assert.equal(validate(m), null);
  assert.equal(validate({ ...m, stop: { since: 'soon', resets: [] } }), 'stop');
  assert.equal(validate({ ...m, stop: { since: null, resets: ['x'] } }), 'stop');
  assert.equal(validate({ ...m, streak: { since: '2026-10-13', leak: 'nope', count: 1, counted: 2 } }), 'streak');
  assert.equal(validate({ ...m, streak: { since: '2026-10-13', leak: 'safety', count: 5, counted: 8 } }), null);
  assert.equal(validate({ ...m, settings: { ...m.settings, clock: 'yes' } }), 'settings');
  // Clocked practice games and replays carry optional fields.
  logGame(m, {
    level: 'maia1100',
    result: 0,
    date: '2026-10-13',
    clock: { base: 300, inc: 0 },
    left: 0,
    flagged: true,
    blunders: 2,
    fast: 1,
  });
  assert.deepEqual(m.games.at(-1), { d: '2026-10-13', level: 'maia1100', r: 0, tc: '300+0', left: 0, fl: 1, b: 2, f: 1 });
  assert.equal(validate(m), null);
  m.games.at(-1).fl = 2;
  assert.equal(validate(m), 'game');
  m.games.pop();
  m.replays.x = { tries: 1, success: false, last: '2026-10-13', flagged: 1, left: 41 };
  assert.equal(validate(m), null);
  m.replays.x.flagged = -1;
  assert.equal(validate(m), 'replay');
  delete m.replays.x;
  m.reviews.push({
    id: 'r1',
    key: 'k',
    complete: true,
    gameKey: 'lichess.org/x',
    colour: 'w',
    startFen: 'x',
    moves: [],
    evals: [],
    marks: [
      { ply: 2, refute: 'e7e5' },
      { ply: 4, refute: null },
    ],
  });
  assert.equal(validate(m), null);
  m.reviews[0].marks[0].refute = 7;
  assert.equal(validate(m), 'review marks');
});

test('a deep check refreshes the refutation stored for the drill', () => {
  const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3';
  const review = {
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4'],
    marks: [{ ply: 5, cls: 'mistake', loss: 22, best: 'g8f6', bestSan: 'Nf6', refute: 'f3e5' }],
  };
  const r = applyDeepResult({
    review,
    mark: review.marks[0],
    mistake: null,
    record: null,
    fen,
    before: { best: 'g8f6', score: 40 },
    after: { best: 'c4f7', score: 300 },
  });
  assert.equal(r, 'confirmed');
  assert.equal(review.marks[0].refute, 'c4f7');
});
