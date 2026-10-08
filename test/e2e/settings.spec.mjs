import fs from 'node:fs';
import { test, expect, open } from './helpers.mjs';

const V1 = {
  version: 1,
  records: { p001: { tries: 1, clean: 1, box: 1, due: 0, last: 0 } },
  mistakes: [
    {
      id: 'mabc',
      title: 'Instead of Qh5',
      fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
      line: ['g1f3'],
      theme: 'Personal mistakes',
      goal: 'Find the improvement.',
      explanation: 'x',
      played: 'Qh5',
      loss: 150,
      created: 1,
    },
  ],
  days: {},
  read: [],
  ratings: [],
  level: 1,
  goal: 8,
  coach: true,
  skill: 3,
};

test('progress from version 1.0 carries over', async ({ page }) => {
  await page.addInitScript(v1 => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('rankup-v1', v1);
      sessionStorage.setItem('seeded', '1');
    }
  }, JSON.stringify(V1));
  await open(page);
  await page.click('#train-menu');
  await expect(page.locator('#modal [data-mode="mistakes"]')).toContainText('My mistakes · 1');
  await expect(page.locator('#modal .stat-row')).toContainText('1100');
});

test('unreadable saved data is kept for recovery', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('rankup-v1', '{"version":1,"records":');
      sessionStorage.setItem('seeded', '1');
    }
  });
  await open(page);
  await expect(page.locator('#toast')).toContainText('could not be read');
  await page.click('#settings');
  await expect(page.locator('#recovery-download')).toBeVisible();
});

test('backup export and import round-trip, and dark mode applies', async ({ page }, info) => {
  await open(page, 'train?puzzle=p001');
  await page.locator('#board [data-square="e1"]').click();
  await page.locator('#board [data-square="e8"]').click();
  await expect(page.locator('#feedback')).toContainText('Solved');
  await page.click('#settings');
  await page.selectOption('#appearance', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#backup')]);
  const file = info.outputPath('backup.json');
  await download.saveAs(file);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(saved.version).toBe(5);
  expect(saved.records.p001.clean).toBe(1);
  // Reset, then restore.
  await page.click('#reset');
  await page.click('#confirm [data-answer="yes"]');
  await expect(page.locator('#focus-progress')).toContainText('rating 800');
  await expect(page).toHaveURL(/#train$/);
  await page.click('#settings');
  await page.setInputFiles('#restore-file', file);
  await page.click('#confirm [data-answer="yes"]');
  await expect(page.locator('#toast')).toContainText('Progress restored');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.click('nav a[data-page="progress"]');
  await expect(page.locator('.stat-row')).toContainText('Total reps');
  await expect(page.locator('.stat-row .stat').nth(2)).toContainText('1');
});

test('a logged rating appears in the trend and can be deleted', async ({ page }) => {
  await open(page, 'progress');
  await page.fill('#platform', 'Lichess rapid');
  await page.fill('#rating', '1234');
  await page.click('#rating-form button[type="submit"]');
  await expect(page.locator('.rating-list')).toContainText('1234');
  await page.locator('[data-remove-rating]').first().click();
  await page.click('#confirm [data-answer="yes"]');
  await expect(page.locator('.rating-list')).not.toContainText('1234');
});

for (const name of ['train', 'coach', 'path', 'play', 'review', 'progress', 'drills?drill=endgames', 'drills?drill=visualise']) {
  test(`no horizontal overflow on a phone: ${name} @mobile`, async ({ page }) => {
    await open(page, name);
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test.describe('offline', () => {
  test.use({ serviceWorkers: 'allow' });
  test('works offline after the first visit, including the engine', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'Playwright drives service workers fully only in Chromium');
    await open(page);
    await expect(page.locator('#offline')).toHaveText('Offline training ready', { timeout: 60000 });
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('#board .square')).toHaveCount(64);
    await page.click('nav a[data-page="play"]');
    await page.locator('#board [data-square="d2"]').click();
    await page.locator('#board [data-square="d4"]').click();
    await expect(page.locator('#history')).toContainText(/1\. d4 \S+/, { timeout: 60000 });
  });
});
