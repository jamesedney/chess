import { test, expect, move, open, sq } from './helpers.mjs';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const MOVES = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3', 'd6', 'O-O', 'O-O', 'Bg5', 'h6', 'Bh4', 'g5', 'Bg3', 'Bg4'];

async function seed(page, extra = {}) {
  await page.addInitScript(
    state => {
      if (!localStorage.getItem('rankup-v1')) localStorage.setItem('rankup-v1', JSON.stringify(state));
    },
    { version: 5, ...extra },
  );
}

test('assess the position uses your reviewed games and scores each verdict', async ({ page }) => {
  await seed(page, {
    reviews: [
      {
        id: 'rassess',
        complete: true,
        created: Date.now() - 60000,
        colour: 'w',
        white: 'me',
        black: 'rival',
        result: '1-0',
        startFen: START,
        moves: MOVES,
        evals: MOVES.map((_, i) => (i % 2 ? -30 : 40)).concat([40]),
        marks: [],
      },
    ],
  });
  await open(page, 'drills?drill=assess');
  await expect(page.locator('h2')).toContainText('Who is better');
  await page.click('#assess-start');
  await expect(page.locator('#board-title')).toHaveText('Who is better?');
  await expect(page.locator('.focus-meta')).toContainText('me – rival');
  // Every position is at the user's (White's) move, where the evaluation is +0.4: about equal.
  await page.click('[data-bucket="2"]');
  await expect(page.locator('#feedback')).toContainText('Right: about equal (+0.4)');
  await expect(page.locator('#board-title')).toContainText('Engine: +0.4');
  await page.click('#assess-next');
  await page.click('[data-bucket="4"]');
  await expect(page.locator('#feedback')).toContainText('No:');
  await expect(page.locator('#drill-progress')).toContainText('Position 2 of');
});

test('without reviewed games the assessment drill explains what it needs', async ({ page }) => {
  await open(page, 'drills?drill=assess');
  await expect(page.locator('.status')).toContainText('reviewed games');
  await expect(page.locator('#assess-start')).toHaveCount(0);
});

test('candidate moves are named before a move and checked against the engine', async ({ page }) => {
  await seed(page, { settings: { candidates: true }, coach: false, strength: 'maia1100' });
  await open(page, 'play');
  await page.click('#candidates');
  await sq(page, 'e4').click();
  await sq(page, 'd4').click();
  await expect(page.locator('#play-status')).toContainText('Candidates: e4, d4');
  await expect(sq(page, 'e4')).toHaveClass(/mark-hint/);
  await page.click('#candidates-done');
  await move(page, 'e2', 'e4');
  await expect(page.locator('#play-status')).toContainText(/among your candidates|not among your candidates/, { timeout: 60000 });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rankup-v1')));
  expect(saved.candidates.asked).toBe(1);
});

test('a strategy lesson verifies a tapped structure square', async ({ page }) => {
  await open(page, 'path?lesson=pawn-structure');
  await page.click('#lesson-next');
  await expect(page.locator('#lesson-prompt')).toContainText('isolated pawn');
  await sq(page, 'e2').click();
  await expect(page.locator('#lesson-feedback')).toContainText('Not that');
  await sq(page, 'd4').click();
  await expect(page.locator('#lesson-feedback')).toContainText('No white pawn');
});
