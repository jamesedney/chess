import { test, expect, move, open } from './helpers.mjs';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const MOVES = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4', 'Nxe5', 'Qg5', 'Nxf7', 'Qxg2'];
const FEN_BEFORE_NXF7 = 'r1b1kbnr/pppp1ppp/8/4N1q1/2BnP3/8/PPPP1PPP/RNBQK2R w KQkq - 1 5';
const DAY = 86400000;

/** A reviewed game you lost after Nxf7?? when Bxf7+ was winning, linked to ledger row `key`. */
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

/** A blitz 5+0 ledger row ending at `t`: a loss on time by default. */
function row(k, t, r = 0) {
  return {
    k,
    t,
    d: 300,
    x: 1,
    r,
    c: 'w',
    tc: 'blitz',
    base: 300,
    inc: 0,
    term: r === 0 ? 'time' : 'resign',
    n: 60,
    me: 1200,
    opp: 1220,
    rated: 1,
    src: 'lichess',
  };
}

/** A version-9 state on top of the defaults: two lost games reviewed, not yet debriefed. */
async function seed(page, extra = {}) {
  const now = Date.now();
  const reviews = [
    lostGame('ra', now - 60000, { gameKey: 'lichess.org/g10' }),
    lostGame('rb', now - 3600000, { gameKey: 'lichess.org/g9' }),
  ];
  await page.addInitScript(
    state => {
      if (!localStorage.getItem('rankup-v1')) localStorage.setItem('rankup-v1', JSON.stringify(state));
    },
    { version: 9, onboarded: true, reviews, mistakes: [mistake('ra'), mistake('rb')], ...extra },
  );
}

/** Ten blitz games over the last ten days, seven lost; the two newest are the reviewed ones. */
function streakLedger() {
  const now = Date.now();
  return Array.from({ length: 10 }, (_, i) => {
    const n = i + 1;
    const t = n === 10 ? now - 60000 : n === 9 ? now - 3600000 : now - (10 - n) * DAY;
    return row('lichess.org/g' + n, t, [1, 4, 7].includes(n) ? 1 : 0);
  });
}

async function runDebrief(page) {
  await open(page, 'review');
  await page.locator('[data-train="debrief"]').click();
  await expect(page.locator('#board-title')).toHaveText('Find the better move');
  await move(page, 'c4', 'f7');
  await expect(page.locator('.reason-pick')).toContainText('What went wrong?');
  await page.locator('[data-reason="chance"]').click();
  await expect(page.locator('.debrief-summary')).toContainText('The moment that decided it');
}

test('the debrief summary says where a lost game was lost', async ({ page }) => {
  await seed(page);
  await runDebrief(page);
  const summary = page.locator('.debrief-summary');
  await expect(summary.locator('.anatomy')).toHaveText('Lost at move 5 (opening), from +3.2.');
  // Outside streak mode the reason sentence stays as it was.
  await expect(summary).toContainText('most common reason');
  await expect(summary.locator('.leak-note')).toHaveCount(0);
});

test('in streak mode the debrief summary names the leak and the habit', async ({ page }) => {
  await seed(page, { ledger: streakLedger() });
  await runDebrief(page);
  const summary = page.locator('.debrief-summary');
  await expect(summary.locator('.anatomy')).toContainText('Lost at move 5 (opening), from +3.2');
  await expect(summary.locator('.leak-note')).toContainText(
    'The leak: the clock, 7 of 7 losses. Habit: Under 30 seconds, play the simple move at once.',
  );
  await expect(summary).not.toContainText('most common reason');
});
