import { test, expect, open } from './helpers.mjs';

/** A Lichess account with a rapid rating and some history. */
async function mockLichess(page, { rating = 1180, status = 200 } = {}) {
  await page.route('https://lichess.org/api/user/**', route => {
    if (status !== 200) return route.fulfill({ status, contentType: 'application/json', body: '{}' });
    if (route.request().url().endsWith('/rating-history')) {
      const points = [];
      for (let i = 0; i < 6; i++) {
        const d = new Date(Date.now() - (100 - i * 15) * 86400000);
        points.push([d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), rating - 60 + i * 12]);
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ name: 'Rapid', points }]) });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ perfs: { rapid: { rating, games: 140 }, blitz: { rating: 1050, games: 30 } } }),
    });
  });
  await page.route('https://lichess.org/api/games/user/**', route =>
    route.fulfill({ status: 200, contentType: 'application/x-chess-pgn', body: '' }),
  );
}

const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('rankup-v1')));

test('a username is all it takes: rating, goal, level and today’s plan', async ({ page }) => {
  await mockLichess(page);
  await page.goto('./');
  await expect(page.locator('h1')).toContainText('better at chess');
  await page.fill('#setup-name', 'me');
  await page.click('#setup-form button[type="submit"]');
  await expect(page.locator('.goal-card')).toContainText('1180');
  await expect(page.locator('.goal-card')).toContainText('1400');
  await expect(page.locator('.goal-card')).toContainText('Lichess rapid');
  await expect(page.locator('.level-line')).toContainText('Calculator');
  await expect(page.locator('#start-session')).toContainText('Start today’s session');
  await expect(page.locator('.agenda-item').first()).toBeVisible();
  const s = await saved(page);
  expect(s.onboarded).toBe(true);
  expect(s.profiles.lichess).toBe('me');
  expect(s.target).toMatchObject({ perf: 'Lichess rapid', target: 1400 });
  expect(s.curriculum.units['f-scan']).toMatchObject({ done: true, placed: true });
  expect(s.puzzle.rating).toBe(1180);
  // The goal shows in the sidebar and on the You page, with the skill map.
  await page.click('nav a[data-page="progress"]');
  await expect(page.locator('h1')).toContainText('You');
  await expect(page.locator('#main')).toContainText('Skills');
  await expect(page.locator('#main')).toContainText('Endgames');
});

test('an unknown username explains itself, and the no-account path picks a level', async ({ page }) => {
  await mockLichess(page, { status: 404 });
  await page.goto('./#today');
  await page.fill('#setup-name', 'nobody');
  await page.click('#setup-form button[type="submit"]');
  await expect(page.locator('.status.error')).toContainText('No Lichess account');
  await page.click('#no-account');
  await page.locator('[data-level="0"]').click();
  await expect(page.locator('.level-line')).toContainText('Foundations');
  const s = await saved(page);
  expect(s.target.perf).toBe('Rankup puzzle rating');
  expect(s.profiles.lichess).toBe('');
});

test('one button runs the session block by block', async ({ page }) => {
  await mockLichess(page);
  await page.goto('./');
  await page.click('#no-account');
  await page.locator('[data-level="1"]').click();
  const first = await page.locator('.agenda-item strong').first().textContent();
  await page.click('#start-session');
  await expect(page.locator('#session-bar')).toBeVisible();
  await expect(page.locator('#session-bar')).toContainText('1 of');
  await expect(page.locator('#session-bar')).toContainText(first);
  // Skipping moves to the next block; the first is marked skipped.
  await page.click('#session-bar #session-next');
  await expect(page.locator('#session-bar')).toContainText('2 of');
  // Back to Today: the plan remembers where you are.
  await page.click('#session-pause');
  await expect(page).toHaveURL(/#today/);
  await expect(page.locator('#session-bar')).toBeHidden();
  await expect(page.locator('#start-session')).toContainText('Continue');
  await expect(page.locator('.agenda-item.skipped')).toHaveCount(1);
  // Changing the daily time rebuilds the plan.
  await page.selectOption('#minutes', '60');
  await expect(page.locator('#start-session')).toContainText('60 min');
});

test('a unit on the path opens with its gate and can become today’s focus', async ({ page }) => {
  await open(page, 'path');
  await page.locator('[data-unit="f-loose"]').click();
  await expect(page.locator('#modal .gate')).toContainText('puzzles cleanly');
  await page.click('#unit-focus');
  expect((await saved(page)).curriculum.current).toBe('f-loose');
  await page.goto('./#path');
  await expect(page.locator('[data-unit="f-loose"]')).toContainText('now');
});
