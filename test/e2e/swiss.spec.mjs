import { test, expect, move, open } from './helpers.mjs';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const MOVES = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4', 'Nxe5', 'Qg5', 'Nxf7', 'Qxg2'];
const FEN = 'r1b1kbnr/pppp1ppp/8/4N1q1/2BnP3/8/PPPP1PPP/RNBQK2R w KQkq - 1 5';
const DAY = 86400000;

/** A lost game with Nxf7?? at ply 8; `extra` marks make older games worse. */
function game(id, created, extra = {}) {
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
    ...extra,
  };
}

/** Two weeks of better games after six weeks of worse ones, debrief notes and a rating history. */
async function seed(page, extra = {}) {
  const now = Date.now();
  const older = (id, days, reason) =>
    game(id, now - days * DAY, {
      debriefed: true,
      marks: [
        { ply: 6, cls: 'blunder', loss: 40, best: 'c4f7', bestSan: 'Bxf7+', reason },
        { ply: 8, cls: 'blunder', loss: 60, best: 'c4f7', bestSan: 'Bxf7+', mistakeId: 'm' + id, reason: 'chance' },
      ],
    });
  const reviews = [
    game('ra', now - 60000),
    game('rb', now - 3 * DAY, { debriefed: true }),
    game('rf', now - 5 * DAY, { debriefed: true }),
    older('rc', 20, 'threat'),
    older('rd', 21, 'rushed'),
    older('re', 22, 'threat'),
    older('rg', 30, 'chance'),
  ];
  const mistakes = reviews.map(r => ({
    id: 'm' + r.id,
    title: 'Instead of Nxf7',
    fen: FEN,
    line: ['c4f7'],
    theme: 'Personal mistakes',
    tags: ['mate'],
    goal: 'Find the improvement.',
    explanation: 'Bxf7+ wins the queen after Kd8 Nxg5.',
    played: 'Nxf7',
    loss: 60,
    created: now,
    kind: 'missed-tactic',
    source: { reviewId: r.id, ply: 8 },
  }));
  const day = t => new Date(t).toISOString().slice(0, 10);
  const ratings = [1380, 1374, 1391, 1388, 1399, 1402].map((rating, i) => ({
    rating,
    platform: 'Chess.com blitz',
    date: day(now - (50 - i * 10) * DAY),
  }));
  await page.addInitScript(
    state => {
      if (!localStorage.getItem('rankup-v1')) localStorage.setItem('rankup-v1', JSON.stringify(state));
    },
    { version: 7, onboarded: true, reviews, mistakes, ratings, ...extra },
  );
}

test('Today leads with the rating and its trend; the evidence lives on You', async ({ page }) => {
  await seed(page);
  await open(page, 'today');
  await expect(page.locator('.goal-numbers')).toHaveText('1402');
  await expect(page.locator('.hero-delta')).toHaveText('+14');
  await expect(page.locator('.goal-card svg.spark')).toBeVisible();
  await expect(page.locator('.metrics .metric')).toHaveCount(0);
  // The next block stands out, numbered like the rest.
  await expect(page.locator('.agenda-item.current .agenda-mark')).toHaveText('1');
  await expect(page.locator('.agenda-item.current')).toHaveCount(1);
});

test('Today: the session card, your other ratings as tiles, the drills and a Play button', async ({ page }) => {
  await seed(page, {
    sync: { perfs: { 'Chess.com blitz': 1402, 'Chess.com bullet': 943, 'Chess.com rapid': 897, 'Lichess blitz': 1500 } },
  });
  await open(page, 'today');
  await expect(page.locator('.session-hero h2')).toHaveText(await page.locator('.agenda-item.current strong').innerText());
  await expect(page.locator('#start-session')).toHaveText('Start today’s session');
  // The goal's own rating is the big number, so the tiles are the others on that site, then puzzles.
  await expect(page.locator('.rating-tile span')).toHaveText(['Bullet', 'Rapid', 'Puzzles']);
  await expect(page.locator('.rating-tile strong').first()).toHaveText('943');
  await expect(page.locator('.drill-card').first()).toContainText('Weak openings');
  await page.click('#play-now');
  await expect(page).toHaveURL(/#play/);
});

test('a debrief lists the reasons likeliest first, with how often each came up before', async ({ page }) => {
  await seed(page);
  await open(page, 'review');
  await page.locator('[data-train="debrief"]').click();
  await move(page, 'c4', 'f7');
  await expect(page.locator('.reason-pick .section-rule')).toContainText('Your last 8 notes');
  await expect(page.locator('.reason-list button').first()).toHaveAttribute('data-reason', 'chance');
  await expect(page.locator('[data-reason="chance"] .reason-count')).toHaveText('5');
  await expect(page.locator('[data-reason="threat"] .reason-count')).toHaveText('2');
});

test('the puzzle count is large and still read out as "1 of N"', async ({ page }) => {
  await open(page, 'train?mode=daily&limit=12');
  await expect(page.locator('#focus-progress .count')).toHaveText('01');
  await expect(page.locator('#focus-progress .of')).toHaveText('/12');
  await expect(page.locator('#focus-progress')).toContainText('1 of 12');
});
