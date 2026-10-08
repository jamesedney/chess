import { test, expect, move, open } from './helpers.mjs';

const FEN = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';

function seeded() {
  const now = Date.now();
  const mistakes = [0, 1, 2].map(i => ({
    id: 'mseed' + i,
    title: 'Instead of Qh4',
    fen: FEN,
    line: ['b8c6'],
    theme: 'Personal mistakes',
    tags: [],
    goal: 'Find the improvement.',
    explanation: 'Qh4 left your queen on h4 exposed: Nxh4 wins material. Nc6 was stronger.',
    played: 'Qh4',
    loss: 40,
    created: now - (i + 1) * 3600000,
    kind: 'hung-piece',
  }));
  return { version: 3, mistakes };
}

test('the coach diagnoses, plans and builds a lesson from your mistakes', async ({ page }) => {
  // Load once so the app writes a full default state, then seed on top of it.
  await open(page, 'train');
  await page.evaluate(state => {
    const s = JSON.parse(localStorage.getItem('rankup-v1'));
    localStorage.setItem('rankup-v1', JSON.stringify({ ...s, ...state }));
  }, seeded());
  await page.reload();
  await page.goto('./#coach');
  await expect(page.locator('h1')).toContainText('Coach');
  await expect(page.locator('.callout')).toContainText('en prise');
  await expect(page.locator('.plan-item')).toHaveCount(5);
  await expect(page.locator('.plan-item').nth(1)).toContainText('board vision');
  await expect(page.locator('.trend-table')).toContainText('Not enough data');
  await page.click('[data-lesson="my-hung-piece"]');
  await expect(page).toHaveURL(/#path\?lesson=my-hung-piece/);
  await page.click('#lesson-next');
  // The choice step: pick the right cause.
  await page.locator('.choice', { hasText: 'left material' }).click();
  await expect(page.locator('#lesson-feedback')).toContainText('exposed');
  await page.click('#lesson-next');
  await move(page, 'b8', 'c6');
  await expect(page.locator('#lesson-feedback')).toContainText('Nc6');
});

test('personal lesson moves accept engine-approved alternatives', async ({ page }) => {
  await open(page, 'train');
  await page.evaluate(state => {
    const s = JSON.parse(localStorage.getItem('rankup-v1'));
    localStorage.setItem('rankup-v1', JSON.stringify({ ...s, ...state }));
  }, seeded());
  await page.goto('./#path?lesson=my-hung-piece');
  await page.reload();
  await page.click('#lesson-next');
  await page.click('#lesson-answer');
  await page.click('#lesson-next');
  // Nf6 (attacking e4) is as good as Nc6 here.
  await move(page, 'g8', 'f6');
  await expect(page.locator('#lesson-feedback')).toContainText('works too', { timeout: 60000 });
});
