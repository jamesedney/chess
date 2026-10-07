import { test, expect, move, open, sq } from './helpers.mjs';

test('a practice game gets a legal engine reply and supports takebacks', async ({ page }) => {
  await open(page, 'play');
  await move(page, 'e2', 'e4');
  await expect(page.locator('#history')).toContainText(/1\. e4 \S+/, { timeout: 60000 });
  await expect(page.locator('#play-status')).toContainText('Your move');
  await page.click('#undo-game');
  await expect(page.locator('#history')).toContainText('Your first move awaits');
});

test('the board can be played with the keyboard', async ({ page }) => {
  await open(page, 'play');
  await sq(page, 'e2').focus();
  await page.keyboard.press('Enter');
  await expect(sq(page, 'e2')).toHaveClass(/selected/);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(sq(page, 'e4')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#history')).toContainText('1. e4', { timeout: 60000 });
});

const TRAP = `[Event "Casual"]
[White "me"]
[Black "rival"]
[Result "0-1"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 5. Nxf7 Qxg2 6. Rf1 Qxe4+ 7. Be2 Nf3# 0-1`;

test('reviewing a game saves explained mistakes and opens the viewer', async ({ page }) => {
  await open(page, 'review');
  await page.fill('#pgn', TRAP);
  await page.selectOption('#review-colour', 'w');
  await page.click('#analyse');
  await expect(page.locator('h1')).toContainText('me – rival', { timeout: 90000 });
  await expect(page.locator('#eval-graph svg')).toBeVisible();
  await expect(page.locator('.move-list .blunder, .move-list .mistake').first()).toBeVisible();
  await expect(page.locator('.moment')).toBeVisible();
  // Step with the keyboard.
  const counter = page.locator('.viewer-controls .small');
  const before = await counter.textContent();
  await page.keyboard.press('ArrowRight');
  await expect(counter).not.toHaveText(before);
  await page.click('#practise-game');
  await expect(page.locator('.panel').first()).toContainText('From your own game');
  // The mistake bank lists it, and it can be removed and restored.
  await page.click('nav a[data-page="review"]');
  await page.click('#back-to-list').catch(() => {});
  const item = page.locator('#mistake-list .review-item').first();
  await expect(item).toContainText('Instead of');
  await item.locator('[data-archive]').click();
  await page.check('#show-archived');
  await page.locator('#mistake-list [data-restore]').first().click();
  await page.uncheck('#show-archived');
  await expect(page.locator('#mistake-list .review-item').first()).toContainText('Instead of');
});

test('a multi-game PGN offers a game picker with your colour detected', async ({ page }) => {
  await open(page, 'review');
  await page.click('#settings');
  await page.fill('#lichess-name', 'Rival');
  await page.locator('#lichess-name').blur();
  await page.click('#close-modal');
  await page.fill('#pgn', TRAP + '\n\n' + TRAP.replace('"me"', '"other"'));
  await page.click('#analyse');
  await expect(page.locator('.picker-item')).toHaveCount(2);
  await expect(page.locator('.picker-item').first()).toContainText('you played Black');
  await page.locator('[data-pick="1"]').click();
  await expect(page.locator('#review-colour')).toHaveValue('b');
});

test('recent games can be fetched from Lichess and Chess.com', async ({ page }) => {
  await page.route('https://lichess.org/api/games/user/**', route =>
    route.fulfill({ status: 200, contentType: 'application/x-chess-pgn', body: TRAP + '\n\n' + TRAP }),
  );
  await page.route('https://api.chess.com/pub/player/**', route => {
    const url = route.request().url();
    if (url.endsWith('/archives')) return route.fulfill({ json: { archives: ['https://api.chess.com/pub/player/me/games/2026/10'] } });
    return route.fulfill({ json: { games: [{ rules: 'chess', pgn: TRAP }] } });
  });
  await open(page, 'review');
  await page.click('[data-tab="lichess"]');
  await page.fill('#username', 'me');
  await page.click('#fetch-form button');
  await expect(page.locator('.picker-item')).toHaveCount(2);
  await expect(page.locator('.picker-item').first()).toContainText('you played White');
  await page.click('[data-tab="chesscom"]');
  await page.fill('#username', 'me');
  await page.click('#fetch-form button');
  await expect(page.locator('.picker-item')).toHaveCount(1);
  await expect(page.locator('#analyse')).toHaveText('Analyse selected game');
});

test('pieces can be dragged, and a drag does not also count as a tap', async ({ page }) => {
  await open(page, 'train?puzzle=p001');
  await sq(page, 'e1').dragTo(sq(page, 'e8'));
  await expect(page.locator('#feedback')).toContainText('Solved without help');
});

test('play it out keeps the side you solved with', async ({ page }) => {
  await open(page, 'train?puzzle=p004b'); // reversed colours: Black solves
  await page.click('#solution');
  await expect(page.locator('#play-out')).toBeVisible();
  await page.click('#play-out');
  // Stockfish (White) replies first, then it is the user's move as Black.
  await expect(page.locator('#play-status')).toContainText('Your move', { timeout: 60000 });
  await expect(page.locator('#board-chip')).toHaveText('Black to move');
});

test('arrow keys in the viewer do not pile up or leak into other pages', async ({ page }) => {
  await open(page, 'review');
  await page.fill('#pgn', TRAP);
  await page.click('#analyse');
  await expect(page.locator('.viewer-controls')).toBeVisible({ timeout: 90000 });
  await page.keyboard.press('Home');
  for (let i = 0; i < 25; i++) await page.keyboard.press('ArrowRight');
  await expect(page.locator('.viewer-controls .small')).toHaveText('14 / 14');
  await page.click('nav a[data-page="train"]');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('h1')).toContainText('Make your next move count');
});

test.describe('board interaction', () => {
  test('tap to select, tap again to deselect, tap another piece to switch', async ({ page }) => {
    await open(page, 'play');
    const e2 = await sq(page, 'e2').elementHandle();
    await sq(page, 'e2').click();
    await expect(sq(page, 'e2')).toHaveClass(/selected/);
    await expect(sq(page, 'e4')).toHaveClass(/dot/);
    expect(await e2.evaluate(el => el.isConnected), 'squares are updated in place, not rebuilt').toBe(true);
    await sq(page, 'e2').click();
    await expect(sq(page, 'e2')).not.toHaveClass(/selected/);
    await sq(page, 'g1').click();
    await sq(page, 'd2').click();
    await expect(sq(page, 'd2')).toHaveClass(/selected/);
    await expect(sq(page, 'g1')).not.toHaveClass(/selected/);
    // An illegal square quietly clears the selection.
    await sq(page, 'd6').click();
    await expect(sq(page, 'd2')).not.toHaveClass(/selected/);
    await expect(page.locator('#history')).toContainText('Your first move awaits');
    // A quick select-and-place still moves.
    await sq(page, 'g1').click();
    await sq(page, 'f3').click();
    await expect(page.locator('#history')).toContainText('1. Nf3', { timeout: 60000 });
  });

  test('a dragged piece follows the pointer and snaps back when dropped off target', async ({ page }) => {
    await open(page, 'play');
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.locator('#board').scrollIntoViewIfNeeded();
    const box = async s => {
      const b = await sq(page, s).boundingBox();
      return [b.x + b.width / 2, b.y + b.height / 2];
    };
    const [x1, y1] = await box('e2');
    const [x2, y2] = await box('e5');
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    await page.mouse.move(x2, y2, { steps: 8 });
    await expect(page.locator('.drag-ghost')).toBeVisible();
    await expect(sq(page, 'e2')).toHaveClass(/drag-origin/);
    await page.mouse.up();
    await expect(page.locator('.drag-ghost')).toHaveCount(0);
    await expect(sq(page, 'e2')).toHaveClass(/selected/);
    await expect(page.locator('#history')).toContainText('Your first move awaits');
    const [x3, y3] = await box('e4');
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    await page.mouse.move(x3, y3, { steps: 8 });
    await expect(sq(page, 'e4')).toHaveClass(/drag-over/);
    await page.mouse.up();
    await expect(page.locator('#history')).toContainText('1. e4', { timeout: 60000 });
  });
});

test('pieces can be dragged with a finger on a touch screen @mobile', async ({ page }) => {
  await open(page, 'play');
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
  await expect(page.locator('#history')).toContainText('1. d4', { timeout: 60000 });
  // Tap-to-move works on touch too.
  await expect(page.locator('#play-status')).toContainText('Your move', { timeout: 60000 });
  await sq(page, 'g1').tap();
  await sq(page, 'f3').tap();
  await expect(page.locator('#history')).toContainText(/2\. Nf3/, { timeout: 60000 });
});
