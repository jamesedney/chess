import { test, expect, move, open } from './helpers.mjs';

// A Lichess export with evaluations: a rated blitz game the user (me) lost to the Scholar's-mate pattern after a blunder.
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

1. e4 { [%eval 0.17] [%clk 0:05:00] } 1... e5 { [%eval 0.2] [%clk 0:05:00] } 2. Nf3 { [%eval 0.1] [%clk 0:04:58] } 2... Nc6 { [%eval 0.2] [%clk 0:04:57] } 3. Bc4 { [%eval 0.1] [%clk 0:04:55] } 3... Nd4 { [%eval 0.9] [%clk 0:04:50] } 4. Nxe5 { [%eval -0.4] [%clk 0:04:52] } 4... Qg5 { [%eval -0.6] [%clk 0:04:45] } 5. Nxf7 { [%eval -5.5] [%clk 0:04:40] } 5... Qxg2 { [%eval -5.8] [%clk 0:04:40] } 6. Rf1 { [%eval -7.9] [%clk 0:04:35] } 6... Qxe4+ { [%eval -8.5] [%clk 0:04:35] } 7. Be2 { [%eval #-1] [%clk 0:04:30] } 7... Nf3# { [%clk 0:04:30] } 0-1`;

/** Start with a saved state that already links a Lichess account (short test games are allowed). */
async function seed(page, extra = {}) {
  await page.addInitScript(
    state => {
      if (!localStorage.getItem('rankup-v1')) localStorage.setItem('rankup-v1', JSON.stringify(state));
    },
    { version: 4, profiles: { lichess: 'me', chesscom: '' }, sync: { minMoves: 3 }, ...extra },
  );
}

test('a linked account is synced, the game is reviewed in the background, and the loop asks you to drill it', async ({ page }) => {
  let calls = 0;
  await page.route('https://lichess.org/api/games/user/**', route => {
    calls++;
    expect(route.request().url()).toContain('evals=true');
    route.fulfill({ status: 200, contentType: 'application/x-chess-pgn', body: LICHESS_PGN });
  });
  await seed(page);
  await open(page, 'train');
  await page.click('#settings');
  await page.click('#sync-now');
  await expect(page.locator('#toast')).toContainText('1 new game queued', { timeout: 20000 });
  expect(calls).toBe(1);
  await page.click('#close-modal');
  // The review finishes in the background and offers itself; the saved mistakes become the next step.
  await expect(page.locator('#toast')).toContainText('me – rival reviewed', { timeout: 120000 });
  await expect(page.locator('.guide')).toContainText('mistake', { timeout: 20000 });
  await expect(page.locator('.guide')).toContainText('against rival');
  await page.click('#guide-go');
  await expect(page.locator('.focus-meta')).toContainText('you played');
  await expect(page.locator('#focus-progress')).toBeVisible();
  // While drilling that game, the strip steps aside.
  await expect(page.locator('.guide')).toHaveCount(0);
  // The review itself carries the opening, Lichess evaluations and time data.
  await page.click('nav a[data-page="review"]');
  await expect(page.locator('.review-item').first()).toContainText('me – rival');
  await expect(page.locator('#queue-panel')).toContainText('imported and reviewed automatically');
});

test('a second sync does not queue the same game again', async ({ page }) => {
  await page.route('https://lichess.org/api/games/user/**', route =>
    route.fulfill({ status: 200, contentType: 'application/x-chess-pgn', body: LICHESS_PGN }),
  );
  await seed(page);
  await open(page, 'train');
  await page.click('#settings');
  await page.click('#sync-now');
  await expect(page.locator('#toast')).toContainText('1 new game queued', { timeout: 20000 });
  await page.waitForTimeout(600);
  await page.click('#sync-now');
  await expect(page.locator('#toast')).toContainText('No new games', { timeout: 20000 });
});

test('the training page always shows the next step, and the session complete screen leads to it', async ({ page }) => {
  await open(page, 'train');
  await expect(page.locator('.guide')).toHaveCount(0); // a fresh adaptive session is the suggested step
  await page.click('#train-menu');
  await page.click('#modal [data-mode="mistakes"]');
  await expect(page.locator('.guide')).toContainText('puzzles at your level');
  await page.click('#guide-go');
  await expect(page.locator('.guide')).toHaveCount(0);
  await expect(page.locator('#board .square')).toHaveCount(64);
});

test('the practice opponent climbs the ladder after five wins', async ({ page }) => {
  const d = new Date().toISOString().slice(0, 10);
  await seed(page, { games: Array.from({ length: 4 }, () => ({ d, level: 'maia1100', r: 1 })), strength: 'maia1100' });
  // A game one move from mate, with White (the user) to play.
  await page.addInitScript(() => {
    localStorage.setItem(
      'rankup-practice',
      JSON.stringify({ pgn: '1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6', color: 'w', from: null, mistakes: {}, recorded: false, level: 'maia1100' }),
    );
  });
  await open(page, 'play');
  await move(page, 'h5', 'f7');
  await expect(page.locator('#play-status')).toContainText('Checkmate', { timeout: 30000 });
  await expect(page.locator('#play-status')).toContainText('Next game: Improver');
  await expect(page.locator('#difficulty')).toHaveValue('improver');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rankup-v1')));
  expect(saved.games).toHaveLength(5);
  expect(saved.strength).toBe('improver');
});
