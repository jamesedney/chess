import { test, expect, move, open, sq } from './helpers.mjs';

test('the training menu opens the drills', async ({ page }) => {
  await open(page, 'train');
  await page.click('#train-menu');
  await page.click('#modal [data-drill="endgames"]');
  await expect(page).toHaveURL(/#drills\?drill=endgames/);
  await expect(page.locator('.drill')).toHaveCount(7);
  await expect(page.locator('nav a[data-page="today"]')).toHaveAttribute('aria-current', 'page');
});

test('an endgame drill is played against Stockfish and judged', async ({ page }) => {
  await open(page, 'drills?drill=endgames&id=kp-win');
  await expect(page.locator('#board-title')).toContainText('Promote');
  // Kd6: the defending king must give way.
  await move(page, 'e6', 'd6');
  await expect(page.locator('#board-title')).toContainText('move 2 of 12', { timeout: 60000 });
  await page.click('#eg-restart');
  await expect(page.locator('#board-title')).toContainText('move 1 of 12');
  await page.click('#eg-tip');
  await expect(page.locator('#feedback')).toContainText('Step to the side');
});

test('a drill that is lost is recorded and offers a retry', async ({ page }) => {
  await open(page, 'drills?drill=endgames&id=kq-k');
  // Give the queen away: Qd5+ Kxd5 leaves a bare king, which is a draw.
  await move(page, 'd1', 'd5');
  await expect(page.locator('#feedback')).toContainText('Drawn', { timeout: 60000 });
  await expect(page.locator('#eg-retry')).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rankup-v1')).endgames['kq-k']);
  expect(saved).toMatchObject({ tries: 1, wins: 0 });
});

test('visualisation asks where a piece ended up and scores taps', async ({ page }) => {
  await open(page, 'drills?drill=visualise');
  await page.click('#vis-start');
  await expect(page.locator('#calc-line')).not.toBeEmpty();
  await expect(page.locator('#feedback')).toContainText('Where is the');
  await sq(page, 'a1').click();
  await expect(page.locator('#vis-next')).toBeVisible();
  await expect(page.locator('#feedback')).toContainText(/Yes|It ended on/);
});

test('find every check counts checks and false alarms', async ({ page }) => {
  await open(page, 'drills?drill=checks');
  await page.click('#chk-start');
  await expect(page.locator('#board-title')).toContainText('Checks found: 0');
  await page.click('#chk-done');
  await expect(page.locator('#feedback')).toContainText('You missed');
  await expect(page.locator('#chk-next')).toBeVisible();
});
