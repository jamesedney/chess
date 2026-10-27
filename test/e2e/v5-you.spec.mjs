import { test, expect, open } from './helpers.mjs';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const MOVES = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4', 'Nxe5', 'Qg5', 'Nxf7', 'Qxg2'];
const FEN_BEFORE_NXF7 = 'r1b1kbnr/pppp1ppp/8/4N1q1/2BnP3/8/PPPP1PPP/RNBQK2R w KQkq - 1 5';
const DAY = 86400000;
const HOUR = 3600000;

const dateKey = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

/** A ledger row: a blitz 5+0 game of five minutes ending at `t`, exact times, result `r` from your side. */
function row(k, t, r) {
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
    term: 'resign',
    n: 60,
    me: 1200,
    opp: 1220,
    rated: 1,
    src: 'lichess',
  };
}

/** One sitting from `start`: each game is [result, seconds after the previous game ended]. */
function sitting(id, start, games) {
  let t = start;
  return games.map(([r, gap], i) => {
    t += gap * 1000 + 300000;
    return row(`lichess.org/${id}${i}`, t, r);
  });
}

// Ten sittings of four games, one every two days: 16 games started within 90 s
// of a loss ("straight after a loss") scoring 5 of 16, the other 24 scoring
// 13.5; no sitting reaches a fifth game.
const A = [
  [0, 0],
  [0, 60],
  [0, 60],
  [1, 300],
];
const A2 = [
  [0, 0],
  [0, 60],
  [1, 60],
  [1, 300],
];
const B = [
  [0, 0],
  [1, 60],
  [1, 300],
  [1, 300],
];
const B2 = [
  [0, 0],
  [1, 60],
  [1, 300],
  [0.5, 300],
];
const PLAN = [A, B, A, B2, A2, B, A, B, A, A];
const evenings = now => PLAN.flatMap((g, j) => sitting('ev' + j, now - (21 - 2 * j) * DAY, g));

/** The last ten games, an hour apart today: 3 of 10, the newest a loss, runs of 3, 2 and 2. */
const STREAK = [1, 0, 0, 0, 1, 0, 0, 1, 0, 0];
const streakRows = now => STREAK.map((r, i) => row('lichess.org/st' + i, now - (12 - i) * HOUR, r));

/** A reviewed game you lost after Nxf7?? when Bxf7+ was winning, linked to its ledger row by `gameKey`. */
function lostGame(id, created, gameKey) {
  const evals = new Array(MOVES.length + 1).fill(null);
  evals[8] = 320;
  evals[9] = -550;
  return {
    id,
    key: 'key-' + id,
    gameKey,
    complete: true,
    created,
    white: 'me',
    black: 'rival',
    result: '0-1',
    colour: 'w',
    startFen: START,
    moves: MOVES,
    evals,
    marks: [{ ply: 8, cls: 'blunder', loss: 60, best: 'c4f7', bestSan: 'Bxf7+', refute: 'g5g2', mistakeId: 'm' + id }],
    oppElo: 1480,
  };
}

function mistake(id, created) {
  return {
    id: 'm' + id,
    title: 'Instead of Nxf7',
    fen: FEN_BEFORE_NXF7,
    line: ['c4f7'],
    theme: 'Personal mistakes',
    tags: ['mate'],
    goal: 'Find the improvement.',
    explanation: 'Nxf7 hangs the knight: Qxg2 wins material.',
    played: 'Nxf7',
    loss: 60,
    created,
    kind: 'hung-piece',
    source: { reviewId: id, ply: 8 },
  };
}

/** A version-9 state in streak mode: 50 ledger rows, six of the seven newest losses reviewed, clocked practice and drill runs. */
function streakState(now) {
  const today = dateKey(new Date(now));
  const lost = streakRows(now)
    .filter(r => r.r === 0)
    .slice(-6);
  const reviews = lost.map((r, i) => lostGame('rs' + i, r.t, r.k));
  const run = (hit, miss, fa, ms) => ({ d: today, n: 10, h: 5, hit, miss, fa, slow: 0, ms });
  return {
    version: 9,
    onboarded: true,
    ledger: [...evenings(now), ...streakRows(now)],
    reviews,
    mistakes: reviews.map(r => mistake(r.id, r.created)),
    stop: { since: dateKey(new Date(now - 10 * DAY)), resets: [] },
    streak: { since: dateKey(new Date(now - 2 * DAY)), leak: 'safety', count: 7, counted: 6 },
    // Five clocked practice games: 4 blunders, 1 of them fast, one flag.
    games: [
      { d: today, level: 'maia1500', r: 0, tc: '300+0', left: 0, fl: 1, b: 2, f: 1 },
      { d: today, level: 'maia1500', r: 1, tc: '300+0', left: 41, fl: 0, b: 1, f: 0 },
      { d: today, level: 'maia1500', r: 1, tc: '300+0', left: 90, fl: 0, b: 0, f: 0 },
      { d: today, level: 'maia1500', r: 0.5, tc: '300+0', left: 12, fl: 0, b: 1, f: 0 },
      { d: today, level: 'maia1500', r: 1, tc: '300+0', left: 7, fl: 0, b: 0, f: 0 },
    ],
    // Five replays on the real clock: three converted, one lost on time.
    replays: {
      'rs0:8': { tries: 1, success: true, last: today, left: 12 },
      'rs1:8': { tries: 2, success: true, last: today, left: 3 },
      'rs2:8': { tries: 1, success: true, last: today, left: 20 },
      'rs3:8': { tries: 1, success: false, last: today, left: 0, flagged: 1 },
      'rs4:8': { tries: 1, success: false, last: today, left: 9 },
    },
    calc: {
      // Six runs of ten: the newest five (50 positions) at 60% in 3.1 s, the one before at 20%.
      safe: { best: 60, runs: 6, last: [run(3, 2, 2, 4000), ...Array.from({ length: 5 }, () => run(4, 1, 1, 3100))] },
      real: {
        best: 71,
        runs: 2,
        last: [
          { d: today, n: 7, inTime: 5, first: 5, firstInTime: 2 },
          { d: today, n: 7, inTime: 4, first: 5, firstInTime: 2 },
        ],
      },
    },
  };
}

/** Twelve games, two hours apart, wins and losses alternating: not a streak, nothing straight after a loss. */
function calmState(now) {
  return {
    version: 9,
    onboarded: true,
    ledger: Array.from({ length: 12 }, (_, i) => row('lichess.org/calm' + i, now - (24 - 2 * i) * HOUR, i % 2 ? 0 : 1)),
  };
}

async function seed(page, state) {
  await page.addInitScript(s => {
    if (!localStorage.getItem('rankup-v1')) localStorage.setItem('rankup-v1', JSON.stringify(s));
  }, state);
}

test('the You page shows your streak, your evenings and your clock in streak mode', async ({ page }) => {
  await seed(page, streakState(Date.now()));
  await open(page, 'progress');
  const streak = page.locator('section:has(#streak-title)');
  await expect(page.locator('#streak-title')).toContainText('Your streak');
  const streakTiles = streak.locator('.metric');
  await expect(streakTiles).toHaveCount(3);
  await expect(streakTiles.nth(0)).toContainText('3 of 10');
  await expect(streakTiles.nth(0)).toContainText('Last 10 games');
  // The losses among the last ten games: six reviewed, each with a piece hung.
  await expect(streakTiles.nth(1).locator('strong')).toHaveText('6 of 6');
  await expect(streakTiles.nth(1)).toContainText('a piece hung in one move');
  await expect(streakTiles.nth(2).locator('strong')).toHaveText('3');
  await expect(streakTiles.nth(2)).toContainText('Longest loss run · 14 days');
  await expect(streak).toContainText('Habit: ');
  await expect(streak).toContainText('Since ');

  const evenings = page.locator('section:has(#evenings-title)');
  await expect(page.locator('#evenings-title')).toContainText('Your evenings');
  const tiles = evenings.locator('.metric');
  await expect(tiles.nth(0).locator('strong')).toHaveText('5 of 16 · 31%');
  await expect(tiles.nth(0)).toContainText('other games 49%');
  await expect(tiles.nth(1).locator('strong')).toHaveText('–');
  await expect(tiles.nth(1)).toContainText('needs 8 games');
  await expect(tiles.nth(2).locator('strong')).toHaveText('3');
  await expect(tiles.nth(2)).toContainText('last 14 days');
  await expect(evenings).toContainText('Play rule: 4 games · stop after 2 losses in a row · 2 min between games');
  await expect(evenings).toContainText('Since the stop line (');
  await expect(evenings).toContainText('straight after a loss 1 of 7 (was 4 of 9)');
  await expect(evenings).toContainText('Sittings: 2.1 games on average, 14 days.');
  await expect(evenings).toContainText('Lost on time: 0 of 28 losses.');

  // Judgement: the Safe-or-hanging line, the last 50 positions against the 10 before.
  await expect(page.locator('#main')).toContainText(
    'Safe or hanging: 60% in 3.1 s over the last 50 positions (was 20% over the 10 before).',
  );
  // Your clock: practice games, replays and Same-clock runs.
  const habits = page.locator('section:has(#habits-title)');
  await expect(habits).toContainText('Practice on the clock: 5 games, 0.8 blunders a game, 0.2 in under 4.5 seconds, flagged 1.');
  await expect(habits).toContainText('Play it again on the real clock: 3 of 5 converted, 1 lost on time.');
  await expect(habits).toContainText('Under your real clock: 9 of 14 in time (64%); first attempts 4 of 10.');
});

test('outside streak mode the streak panel is hidden and the evening tiles wait for their games', async ({ page }) => {
  await seed(page, calmState(Date.now()));
  await open(page, 'progress');
  await expect(page.locator('#working-title')).toContainText('Is it working?');
  await expect(page.locator('#streak-title')).toHaveCount(0);
  const evenings = page.locator('section:has(#evenings-title)');
  await expect(page.locator('#evenings-title')).toContainText('Your evenings');
  const tiles = evenings.locator('.metric');
  await expect(tiles.nth(0).locator('strong')).toHaveText('–');
  await expect(tiles.nth(0)).toContainText('needs 8 games');
  await expect(tiles.nth(1).locator('strong')).toHaveText('–');
  await expect(tiles.nth(1)).toContainText('needs 8 games');
  await expect(tiles.nth(2).locator('strong')).toHaveText('1');
  await expect(evenings).toContainText('(default rule)');
  await expect(evenings).toContainText('Lost on time: 0 of 6 losses.');
  // No clocked games, replays or runs: the clock keeps to the imported-game profile.
  const habits = page.locator('section:has(#habits-title)');
  await expect(habits).not.toContainText('Practice on the clock');
  await expect(page.locator('#main')).not.toContainText('Safe or hanging:');
});

test('outside a streak, every loss of the last 30 days names the leak on Today and on You', async ({ page }) => {
  const now = Date.now();
  const state = calmState(now);
  // The six losses (every other game) all reviewed: each hung a piece.
  const losses = state.ledger.filter(r => r.r === 0);
  state.reviews = losses.map((r, i) => lostGame('rc' + i, r.t, r.k));
  state.mistakes = state.reviews.map(r => mistake(r.id, r.created));
  await seed(page, state);
  await open(page, 'today');
  const card = page.locator('section:has(#leak-head)');
  await expect(card).toContainText('Where your points go');
  await expect(card).toContainText('Last 30 days: 6 losses. Of the 6 read, 6 began with a piece hung in one move.');
  await expect(page.locator('#streak-head')).toHaveCount(0);
  await open(page, 'progress');
  const points = page.locator('section:has(#points-head)');
  await expect(points).toContainText('12 games, 50%. 6 of your 6 losses read.');
  await expect(points.locator('.points-lead')).toContainText('Of the 6 read, 6 began with a piece hung in one move.');
});

test('with fewer than ten games neither panel shows', async ({ page }) => {
  const now = Date.now();
  await seed(page, {
    version: 9,
    onboarded: true,
    ledger: Array.from({ length: 5 }, (_, i) => row('lichess.org/few' + i, now - (10 - 2 * i) * HOUR, 1)),
  });
  await open(page, 'progress');
  await expect(page.locator('#working-title')).toContainText('Is it working?');
  await expect(page.locator('#streak-title')).toHaveCount(0);
  await expect(page.locator('#evenings-title')).toHaveCount(0);
  await expect(page.locator('#points-head')).toHaveCount(0);
});
