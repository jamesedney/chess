import { Chess } from '../../vendor/chess.js';
import { hangingPieces } from '../../src/chess-utils.js';
import { test, expect, move, open, sq } from './helpers.mjs';

test('every page loads without errors', async ({ page }) => {
  await open(page);
  await expect(page.locator('#board .square')).toHaveCount(64);
  for (const [name, selector, text] of [
    ['path', 'h1', 'Lessons'],
    ['play', '#board-title', 'Practice game'],
    ['review', 'h1', 'Your games'],
    ['progress', 'h1', 'Progress'],
  ]) {
    await page.click(`nav a[data-page="${name}"]`);
    await expect(page.locator(selector)).toContainText(text);
    await expect(page.locator(`nav a[data-page="${name}"]`)).toHaveAttribute('aria-current', 'page');
  }
  await page.goBack();
  await expect(page.locator('h1')).toContainText('Your games');
});

test('solving a puzzle cleanly updates the rating and reveals its tags', async ({ page }) => {
  await open(page, 'train?puzzle=p001');
  await expect(page.locator('#board')).toHaveAttribute('data-fen', /^6k1\/5ppp/);
  await move(page, 'e1', 'e8');
  await expect(page.locator('#feedback')).toContainText('Solved without help');
  await expect(page.locator('#feedback')).toContainText('Puzzle rating');
  await expect(page.locator('.tag-row')).toContainText('Back-rank mate');
  await expect(page.locator('#focus-progress')).toContainText('1 of 8');
  await expect(page.locator('#focus-progress')).not.toContainText('rating 800');
  // A theme's first rating starts from the overall rating before this result.
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rankup-v1')));
  expect(saved.themes['King safety'].rating).toBe(saved.puzzle.rating);
  await page.click('#next');
  await expect(page.locator('#hint')).toBeVisible();
});

test('a wrong move is rejected and an equally good alternative is accepted', async ({ page }) => {
  await open(page, 'train?puzzle=p003');
  await move(page, 'g2', 'g3');
  await expect(page.locator('#feedback')).toHaveClass(/error/);
  await move(page, 'e5', 'f7');
  await expect(page.locator('#board')).toHaveAttribute('data-fen', /k/);
  await expect(page.locator('#feedback')).toContainText('Find your next move');
  await move(page, 'f7', 'd8');
  await expect(page.locator('#feedback')).toContainText('Find your next move');
  // The stored line ends with Rd1; Ra7 wins just as clearly, so Stockfish accepts it.
  await move(page, 'a1', 'a7');
  await expect(page.locator('#feedback')).toContainText('Good recovery');
  await expect(page.locator('#feedback')).toContainText('The stored line was');
});

test('hints escalate and the solution plays out', async ({ page }) => {
  await open(page, 'train?puzzle=p004');
  await page.click('#hint');
  await expect(page.locator('#feedback')).toContainText(/defended|checks/);
  await page.click('#hint');
  await expect(sq(page, 'd2')).toHaveClass(/mark-hint/);
  await page.click('#solution');
  await expect(page.locator('#feedback')).toContainText('Study this line');
  await expect(page.locator('#play-out')).toBeVisible();
  await page.click('#play-out');
  await expect(page.locator('#board-title')).toContainText('From:');
});

test('generated puzzles start with the opponent’s move', async ({ page }) => {
  await open(page);
  // Pick any puzzle with a setup move from the data.
  const { puzzles } = await import('../../data/puzzles.js');
  const p = puzzles.find(x => x.setup);
  await open(page, 'train?puzzle=' + p.id);
  await expect(page.locator('#feedback')).toContainText('Your move', { timeout: 5000 });
  const g = new Chess(p.fen);
  g.move({ from: p.setup.slice(0, 2), to: p.setup.slice(2, 4), promotion: p.setup[4] });
  await expect(page.locator('#board')).toHaveAttribute('data-fen', g.fen());
});

test('vision sprint scores a correct capture', async ({ page }) => {
  await open(page);
  await page.click('#train-menu');
  await page.click('#modal [data-mode="vision"]');
  await page.click('#sprint-start');
  // A three-second countdown, then the clock runs.
  await expect(page.locator('#sprint-count')).toHaveText('3');
  await expect(page.locator('#sprint-time')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#sprint-time')).toHaveText(/^0:5\d$/);
  const fen = await page.locator('#board').getAttribute('data-fen');
  const [target] = hangingPieces(Chess, fen, { minValue: 3 }).filter(h => h.gain >= 3);
  const g = new Chess(fen);
  const capture = g.move(target.capture);
  await move(page, capture.from, capture.to);
  await expect(page.locator('#sprint-score')).toHaveText('1');
});

test('a lesson walks through reading, tapping, moving and deciding, and saves progress', async ({ page }) => {
  await open(page, 'path');
  await expect(page.locator('.lesson')).toHaveCount(23);
  await page.locator('[data-lesson="mating-net"]').click();
  await expect(page).toHaveURL(/#path\?lesson=mating-net/);
  await expect(page.locator('.focus-progress')).toContainText('1 of 6');
  await page.click('#lesson-next');
  // Tap step: a wrong square, then the right one.
  await sq(page, 'f8').click();
  await expect(page.locator('#lesson-feedback')).toHaveClass(/error/);
  await sq(page, 'g7').click();
  await expect(page.locator('#lesson-feedback')).toContainText('Yes');
  await page.click('#lesson-next');
  await move(page, 'e1', 'e8');
  await expect(page.locator('#lesson-feedback')).toContainText('Re8#');
  await page.click('#lesson-next');
  await move(page, 'g6', 'f7');
  await expect(page.locator('#lesson-feedback')).toContainText('stalemate');
  await move(page, 'g6', 'g7');
  await expect(page.locator('#lesson-feedback')).toContainText('Qg7#');
  // Leave and come back: progress is kept.
  await page.click('#lesson-exit');
  await expect(page.locator('.lesson:has([data-lesson="mating-net"])')).toContainText('4 of 6');
  await page.locator('[data-lesson="mating-net"]').click();
  await expect(page.locator('.focus-progress')).toContainText('5 of 6');
  await page.click('#lesson-answer');
  await expect(page.locator('#lesson-feedback')).toContainText('Qxf7#');
  await page.click('#lesson-next');
  await page.locator('[data-choice="0"]').click();
  await expect(page.locator('[data-choice="0"]')).toHaveClass(/right/);
  await page.click('#lesson-next');
  await expect(page.locator('h2')).toContainText('Recognise the mating net');
  await page.click('#lesson-practise');
  await expect(page.locator('.focus-top .chip')).toContainText('King safety');
  await page.goto('./#path');
  await expect(page.locator('.lesson:has([data-lesson="mating-net"])')).toContainText('Completed');
});
