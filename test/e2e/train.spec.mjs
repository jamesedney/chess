import { test, expect, sq, move, open, state, seed, saved, quietSites, BACK_RANK } from './helpers.mjs';
import { Chess } from '../../vendor/chess.js';
import { puzzles } from '../../data/puzzles.js';

const uci = u => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });

/** The puzzle on the board, found by the position it shows once the opponent's lead-in move is played. */
async function puzzleOnBoard(page) {
  await expect(page.locator('#t-hint')).toBeEnabled();
  const fen = await page.locator('#board').getAttribute('data-fen');
  return puzzles.find(p => {
    if (!p.setup) return p.fen === fen;
    const g = new Chess(p.fen);
    g.move(uci(p.setup));
    return g.fen() === fen;
  });
}

/** Play a position's stored line: your moves by hand, the replies as the app plays them. */
async function solve(page, p) {
  const g = new Chess(p.fen);
  if (p.setup) g.move(uci(p.setup));
  for (let i = 0; i < p.line.length; i++) {
    const u = p.line[i];
    if (i % 2 === 0) {
      await move(page, u.slice(0, 2), u.slice(2, 4));
      if (u[4]) await page.click(`[data-promote="${u[4]}"]`);
    }
    g.move(uci(u));
    await expect(page.locator('#board')).toHaveAttribute('data-fen', g.fen());
  }
}

test('the app opens on a board with a puzzle: nothing to choose, nothing to set up', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#board .square')).toHaveCount(64);
  await expect(page.locator('#t-source')).toContainText(/^Puzzle · \d+$/);
  await expect(page.locator('#t-count')).toHaveText('You · 1000');
  await expect(page.locator('#t-prompt')).toContainText(/(White|Black) to move/);
  await expect(page.locator('.tabs a')).toHaveText(['Train', 'Play', 'You']);
  await expect(page.locator('.tabs a.active')).toHaveText('Train');
  // The one piece of setting up is offered, not demanded.
  await expect(page.locator('.nudge')).toHaveAttribute('href', '#you');
  expect(await page.locator('button, a').count()).toBeLessThan(75); // 64 squares, 3 tabs, 2 buttons, 2 links
});

test('a puzzle solved cleanly moves your rating and moves on by itself', async ({ page }) => {
  await open(page, 'train');
  const p = await puzzleOnBoard(page);
  expect(p, 'the position on the board is one of the puzzles').toBeTruthy();
  await solve(page, p);
  await expect(page.locator('#t-prompt')).toContainText('Solved');
  await expect(page.locator('#t-prompt .delta')).toHaveText(/^\+\d+$/);
  await expect(page.locator('.board-frame')).toHaveAttribute('data-tone', 'good');
  const s = await saved(page);
  expect(s.puzzle.count).toBe(1);
  expect(s.puzzle.rating).toBeGreaterThan(1000);
  expect(s.records[p.id]).toMatchObject({ tries: 1, clean: 1, box: 1 });
  // No button needed: the next position arrives.
  await expect(page.locator('#t-hint')).toBeVisible();
  const next = await puzzleOnBoard(page);
  expect(next.id).not.toBe(p.id);
  await expect(page.locator('#t-count')).toHaveText(`You · ${s.puzzle.rating}`);
});

test('a position from your game: your move is shown, a wrong move is refused on its square, the right one is scheduled', async ({
  page,
}) => {
  await seed(page, state({ mistakes: [BACK_RANK], profiles: { lichess: 'me', chesscom: '' }, sync: { auto: false } }));
  await quietSites(page);
  await open(page, 'train');
  await expect(page.locator('#t-source')).toHaveText(/^Your game against rival · /);
  await expect(page.locator('#t-count')).toHaveText('1 to fix');
  await expect(page.locator('#t-prompt')).toContainText('White to move');
  await expect(page.locator('#t-prompt')).toContainText('You played h3. Find the better move.');
  await expect(page.locator('#board .arrow-played')).toHaveCount(1);
  await expect(page.locator('.nudge')).toHaveCount(0);
  // Re7 is not mate: the engine checks it, and the square says no.
  await move(page, 'e1', 'e7');
  await expect(page.locator('#t-prompt')).toHaveAttribute('data-tone', 'bad', { timeout: 30000 });
  await expect(page.locator('#t-prompt')).toContainText('Not that one. Look again.');
  await expect(sq(page, 'e1').locator('img')).toBeVisible();
  // Re8 is.
  await move(page, 'e1', 'e8');
  await expect(sq(page, 'e8')).toHaveClass(/mark-good/);
  await expect(page.locator('#t-prompt')).toContainText('Solved, with help');
  await expect(page.locator('#t-prompt')).toContainText('You had a forced mate in 1');
  await expect(page.locator('#board .arrow-played')).toHaveCount(0);
  const s = await saved(page);
  expect(s.records.mback1).toMatchObject({ tries: 1, clean: 0, box: 0 });
  expect(s.puzzle.count, 'your own games do not move the puzzle rating').toBe(0);
  // It waits for you: your own game deserves a moment. Next brings a puzzle, since it was just seen.
  await page.waitForTimeout(1600);
  await expect(page.locator('#t-next')).toBeVisible();
  await page.click('#t-next');
  await expect(page.locator('#t-source')).toContainText('Puzzle');
});

test('a hint points at the piece, then the move; Show me plays the answer; neither counts as solved', async ({ page }) => {
  await seed(page, state({ mistakes: [BACK_RANK] }));
  await open(page, 'train');
  await page.click('#t-hint');
  await expect(sq(page, 'e1')).toHaveClass(/mark-hint/);
  await expect(page.locator('#t-prompt')).toContainText('Look at your rook on e1.');
  await page.click('#t-hint');
  await expect(page.locator('#board .arrow-hint')).toHaveCount(1);
  await page.click('#t-show');
  await expect(page.locator('#t-prompt')).toContainText('The move was Re8#');
  await expect(page.locator('#t-prompt')).toHaveAttribute('data-tone', 'bad');
  await expect(page.locator('#t-next')).toBeVisible();
  expect((await saved(page)).records.mback1).toMatchObject({ tries: 1, clean: 0 });
  // The space bar moves on.
  await page.locator('#main').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#t-hint')).toBeVisible();
});

test('a move as good as the stored one is accepted', async ({ page }) => {
  // After 1. e4 e5 the stored answer is Nf3; Nc3 is about as good, and the engine says so.
  const level = {
    ...BACK_RANK,
    id: 'mlevel1',
    fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
    line: ['g1f3'],
    played: 'Ke2',
    explanation: 'You played Ke2. Nf3 kept a stronger position.',
    mate: undefined,
  };
  await seed(page, state({ mistakes: [level] }));
  await open(page, 'train');
  await move(page, 'b1', 'c3');
  await expect(page.locator('#t-prompt')).toContainText('Solved', { timeout: 30000 });
  await expect(page.locator('#t-prompt')).toHaveAttribute('data-tone', 'good');
  expect((await saved(page)).records.mlevel1).toMatchObject({ tries: 1, clean: 1 });
  // Coming back to the tab keeps the finished position rather than skipping ahead.
  await page.click('.tabs a[data-page="you"]');
  await page.click('.tabs a[data-page="train"]');
  await expect(page.locator('#t-source')).toContainText('Puzzle');
});
