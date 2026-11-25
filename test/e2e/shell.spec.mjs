import { test, expect, open, state, seed, BACK_RANK } from './helpers.mjs';

test('three tabs, and old addresses land on the nearest screen', async ({ page }) => {
  await open(page, 'train');
  for (const [tab, mark] of [
    ['play', '#p-status'],
    ['you', '#y-settings'],
    ['train', '#t-prompt'],
  ]) {
    await page.click(`.tabs a[data-page="${tab}"]`);
    await expect(page.locator(mark)).toBeVisible();
    await expect(page.locator('.tabs a[aria-current="page"]')).toHaveAttribute('data-page', tab);
  }
  for (const [old, now] of [
    ['today', 'Train'],
    ['review', 'Train'],
    ['path', 'Train'],
    ['coach', 'You'],
    ['nowhere', 'Train'],
  ]) {
    await page.goto('./#' + old);
    await expect(page.locator('.tabs a.active')).toHaveText(now);
  }
  // The back button walks the screens.
  await page.goto('./#play');
  await page.click('.tabs a[data-page="you"]');
  await page.goBack();
  await expect(page.locator('.tabs a.active')).toHaveText('Play');
});

test('unreadable saved data is kept for recovery, and Settings hands it over', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) localStorage.setItem('rankup-v1', '{broken');
    sessionStorage.setItem('seeded', '1');
  });
  await open(page, 'you');
  await expect(page.locator('.toast.show')).toContainText('Saved progress could not be read');
  expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('rankup-recovery-')).length)).toBe(1);
  await page.click('.toast-close');
  await page.click('#y-settings');
  await expect(page.locator('#recovery-download')).toBeVisible();
  await page.click('#recovery-discard');
  await page.click('#confirm [data-answer="yes"]');
  expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('rankup-recovery-')).length)).toBe(0);
});

for (const screen of ['train', 'play', 'you']) {
  test(`on a phone or tablet the ${screen} screen fits the width, with the tabs under the thumb @mobile`, async ({ page }) => {
    await seed(page, state({ mistakes: [BACK_RANK] }));
    await open(page, screen);
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(await fits()).toBe(true);
    const view = page.viewportSize();
    const tabs = await page.locator('.tabs').boundingBox();
    expect(Math.round(tabs.y + tabs.height)).toBe(view.height);
    expect(tabs.width).toBe(view.width);
    if (screen !== 'you') {
      // The board runs edge to edge on a phone and is centred and large on a tablet;
      // what you press sits between it and the tabs.
      const board = await page.locator('#board').boundingBox();
      expect(Math.round(board.x * 2 + board.width)).toBe(view.width);
      if (view.width <= 600) expect(Math.round(board.width)).toBe(view.width);
      else expect(board.width).toBeGreaterThan(700);
      expect(board.y + board.height).toBeLessThan(tabs.y);
      if (screen === 'train') {
        const bar = await page.locator('#t-bar').boundingBox();
        expect(bar.y).toBeGreaterThan(board.y + board.height);
        expect(bar.y + bar.height).toBeLessThanOrEqual(tabs.y);
      }
    } else {
      await page.click('#y-settings');
      await expect(page.locator('#modal h2')).toBeFocused();
      expect(await fits()).toBe(true);
      // The sheet slides up from the bottom edge and rests there.
      const bottom = async () => {
        const sheet = await page.locator('#modal').boundingBox();
        return Math.round(sheet.y + sheet.height);
      };
      await expect.poll(bottom).toBe(view.height);
    }
  });
}

test.describe('offline', () => {
  test.use({ serviceWorkers: 'allow' });
  test('works offline after the first visit, including the engine', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'Playwright drives service workers fully only in Chromium');
    await open(page);
    // The worker is active once everything the app needs is in its cache.
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('#board .square')).toHaveCount(64);
    await expect(page.locator('#t-prompt')).toContainText('to move');
    // A game too: with its network never fetched, Nemesis falls back on the engine and still answers.
    await page.click('.tabs a[data-page="play"]');
    await page.locator('#board [data-square="d2"]').click();
    await page.locator('#board [data-square="d4"]').click();
    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('rankup-practice')).pgn), { timeout: 60000 })
      .toMatch(/1\. d4 [a-hKQRBNO]/);
    await expect(page.locator('#p-status')).toContainText('Your move');
  });
});
