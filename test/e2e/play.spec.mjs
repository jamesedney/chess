import { test, expect, sq, move, open, saved } from './helpers.mjs';

const game = page => page.evaluate(() => JSON.parse(localStorage.getItem('rankup-practice')));
/** The moves of the saved game, without the PGN headers. */
const moves = async page => ((await game(page)).pgn || '').replace(/\[[^\]]*\]\s*/g, '').trim();

test('a game against Nemesis: it answers like a person from its Maia network, and the game survives a reload', async ({ page }) => {
  const maia = [];
  page.on('response', r => r.url().includes('/maia/') && maia.push(`${r.status()} ${r.url().split('/maia/')[1]}`));
  await open(page, 'play');
  await expect(page.locator('.context')).toContainText('Nemesis · plays like a 1100');
  await expect(page.locator('#p-status')).toContainText('Your move');
  await expect(page.locator('#p-status')).toContainText('You play White.');
  // Before the first move there is nothing to press.
  await expect(page.locator('#p-bar button')).toHaveCount(0);
  await move(page, 'e2', 'e4');
  await expect.poll(() => moves(page), { timeout: 60000 }).toMatch(/^1\. e4 [a-hKQRBNO]/);
  await expect(page.locator('#p-status')).toContainText('Your move');
  await expect(page.locator('#p-resign')).toBeVisible();
  await expect(page.locator('.toast.show')).toHaveCount(0);
  expect(maia).toEqual(expect.arrayContaining(['200 tables.json', '200 maia-1100.bin']));
  // Nothing is said about your play during the game: no coach, no options, one quiet button.
  await expect(page.locator('#p-bar button')).toHaveCount(1);
  const fen = await page.locator('#board').getAttribute('data-fen');
  await page.reload();
  await expect(page.locator('#board')).toHaveAttribute('data-fen', fen);
  await expect(page.locator('#p-status')).toContainText('Your move');
  await expect(sq(page, 'e4').locator('img')).toBeVisible();
});

test('when the game ends you are shown the one move that cost you most, and it becomes a position to train', async ({ page }) => {
  // 1. e4 e5 2. Qh5 Nc6, you to move as White: Qxe5+ gives the queen away.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem(
      'rankup-practice',
      JSON.stringify({ v: 7, pgn: '1. e4 e5 2. Qh5 Nc6', color: 'w', traps: [], trap: null, worst: null }),
    );
  });
  await open(page, 'play');
  await expect(page.locator('#p-status')).toContainText('Your move');
  await move(page, 'h5', 'e5');
  await expect.poll(() => moves(page), { timeout: 90000 }).toMatch(/3\. Qxe5\+ \S+/);
  await expect(page.locator('#p-status')).toContainText('Your move');
  // Not a word about it while the game is on.
  await expect(page.locator('#p-status')).not.toContainText('costliest');
  const s = await saved(page);
  expect(s.mistakes).toHaveLength(1);
  expect(s.mistakes[0]).toMatchObject({ played: 'Qxe5+', game: null });
  // Resigning asks first.
  await page.click('#p-resign');
  await page.click('#confirm [data-answer="no"]');
  await expect(page.locator('#p-resign')).toBeVisible();
  await page.click('#p-resign');
  await page.click('#confirm [data-answer="yes"]');
  await expect(page.locator('#p-status')).toContainText('You resigned.');
  await expect(page.locator('#p-status')).toContainText(/Your costliest move was 3\. Qxe5\+\. \S+ was better\./);
  // Train it: the position is on the Train board, with the move you played.
  await page.click('#p-train');
  await expect(page.locator('.tabs a.active')).toHaveText('Train');
  await expect(page.locator('#t-source')).toHaveText('Your game against Nemesis');
  await expect(page.locator('#t-prompt')).toContainText('You played Qxe5+. Find the better move.');
  // Back on Play the result is still there; a new game gives you the other colour and Nemesis opens.
  await page.click('.tabs a[data-page="play"]');
  await expect(page.locator('#p-status')).toContainText('Your costliest move was 3. Qxe5+.');
  await page.click('#p-new');
  await expect(page.locator('#p-status')).not.toContainText('costliest');
  await expect.poll(() => moves(page), { timeout: 60000 }).toMatch(/^1\. \S+( \*)?$/);
  await expect(page.locator('#p-status')).toContainText('Your move');
  expect((await game(page)).color).toBe('b');
  await expect(page.locator('#board .square').first()).toHaveAttribute('data-square', 'h1');
});

test('resigning straight after a blunder still judges it, and Nemesis does not answer a resigned game', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem(
      'rankup-practice',
      JSON.stringify({ v: 7, pgn: '1. e4 e5 2. Qh5 Nc6', color: 'w', traps: [], trap: null, worst: null }),
    );
  });
  await open(page, 'play');
  await expect(page.locator('#p-status')).toContainText('Your move');
  await page.locator('#board [data-square="h5"]').click();
  await page.locator('#board [data-square="e5"]').click();
  await page.click('#p-resign');
  await page.click('#confirm [data-answer="yes"]');
  await expect(page.locator('#p-status')).toContainText('You resigned.');
  await expect(page.locator('#p-status')).toContainText('Your costliest move was 3. Qxe5+.', { timeout: 60000 });
  await expect(page.locator('#p-train')).toBeVisible();
  // Whether or not Nemesis had already answered when you resigned, it plays nothing after.
  const atResign = await moves(page);
  await page.waitForTimeout(1500);
  expect(await moves(page)).toBe(atResign);
  // A new game starts clean.
  await page.click('#p-new');
  await expect(page.locator('#p-status')).not.toContainText('resigned');
});

test('pieces can be dragged with a finger on a touch screen @mobile', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Touch input is injected through the Chrome DevTools protocol');
  await open(page, 'play');
  await expect(page.locator('#p-status')).toContainText('Your move');
  const centre = async s => {
    const b = await sq(page, s).boundingBox();
    return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
  };
  const from = await centre('d2');
  const to = await centre('d4');
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [p] : [] });
  await touch('touchStart', from);
  for (let i = 1; i <= 8; i++) await touch('touchMove', { x: from.x + ((to.x - from.x) * i) / 8, y: from.y + ((to.y - from.y) * i) / 8 });
  await touch('touchEnd');
  await expect.poll(() => moves(page), { timeout: 60000 }).toMatch(/^1\. d4 \S+/);
  // Tap-to-move works on touch too.
  await expect(page.locator('#p-status')).toContainText('Your move');
  await sq(page, 'g1').tap();
  await sq(page, 'f3').tap();
  await expect.poll(() => moves(page), { timeout: 60000 }).toMatch(/2\. Nf3/);
});
