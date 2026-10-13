import { test, expect, move, open } from './helpers.mjs';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const MOVES = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4', 'Nxe5', 'Qg5', 'Nxf7', 'Qxg2'];
const FEN_BEFORE_NXF7 = 'r1b1kbnr/pppp1ppp/8/4N1q1/2BnP3/8/PPPP1PPP/RNBQK2R w KQkq - 1 5';
const DAY = 86400000;

/** A reviewed blitz game you lost after Nxf7?? with 41 seconds on your clock before it. */
function lostGame(id, created) {
  const evals = new Array(MOVES.length + 1).fill(null);
  evals[8] = 320;
  evals[9] = -550;
  return {
    id,
    key: 'key-' + id,
    complete: true,
    created,
    white: 'me',
    black: 'rival',
    result: '0-1',
    colour: 'w',
    startFen: START,
    moves: MOVES,
    evals,
    marks: [{ ply: 8, cls: 'blunder', loss: 60, best: 'c4f7', bestSan: 'Bxf7+', mistakeId: 'm' + id }],
    oppElo: 1480,
    // Clocks after each ply: White had 41 seconds before ply 8 (clocks[6]).
    clocks: [299, 299, 290, 295, 250, 290, 41, 280, 20, 275],
    tc: { base: 300, inc: 0 },
  };
}

function mistake(id) {
  return {
    id: 'm' + id,
    title: 'Instead of Nxf7',
    fen: FEN_BEFORE_NXF7,
    line: ['c4f7'],
    theme: 'Personal mistakes',
    tags: ['mate'],
    goal: 'Find the improvement.',
    explanation: 'Bxf7+ wins the queen after Kd8 Nxg5.',
    played: 'Nxf7',
    loss: 60,
    created: Date.now() - 60000,
    kind: 'missed-tactic',
    source: { reviewId: id, ply: 8 },
  };
}

/** A ledger row: a lost blitz 5+0 game, `days` ago. */
function row(i, days) {
  const t = Date.now() - days * DAY;
  return {
    k: 'lichess.org/blitz' + i,
    t,
    d: 300,
    x: 1,
    r: 0,
    c: i % 2 ? 'w' : 'b',
    tc: 'blitz',
    base: 300,
    inc: 0,
    term: 'resign',
    n: 60,
    me: 1200,
    opp: 1220,
    rated: 1,
    src: 'lichess',
  };
}

/** A version-9 state on top of the defaults. */
async function seed(page, extra = {}) {
  await page.addInitScript(
    state => {
      if (!localStorage.getItem('rankup-v1')) localStorage.setItem('rankup-v1', JSON.stringify(state));
    },
    { version: 9, onboarded: true, ...extra },
  );
}

const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('rankup-v1')));

test('a clocked game runs on your turn only, and flagging is a loss', async ({ page }) => {
  await page.clock.install();
  await seed(page, { ledger: Array.from({ length: 12 }, (_, i) => row(i, i + 1)), settings: { colour: 'w' } });
  await open(page, 'play?clock=1');
  await expect(page.locator('#play-clock')).toHaveText('5:00');
  await expect(page.locator('.focus-progress')).toContainText('you play White · 5+0');
  await expect(page.locator('#undo-game')).toBeDisabled();
  // Your first move is untimed; the clock starts once the reply is on the board.
  await move(page, 'e2', 'e4');
  await expect(page.locator('#play-status')).toContainText('Your move', { timeout: 60000 });
  await expect(page.locator('#play-clock')).not.toHaveText('5:00');
  await page.clock.fastForward('05:01');
  await expect(page.locator('#play-status')).toContainText('You lost on time');
  await expect(page.locator('#play-clock')).toHaveText('0:00');
  await expect(page.locator('#play-clock')).toHaveClass(/urgent/);
  // The board takes no more moves.
  await page.locator('#board [data-square="d2"]').click();
  await expect(page.locator('#board [data-square="d2"]')).not.toHaveClass(/selected/);
  const s = await saved(page);
  expect(s.games.at(-1)).toMatchObject({ r: 0, fl: 1, tc: '300+0', left: 0, b: 0, f: 0 });
});

test('play it again on the real clock', async ({ page }) => {
  await page.clock.install();
  await seed(page, { reviews: [lostGame('ra', Date.now() - 60000)], mistakes: [mistake('ra')] });
  await open(page, 'review');
  await expect(page.locator('.train-games')).toContainText('Play it again');
  // Hold time still so the clock reads exactly what the game gave you.
  await page.clock.pauseAt(Date.now() + 60000);
  await page.locator('[data-train="replay"]').click();
  await expect(page).toHaveURL(/#play/);
  await expect(page.locator('#play-clock')).toHaveText('0:41');
  await expect(page.locator('#play-clock')).not.toHaveClass(/urgent/);
  await expect(page.locator('#challenge-text')).toContainText('You have 0:41.');
  await expect(page.locator('.focus-progress')).toContainText('Maia 1500 · you play White · 5+0');
  await page.clock.fastForward('00:42');
  await expect(page.locator('#play-status')).toContainText('Not passed: you lost on time');
  await expect(page.locator('#replay-again')).toBeVisible();
  const s = await saved(page);
  expect(s.replays['ra:8']).toMatchObject({ tries: 1, success: false, flagged: 1, left: 0 });
  expect(s.log.some(e => e.k === 'r' && e.t === 'convert' && e.c === 0)).toBe(true);
  await page.clock.resume();
});

test('a free game runs on the clock only when the option is on', async ({ page }) => {
  await seed(page, { settings: { clock: true } });
  await open(page, 'play');
  await expect(page.locator('#play-clock')).toHaveText('5:00');
  await expect(page.locator('#board-chip')).toHaveCount(0);
  await expect(page.locator('.focus-progress')).toContainText('· 5+0');
  // Turn it off in Options: the game has not begun, so the clock goes.
  await page.click('#play-menu');
  await expect(page.locator('.checks')).toContainText('Clock: 5+0 in free games (your most played control)');
  await page.uncheck('#clock-on');
  await page.click('#close-modal');
  await expect(page.locator('#play-clock')).toHaveCount(0);
  await expect(page.locator('#board-chip')).toHaveText('White to move');
  await expect(page.locator('.focus-progress')).not.toContainText('5+0');
  expect((await saved(page)).settings.clock).toBe(false);
});

test('a free game without the option has no clock', async ({ page }) => {
  await seed(page);
  await open(page, 'play');
  await expect(page.locator('#board-chip')).toHaveText('White to move');
  await expect(page.locator('#play-clock')).toHaveCount(0);
  await expect(page.locator('.focus-progress')).not.toContainText('+0');
});
