import { test, expect, move, open } from './helpers.mjs';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const MOVES = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4', 'Nxe5', 'Qg5', 'Nxf7', 'Qxg2'];
const FEN_BEFORE_NXF7 = 'r1b1kbnr/pppp1ppp/8/4N1q1/2BnP3/8/PPPP1PPP/RNBQK2R w KQkq - 1 5';

/** A reviewed game you lost after Nxf7?? when Bxf7+ was winning. */
function lostGame(id, created, extra = {}) {
  const evals = new Array(MOVES.length + 1).fill(null);
  evals[8] = 320; // White (you) clearly better before the blunder
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
    ...extra,
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

/** A version-7 state on top of the defaults: games reviewed, not yet debriefed. */
async function seed(page, extra = {}) {
  const now = Date.now();
  const reviews = [lostGame('ra', now - 60000), lostGame('rb', now - 3600000)];
  await page.addInitScript(
    state => {
      if (!localStorage.getItem('rankup-v1')) localStorage.setItem('rankup-v1', JSON.stringify(state));
    },
    { version: 7, onboarded: true, reviews, mistakes: [mistake('ra'), mistake('rb')], ...extra },
  );
}

const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('rankup-v1')));

test('a debrief finds the better move at each decisive moment and asks why it went wrong', async ({ page }) => {
  await seed(page);
  await open(page, 'review');
  await expect(page.locator('.train-games')).toContainText('Debrief 2 games');
  await page.locator('[data-train="debrief"]').click();
  await expect(page.locator('.focus-progress')).toHaveText('Debrief · 0 of 1 moment');
  await expect(page.locator('#board-title')).toHaveText('Find the better move');
  await move(page, 'c4', 'f7');
  await expect(page.locator('.reason-pick')).toContainText('What went wrong?');
  // A missed tactic: "Missed my chance" is offered first.
  await expect(page.locator('.reason-grid .suggested')).toContainText('Missed my chance');
  await page.locator('[data-reason="chance"]').click();
  await expect(page.locator('.debrief-summary')).toContainText('The moment that decided it');
  await expect(page.locator('.debrief-summary')).toContainText('Missed my chance');
  const s = await saved(page);
  const r = s.reviews.find(x => x.id === s.reviews[0].id);
  expect(r.debriefed).toBe(true);
  expect(r.marks[0].reason).toBe('chance');
  expect(s.log.some(e => e.k === 'b' && e.t === 'chance')).toBe(true);
  // Tapping Games again goes back to the list, now with one debrief left.
  await page.click('nav a[data-page="review"]');
  await expect(page.locator('.train-games')).toContainText('Debrief your latest game');
});

test('play it again starts from the position before the blunder against your opponent’s strength', async ({ page }) => {
  await seed(page);
  await open(page, 'review');
  await expect(page.locator('.train-games')).toContainText('Play it again: 2 positions');
  await page.locator('[data-train="replay"]').click();
  await expect(page).toHaveURL(/#play/);
  await expect(page.locator('.objective')).toContainText('You were winning here (+3.2) and played Nxf7');
  // Rated 1480: Maia 1500.
  await expect(page.locator('.focus-progress')).toContainText('Maia 1500');
  await expect(page.locator('#board')).toHaveAttribute('data-fen', FEN_BEFORE_NXF7);
  await move(page, 'c4', 'f7');
  await expect(page.locator('#play-status')).toContainText('Your move', { timeout: 30000 });
  await expect(page.locator('.objective')).toContainText('Move 1 of 30');
  await page.click('#give-up');
  await expect(page.locator('#play-status')).toContainText('The win slipped again');
  await expect(page.locator('#replay-again')).toBeVisible();
  const s = await saved(page);
  expect(Object.values(s.replays)).toEqual([{ tries: 1, success: false, last: expect.any(String) }]);
  expect(s.log.some(e => e.k === 'r' && e.t === 'convert' && e.c === 0)).toBe(true);
});

test('the repertoire drill asks for your move, or the better one where you lost ground', async ({ page }) => {
  await seed(page);
  await open(page, 'drills?drill=repertoire');
  await expect(page.locator('#main')).toContainText('Your openings, from your games');
  await page.click('#rep-start');
  // Positions where you lost ground come first: here Nxf7, where Bxf7+ was better.
  await expect(page.locator('.focus-meta')).toContainText('After 1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5');
  await move(page, 'e5', 'f7');
  await expect(page.locator('#feedback')).toContainText('That is what you played, and it cost you');
  await move(page, 'c4', 'f7');
  await expect(page.locator('#feedback')).toContainText('Yes: Bxf7+');
  await expect(page.locator('#feedback')).toContainText('Better than Nxf7');
  await page.click('#rep-next');
  // Then your own moves, from the first.
  await expect(page.locator('.focus-meta')).toContainText('The first move');
  await move(page, 'a2', 'a3');
  await expect(page.locator('#feedback')).toContainText('Not your move here');
  await page.click('#rep-show');
  await expect(page.locator('#feedback')).toContainText('The move is e4');
  const s = await saved(page);
  expect(Object.keys(s.rep).length).toBe(2);
  // Neither was clean: one wrong try first, one shown.
  expect(s.log.filter(e => e.k === 'o').map(e => e.c)).toEqual([0, 0]);
});

test('the pace drill times each position and the pause drill locks the board first', async ({ page }) => {
  await page.clock.install();
  await open(page, 'train?mode=daily&clock=pace&limit=2');
  await expect(page.locator('.focus-top .chip')).toHaveText('Pace drill');
  await expect(page.locator('#drill-clock')).toHaveText(/^1[45]s$/);
  // Wait until the clock is running (after the opponent's setup move), then let it run out.
  await expect(page.locator('#drill-clock')).toHaveText(/^1[0-4]s$/);
  await page.clock.fastForward('00:16');
  await expect(page.locator('#feedback')).toContainText('Out of time', { timeout: 20000 });
  await page.goto('./#train?mode=daily&clock=pause&limit=2');
  await page.reload();
  await expect(page.locator('.focus-top .chip')).toHaveText('Pause drill');
  await expect(page.locator('#feedback')).toContainText(/Hands off for 8 seconds|played/);
  await page.clock.fastForward('00:10');
  await expect(page.locator('#feedback')).toContainText('Now choose your move');
  await expect(page.locator('#drill-clock')).toHaveText('Go');
});

test('the You page shows whether it is working, your habits and your clock', async ({ page }) => {
  await seed(page);
  await open(page, 'progress');
  await expect(page.locator('#working-title')).toContainText('Is it working?');
  // Two games, both in the last two weeks: not enough to compare yet, and it says so once.
  await expect(page.locator('#main')).toContainText('Comparisons start with three reviewed games');
  await expect(page.locator('#main')).toContainText('So far: 2 and 0');
  await expect(page.locator('#habits-title')).toBeVisible();
  await expect(page.locator('#main')).toContainText('Debrief a game to start');
});
