import { test, expect, open } from './helpers.mjs';

// Today in v5: the streak and its leak, the STOP card and the play rule, and
// the ledger that feeds them from a sync.

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const MOVES = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4', 'Nxe5', 'Qg5', 'Nxf7', 'Qxg2'];
const FEN_BEFORE_NXF7 = 'r1b1kbnr/pppp1ppp/8/4N1q1/2BnP3/8/PPPP1PPP/RNBQK2R w KQkq - 1 5';
const DAY = 86400000;
const HOUR = 3600000;
const MIN = 60000;

const dateKey = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

/** A ledger row: a blitz 5+0 game of five minutes ending at `t`, exact times, result `r` from your side. */
function row(k, t, r) {
  return {
    k,
    t,
    d: 300,
    x: 1,
    r,
    c: 'w',
    tc: 'blitz',
    base: 300,
    inc: 0,
    term: 'resign',
    n: 60,
    me: 1200,
    opp: 1220,
    rated: 1,
    src: 'lichess',
  };
}

/** One sitting from `start`: each game is [result, seconds after the previous game ended]. */
function sitting(id, start, games) {
  let t = start;
  return games.map(([r, gap], i) => {
    t += gap * 1000 + 300000;
    return row(`lichess.org/${id}${i}`, t, r);
  });
}

// Ten sittings of four games, one every two days: 16 games started within 90 s
// of a loss ("straight after a loss") scoring 5 of 16, the other 24 scoring
// 13.5 (56%); no sitting reaches a fifth game.
const A = [
  [0, 0],
  [0, 60],
  [0, 60],
  [1, 300],
];
const A2 = [
  [0, 0],
  [0, 60],
  [1, 60],
  [1, 300],
];
const B = [
  [0, 0],
  [1, 60],
  [1, 300],
  [1, 300],
];
const B2 = [
  [0, 0],
  [1, 60],
  [1, 300],
  [0.5, 300],
];
const PLAN = [A, B, A, B2, A2, B, A, B, A, A];
const evenings = now => PLAN.flatMap((g, j) => sitting('ev' + j, now - (21 - 2 * j) * DAY, g));

/** The last ten games, an hour apart today: 3 of 10, the newest a loss, runs of 3, 2 and 2. */
const STREAK = [1, 0, 0, 0, 1, 0, 0, 1, 0, 0];
const streakRows = now => STREAK.map((r, i) => row('lichess.org/st' + i, now - (12 - i) * HOUR, r));

/** A reviewed game you lost after Nxf7?? when Bxf7+ was winning, linked to its ledger row by `gameKey`. */
function lostGame(id, created, gameKey) {
  // Level until Nxf7??, so the quiet moves before it feed Safe or hanging? as safe positions.
  const evals = new Array(MOVES.length + 1).fill(20);
  evals[8] = 320;
  evals[9] = -550;
  evals[10] = -580;
  return {
    id,
    key: 'key-' + id,
    gameKey,
    complete: true,
    created,
    white: 'me',
    black: 'rival',
    result: '0-1',
    colour: 'w',
    startFen: START,
    moves: MOVES,
    evals,
    marks: [{ ply: 8, cls: 'blunder', loss: 60, best: 'c4f7', bestSan: 'Bxf7+', refute: 'g5g2', mistakeId: 'm' + id }],
    oppElo: 1480,
  };
}

function mistake(id, created) {
  return {
    id: 'm' + id,
    title: 'Instead of Nxf7',
    fen: FEN_BEFORE_NXF7,
    line: ['c4f7'],
    theme: 'Personal mistakes',
    tags: ['mate'],
    goal: 'Find the improvement.',
    explanation: 'Nxf7 hangs the knight: Qxg2 wins material.',
    played: 'Nxf7',
    loss: 60,
    created,
    kind: 'hung-piece',
    source: { reviewId: id, ply: 8 },
  };
}

/** A version-9 state in streak mode: 50 ledger rows, six of the seven newest losses reviewed (a piece hung each time). */
function streakState(now) {
  const lost = streakRows(now)
    .filter(r => r.r === 0)
    .slice(-6);
  const reviews = lost.map((r, i) => lostGame('rs' + i, r.t, r.k));
  return {
    version: 9,
    onboarded: true,
    ledger: [...evenings(now), ...streakRows(now)],
    reviews,
    mistakes: reviews.map(r => mistake(r.id, r.created)),
    stop: { since: dateKey(new Date(now - 10 * DAY)), resets: [] },
  };
}

/**
 * The evenings above, the last of them ending five minutes ago with three
 * losses in a row: 41 rows, 16 straight after a loss scoring 5 of 16, and
 * three saved positions for the reset to drill.
 */
function stopState(now) {
  // The last sitting ends in three losses, two of them straight after a loss: the same buckets as A.
  const last = [
    [1, 0],
    [0, 300],
    [0, 60],
    [0, 60],
  ];
  const end = now - 5 * MIN;
  const length = last.reduce((a, [, gap]) => a + gap * 1000 + 300000, 0);
  const rows = [
    ...PLAN.slice(0, 9).flatMap((g, j) => sitting('ev' + j, now - (21 - 2 * j) * DAY, g)),
    ...sitting('tonight', end - length, last),
  ];
  return {
    version: 9,
    onboarded: true,
    ledger: rows,
    mistakes: ['a', 'b', 'c'].map(id => mistake(id, now - DAY)),
    sync: { ledgerAt: now - 10 * DAY },
  };
}

async function seed(page, state) {
  await page.addInitScript(s => {
    if (!localStorage.getItem('rankup-v1')) localStorage.setItem('rankup-v1', JSON.stringify(s));
  }, state);
}

const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('rankup-v1')));

test('one leak: Today names the streak, its leak and the habit, and the plan drills it', async ({ page }) => {
  await seed(page, streakState(Date.now()));
  await open(page, 'today');
  const streak = page.locator('section:has(#streak-head)');
  await expect(streak).toContainText('Losing 7 of your last 10');
  await expect(streak).toContainText('piece hung in one move');
  await expect(streak).toContainText('Habit:');
  // After the warm-up (Safe or hanging? too, since the games keep hanging pieces): the debrief of the newest game, then the leak's block.
  const items = page.locator('.agenda-item');
  await expect(items.nth(0)).toContainText('Safe or hanging?');
  await expect(items.nth(1)).toContainText('Debrief: your game against rival');
  await expect(items.nth(2)).toContainText('Safe or hanging?');
  await expect(items.nth(2)).toContainText('of your positions');
  // The tiles: the leak's share leads in streak mode. Six of the seven streak
  // losses are reviewed and the evenings' quick losses count as tilt, so both
  // windows hold enough classified losses for the leak row to be known.
  const tiles = page.locator('section:has(#working-head) .metric');
  await expect(tiles.first()).toContainText('Leak share');
  const s = await saved(page);
  // Six reviewed losses (a piece hung) and two evening losses queued straight after a loss: 6 of 8.
  // The background analysis may re-read a review meanwhile, so the counts are bounded, not exact.
  expect(s.streak).toMatchObject({ since: dateKey(new Date()), leak: 'safety' });
  expect(s.streak.count).toBeGreaterThanOrEqual(5);
  expect(s.streak.counted).toBeGreaterThanOrEqual(7);
  // The coach leads with the leak.
  await open(page, 'coach');
  await expect(page.locator('.findings li').first()).toContainText('The leak');
});

test('the stop line: a loss five minutes ago shows STOP, the reset runs the pause drill, and the card goes after twenty minutes', async ({
  page,
}) => {
  await page.clock.install();
  await seed(page, stopState(Date.now()));
  await open(page, 'today');
  const card = page.locator('.stop-card');
  await expect(card).toContainText('STOP.');
  await expect(card).toContainText('You lost 5 minutes ago');
  await expect(card).toContainText('5 of 16 (31%)');
  // No account is linked, so no sync time.
  await expect(card).not.toContainText('as of your last sync');
  await expect(page.locator('.rule-line.small')).toContainText('Play rule: 4 games · stop after 2 losses in a row · 2 min between games');
  await expect(page.locator('.verdict-line')).toContainText('Straight after a loss: 5 of 16 (31%)');
  // While the card is live the tonight line waits.
  await expect(page.locator('.rule-line.tonight')).toHaveCount(0);
  await page.click('#stop-reset');
  await expect(page).toHaveURL(/#train/);
  // The session bar names the block; the pause drill's lock clock sits by the board title.
  await expect(page.locator('#session-bar')).toContainText('Reset: 4 minutes');
  await expect(page.locator('#drill-clock')).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await expect(page.locator('#feedback')).toContainText(/Hands off for 8 seconds|Now choose your move/);
    await page.click('#solution');
    // The solution plays, then the position is scored: a saved mistake ends with its explanation.
    await expect(page.locator('#next')).toBeVisible();
    await expect(page.locator('#feedback')).toContainText(/Solution: Bxf7\+|Study this line/);
    if (i < 2) await page.click('#next');
  }
  await expect(page.locator('#session-bar #session-next')).toContainText(/Next|Finish/);
  await page.click('nav a[data-page="today"]');
  await expect(page.locator('.stop-card .reset-done')).toContainText('Reset done');
  await expect(page.locator('.stop-card .reset-done')).toContainText('Play one game, then come back.');
  await expect(page.locator('#stop-reset')).toHaveCount(0);
  // Twenty minutes on: the card is gone, the rule stays, tonight is shaped by the three losses.
  await page.clock.fastForward('21:00');
  await page.click('nav a[data-page="progress"]');
  await page.click('nav a[data-page="today"]');
  await expect(page.locator('.rule-line.small')).toContainText('Play rule');
  await expect(page.locator('.stop-card')).toHaveCount(0);
  await expect(page.locator('.rule-line.tonight')).toContainText(
    /^Tonight: \d games?, \d–\d\. Three losses in a row, 26 min ago\. Reset first; no game block today\.$/,
  );
  const s = await saved(page);
  expect(s.stop.resets).toHaveLength(1);
  expect(s.stop.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(s.session.blocks.find(b => b.type === 'reset')).toMatchObject({ complete: true });
});

// A Lichess export with evaluations and clocks: a rated blitz game the user (me) lost on time.
const LICHESS_PGN = `[Event "Rated blitz game"]
[Site "https://lichess.org/sync0001"]
[Date "2026.10.08"]
[White "me"]
[Black "rival"]
[Result "0-1"]
[UTCDate "2026.10.08"]
[UTCTime "09:00:00"]
[Variant "Standard"]
[TimeControl "300+0"]
[Termination "Time forfeit"]

1. e4 { [%eval 0.17] [%clk 0:05:00] } 1... e5 { [%eval 0.2] [%clk 0:05:00] } 2. Nf3 { [%eval 0.1] [%clk 0:04:58] } 2... Nc6 { [%eval 0.2] [%clk 0:04:57] } 3. Bc4 { [%eval 0.1] [%clk 0:04:55] } 3... Nd4 { [%eval 0.9] [%clk 0:04:50] } 4. Nxe5 { [%eval -0.4] [%clk 0:04:52] } 4... Qg5 { [%eval -0.6] [%clk 0:04:45] } 5. Nxf7 { [%eval -5.5] [%clk 0:04:40] } 5... Qxg2 { [%eval -5.8] [%clk 0:04:40] } 6. Rf1 { [%eval -7.9] [%clk 0:04:35] } 6... Qxe4+ { [%eval -8.5] [%clk 0:04:35] } 7. Be2 { [%eval #-1] [%clk 0:04:30] } 7... Nf3# { [%clk 0:04:30] } 0-1`;

test('a second site that fails does not stop the ledger or its backfill flag', async ({ page }) => {
  await page.route('https://lichess.org/api/user/**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(route.request().url().endsWith('/rating-history') ? [] : { perfs: { blitz: { rating: 1150, games: 60 } } }),
    }),
  );
  await page.route('https://lichess.org/api/games/user/**', route =>
    route.fulfill({ status: 200, contentType: 'application/x-chess-pgn', body: LICHESS_PGN }),
  );
  await page.route('https://api.chess.com/**', route => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
  await seed(page, { version: 4, profiles: { lichess: 'me', chesscom: 'nobody' }, sync: { minMoves: 3 } });
  await open(page, 'settings');
  await page.locator('#sync-now').click();
  await expect.poll(async () => (await saved(page)).ledger.length, { timeout: 20000 }).toBe(1);
  const s = await saved(page);
  expect(s.ledger[0].k).toBe('lichess.org/sync0001');
  expect(s.sync.ledgerAt).toBeGreaterThan(0);
  // The lock is released: a second sync runs and finds nothing new.
  await page.locator('#sync-now').click();
  await expect(page.locator('.toast.show')).toContainText('No Chess.com account called nobody', { timeout: 20000 });
});

test('the ledger fills from a sync: the game lands with its ending, result and length', async ({ page }) => {
  await page.route('https://lichess.org/api/user/**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(route.request().url().endsWith('/rating-history') ? [] : { perfs: { blitz: { rating: 1150, games: 60 } } }),
    }),
  );
  await page.route('https://lichess.org/api/games/user/**', route =>
    route.fulfill({ status: 200, contentType: 'application/x-chess-pgn', body: LICHESS_PGN }),
  );
  await seed(page, { version: 4, profiles: { lichess: 'me', chesscom: '' }, sync: { minMoves: 3 } });
  await open(page, 'today');
  await page.click('#settings');
  await page.click('#sync-now');
  await expect(page.locator('.toast.show')).toContainText(/queued|No new games|reviewed/, { timeout: 20000 });
  await expect.poll(async () => (await saved(page)).ledger.length).toBe(1);
  const s = await saved(page);
  expect(s.ledger[0]).toMatchObject({ k: 'lichess.org/sync0001', term: 'time', r: 0, x: 1, c: 'w', tc: 'blitz', src: 'lichess' });
  expect(s.ledger[0].d).toBeGreaterThan(0);
  expect(s.sync.ledgerAt).toBeGreaterThan(0);
  await page.click('#close-modal');
});
