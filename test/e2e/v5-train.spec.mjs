import { test, expect, open, sq } from './helpers.mjs';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
/** You (White) lose after 5. Nxf7?? when 5. Bxf7+ was winning; Qxg2 refutes it. */
const MOVES = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4', 'Nxe5', 'Qg5', 'Nxf7', 'Qxg2'];
const FEN_BEFORE_NXF7 = 'r1b1kbnr/pppp1ppp/8/4N1q1/2BnP3/8/PPPP1PPP/RNBQK2R w KQkq - 1 5';
/** An Italian where every White move from 4. d3 on leaves Black a capture or a check: safe, but tense. */
const TENSE_MOVES = [
  'e4',
  'e5',
  'Nf3',
  'Nc6',
  'Bc4',
  'Nf6',
  'd3',
  'Bc5',
  'c3',
  'd6',
  'Bb3',
  'a6',
  'Nbd2',
  'Ba7',
  'h3',
  'O-O',
  'O-O',
  'Ne7',
  'Re1',
  'Ng6',
  'Nf1',
  'Be6',
  'Bc2',
  'd5',
  'exd5',
  'Nxd5',
  'Ng3',
  'Qd7',
  'Qe2',
  'Rae8',
  'Be3',
  'Bxe3',
  'Qxe3',
  'Nxe3',
];
/** Ten plies of 3+0 with White's clock at 41 s before the ply-8 blunder, played in 2 s. */
const CLOCKS = [178, 179, 176, 178, 170, 177, 41, 176, 39, 175];

function game({ id, created, moves = MOVES, evals = [], marks = [], result = '0-1', ...extra }) {
  const ev = new Array(moves.length + 1).fill(null);
  for (const [i, v] of Object.entries(evals)) ev[Number(i)] = v;
  return {
    id,
    key: 'key-' + id,
    complete: true,
    created,
    white: 'me',
    black: 'rival',
    result,
    colour: 'w',
    startFen: START,
    moves,
    evals: ev,
    marks,
    oppElo: 1480,
    ...extra,
  };
}

/** A reviewed game lost after Nxf7??, the blunder marked with its refutation and a hung-piece mistake. */
function lostGame(id, created, extra = {}) {
  return game({
    id,
    created,
    evals: { 8: 320, 9: -550 },
    marks: [{ ply: 8, cls: 'blunder', loss: 60, best: 'c4f7', bestSan: 'Bxf7+', refute: 'g5g2', mistakeId: 'm' + id }],
    ...extra,
  });
}

/** A drawn game of safe, tense moves: every evaluation level. */
function safeGame(id, created) {
  return game({
    id,
    created,
    moves: TENSE_MOVES,
    evals: Object.fromEntries(TENSE_MOVES.map((_, i) => [i, 0]).concat([[TENSE_MOVES.length, 0]])),
    result: '1/2-1/2',
  });
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
    kind: 'hung-piece',
    source: { reviewId: id, ply: 8 },
  };
}

/** A saved state on top of the defaults: games reviewed, mistakes saved. */
async function seed(page, { reviews, mistakes, ...extra }) {
  await page.addInitScript(
    state => {
      if (!localStorage.getItem('rankup-v1')) localStorage.setItem('rankup-v1', JSON.stringify(state));
    },
    { version: 9, onboarded: true, reviews, mistakes, ...extra },
  );
}

const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('rankup-v1')));

test('safe or hanging: five seconds per position, the refutation on every miss, a run recorded', async ({ page }) => {
  await page.clock.install();
  const now = Date.now();
  // Two hanging positions (Nxf7?? twice) and a game of safe, tense moves: the set alternates hanging, safe.
  await seed(page, {
    reviews: [lostGame('ra', now - 60000), lostGame('rb', now - 3600000), safeGame('rc', now - 7200000)],
    mistakes: [mistake('ra'), mistake('rb')],
  });
  await open(page, 'train?mode=safe&limit=4');
  await expect(page.locator('#board-title')).toHaveText('Safe or hanging?');
  await expect(page.locator('#main')).toContainText('4 of your positions');
  await page.click('#safe-start');
  await expect(page.locator('.focus-top .chip')).toHaveText('Safe or hanging?');
  await expect(page.locator('#board .board-arrows .arrow-played')).toBeVisible();
  await expect(page.locator('#focus-progress')).toContainText('1 of 4');
  await expect(page.locator('#drill-clock')).toHaveText(/^[45]s$/);
  await expect(page.locator('.focus-meta')).toHaveText('Your game against rival · you played Nxf7');
  // Item 1 is hanging: Qxg2 is played on the board as the refutation.
  await page.click('#safe-no');
  await expect(page.locator('#feedback')).toContainText('Nxf7 lost 60% winning chances: Qxg2');
  await expect(page.locator('#feedback')).toHaveClass(/success/);
  await expect(sq(page, 'g2')).toHaveClass(/last/);
  // The answer stays until Next.
  await page.waitForTimeout(1500);
  await expect(page.locator('#feedback')).toContainText('Qxg2');
  await page.click('#safe-next');
  // Item 2 is safe.
  await expect(page.locator('#focus-progress')).toContainText('2 of 4');
  await expect(page.locator('#safe-yes')).toBeEnabled();
  await page.click('#safe-yes');
  await expect(page.locator('#feedback')).toContainText('Safe.');
  await page.click('#safe-next');
  // Item 3: the clock runs out.
  await expect(page.locator('#focus-progress')).toContainText('3 of 4');
  await expect(page.locator('#safe-no')).toBeEnabled();
  await expect(page.locator('#drill-clock')).toHaveText(/^[45]s$/);
  await page.clock.fastForward('00:06');
  await expect(page.locator('#feedback')).toContainText('Too slow');
  await expect(page.locator('#feedback')).toHaveClass(/error/);
  await page.click('#safe-next');
  // Item 4: answered, then the run is summed up.
  await expect(page.locator('#focus-progress')).toContainText('4 of 4');
  await expect(page.locator('#safe-yes')).toBeEnabled();
  await page.click('#safe-yes');
  await page.click('#safe-next');
  await expect(page.locator('.dark-panel')).toContainText(/[23] of 4 right/);
  await expect(page.locator('.dark-panel')).toContainText('1 too slow');
  await expect(page.locator('.dark-panel')).toContainText(/Best \d+% · 1 run/);
  const s = await saved(page);
  const rows = s.log.filter(e => e.t === 'safe');
  expect(rows.map(e => e.k)).toEqual(['p', 'p', 'p', 'p']);
  expect(rows[0].c).toBe(1);
  expect(rows[2].c).toBe(0);
  expect(s.calc.safe.runs).toBe(1);
  expect(s.calc.safe.last).toHaveLength(1);
  expect(s.calc.safe.last[0]).toMatchObject({ n: 4, hit: 1, slow: 1 });
  const today = Object.values(s.days)[0];
  expect(today.attempts).toBe(4);
  // The mode is offered from the menu once the bank is big enough; here it is not.
  await page.click('#safe-again');
  await expect(page.locator('#drill-clock')).toBeVisible();
  await page.click('#train-menu');
  await expect(page.locator('#modal [data-mode="safe"]')).toHaveCount(0);
});

test('same clock, better move: your own position with the seconds you had, out of time as in the game', async ({ page }) => {
  await page.clock.install();
  const now = Date.now();
  await seed(page, {
    reviews: [lostGame('ra', now - 60000, { tc: { base: 180, inc: 0 }, clocks: CLOCKS })],
    mistakes: [mistake('ra')],
  });
  await open(page, 'train?mode=mistakes&clock=real&limit=1');
  await expect(page.locator('.focus-top .chip')).toHaveText('Same clock');
  await expect(page.locator('#feedback')).toContainText('You had 0:41 here and played Nxf7 in 2 s. Find the better move.');
  await expect(page.locator('#drill-clock')).toHaveText(/^4[01]s$/);
  await expect(page.locator('#board')).toHaveAttribute('data-fen', FEN_BEFORE_NXF7);
  await page.clock.fastForward('00:42');
  await expect(page.locator('#feedback')).toContainText('Out of time, as in the game');
  await expect(page.locator('#drill-clock')).toHaveClass(/urgent/);
  // The solution plays, then the run ends: one position, not in time, a first attempt.
  await expect(page.locator('#feedback')).toContainText('Bxf7+');
  await page.click('#next');
  await expect(page.locator('.dark-panel')).toContainText('0 of 1 positions solved without help');
  const s = await saved(page);
  expect(s.log.filter(e => e.t === 'real')).toEqual([{ d: expect.any(String), k: 'p', t: 'real', c: 0 }]);
  expect(s.calc.real.runs).toBe(1);
  expect(s.calc.real.last).toEqual([{ d: expect.any(String), n: 1, inTime: 0, first: 1, firstInTime: 0 }]);
});
