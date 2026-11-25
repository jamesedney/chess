import { test, expect, open, state, seed, saved, BACK_RANK } from './helpers.mjs';

const DAY = 86400000;
const day = n => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);

/** A quick loss as Black on Chess.com: twice you ignore the threat on f7, then you are mated there. */
const LOSS = `[Event "Live Chess"]
[Site "Chess.com"]
[Link "https://www.chess.com/game/live/77"]
[White "rival"]
[Black "me"]
[Result "1-0"]
[WhiteElo "1260"]
[BlackElo "1254"]
[TimeControl "300"]
[UTCDate "${day(0).replace(/-/g, '.')}"]
[UTCTime "10:00:00"]

1. e4 e5 2. Bc4 Nc6 3. a3 a6 4. Qh5 b6 5. b3 Nf6 6. Qxf7# 1-0`;

/** Answer Chess.com's public endpoints for the player "me". */
async function chessCom(page) {
  const now = Math.floor(Date.now() / 1000);
  await page.route('https://api.chess.com/pub/player/me/**', route => {
    const url = route.request().url();
    const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.endsWith('/stats')) return json({ chess_blitz: { last: { rating: 1254, date: now }, record: { win: 5, loss: 5, draw: 0 } } });
    if (url.endsWith('/archives')) return json({ archives: ['https://api.chess.com/pub/player/me/games/2026/11'] });
    return json({
      games: [
        {
          pgn: LOSS,
          rules: 'chess',
          rated: true,
          time_class: 'blitz',
          end_time: now - 60,
          white: { username: 'rival', rating: 1260, result: 'win' },
          black: { username: 'me', rating: 1254, result: 'checkmated' },
        },
      ],
    });
  });
}

test('the first visit asks only for your name; then your rating shows and your games become positions', async ({ page }) => {
  await chessCom(page);
  await open(page, 'you');
  await expect(page.locator('#y-connect h1')).toHaveText('Train on your own games');
  await expect(page.locator('.hero')).toHaveCount(0);
  // Nothing typed: nothing happens but a word about it.
  await page.click('#y-connect button[type="submit"]');
  await expect(page.locator('.toast.show')).toContainText('Enter the name you play under');
  await page.fill('#y-chesscom', 'Me');
  await page.click('#y-connect button[type="submit"]');
  await expect(page.locator('#y-connect')).toHaveCount(0);
  await expect(page.locator('.hero .label')).toHaveText('Chess.com blitz', { timeout: 20000 });
  await expect(page.locator('#y-rating')).toHaveText('1254');
  // The game is read in the background; its mistakes arrive as positions to fix.
  await expect(page.locator('#y-facts')).toContainText(/[1-9]\d* to fix · 0 solved/, { timeout: 120000 });
  await expect(page.locator('#y-facts')).not.toContainText('Reading your games');
  const s = await saved(page);
  expect(s.profiles.chesscom).toBe('Me');
  expect(s.sync.reviewed).toEqual(['www.chess.com/game/live/77']);
  expect(s.mistakes[0].game).toMatchObject({ opp: 'rival' });
  expect(s.reviews, 'the game itself is not kept').toBeUndefined();
  // The message about them leads to the Train board, where one of them is waiting.
  await page.locator('.toast.show .toast-action').click();
  await expect(page.locator('.tabs a.active')).toHaveText('Train');
  await expect(page.locator('#t-source')).toContainText('Your game against rival');
  await expect(page.locator('#t-prompt')).toContainText('Black to move');
  await expect(page.locator('.nudge')).toHaveCount(0);
});

test('You shows one number: your real rating, how it moved in 30 days, and a line of it', async ({ page }) => {
  await page.route(/chess\.com|lichess\.org/, r => r.abort());
  const ratings = [
    [80, 1190],
    [45, 1200],
    [31, 1210],
    [10, 1190],
    [0, 1254],
  ].map(([n, rating]) => ({ platform: 'Chess.com blitz', date: day(n), rating }));
  await seed(
    page,
    state({
      profiles: { lichess: '', chesscom: 'me' },
      ratings,
      mistakes: [BACK_RANK, { ...BACK_RANK, id: 'mback2', fen: '7k/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1' }],
      records: { mback2: { tries: 1, clean: 1, box: 1, due: Date.now() + DAY, last: Date.now() } },
      puzzle: { rating: 1420, count: 50, history: [] },
      sync: {
        auto: false,
        followed: ['Chess.com blitz'],
        perfs: { 'Chess.com blitz': 1254, 'Chess.com rapid': 1310 },
        ratingsAt: Date.now(),
        backfillAt: Date.now(),
      },
    }),
  );
  await open(page, 'you');
  await expect(page.locator('.hero .label')).toHaveText('Chess.com blitz');
  await expect(page.locator('#y-rating')).toHaveText('1254');
  await expect(page.locator('#y-trend')).toHaveText(/44 up over 30 days/);
  await expect(page.locator('#y-trend')).toHaveClass(/up/);
  await expect(page.locator('.spark .line')).toHaveCount(1);
  await expect(page.locator('.others')).toHaveText(/Chess\.com rapid\s*1310/);
  await expect(page.locator('#y-facts > div')).toHaveCount(2);
  await expect(page.locator('#y-facts')).toContainText('1 to fix · 1 solved');
  await expect(page.locator('#y-facts')).toContainText('1420');
  // That is the whole screen: the rating, two facts and the way into Settings.
  await expect(page.locator('#main button')).toHaveCount(1);
});

test('settings: the board changes at once, a backup round-trips, and a reset clears everything', async ({ page }, info) => {
  await seed(page, state({ mistakes: [BACK_RANK], puzzle: { rating: 1333, count: 12, history: [] } }));
  await open(page, 'you');
  await page.click('#y-settings');
  await expect(page.locator('#modal h2')).toHaveText('Settings');
  await page.click('[data-board-theme="ocean"]');
  await expect(page.locator('html')).toHaveAttribute('data-board', 'ocean');
  await expect(page.locator('[data-board-theme="ocean"]')).toHaveAttribute('aria-checked', 'true');
  await page.click('[data-piece-set="merida"]');
  await page.selectOption('#appearance', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect((await saved(page)).settings).toMatchObject({ board: 'ocean', pieces: 'merida' });
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#backup')]);
  expect(download.suggestedFilename()).toMatch(/^rankup-progress-\d{4}-\d{2}-\d{2}\.json$/);
  const file = info.outputPath('backup.json');
  await download.saveAs(file);
  // Reset, then bring the backup back.
  await page.click('#reset');
  await page.click('#confirm [data-answer="yes"]');
  await expect(page.locator('.toast.show')).toContainText('Progress reset.');
  await expect(page.locator('.tabs a.active')).toHaveText('Train');
  let s = await saved(page);
  expect([s.mistakes.length, s.puzzle.rating, s.settings.board]).toEqual([0, 1000, 'green']);
  await page.click('.tabs a[data-page="you"]');
  await page.click('#y-settings');
  await page.setInputFiles('#restore-file', file);
  await page.click('#confirm [data-answer="yes"]');
  await expect(page.locator('.toast.show')).toContainText('Progress restored.');
  s = await saved(page);
  expect([s.mistakes.length, s.puzzle.rating, s.settings.board]).toEqual([1, 1333, 'ocean']);
  await expect(page.locator('html')).toHaveAttribute('data-board', 'ocean');
  // A file that is not a backup is refused and nothing changes.
  await page.click('.tabs a[data-page="you"]');
  await page.click('#y-settings');
  await page.setInputFiles('#restore-file', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"version":99}') });
  await expect(page.locator('#modal .toast.show')).toContainText('not a valid Rankup backup');
  await page.click('#close-modal');
  await expect(page.locator('#modal')).not.toBeVisible();
});

test('progress from 6.0 opens in 7.0 with its positions and rating, and the old data is kept until you discard it', async ({
  page,
}, info) => {
  await page.route(/chess\.com|lichess\.org/, r => r.abort());
  const old = {
    version: 11,
    records: { mback1: { tries: 1, clean: 0, box: 0, due: 1, last: 1 } },
    mistakes: [
      {
        id: 'mback1',
        title: 'Instead of h3',
        fen: BACK_RANK.fen,
        line: ['e1e8'],
        theme: 'Personal mistakes',
        tags: ['mate'],
        goal: 'Deliver checkmate in one.',
        explanation: BACK_RANK.explanation,
        kind: 'missed-mate',
        played: 'h3',
        loss: 60,
        created: 1700000000000,
        source: { reviewId: 'rold1', ply: 40 },
      },
    ],
    reviews: [
      {
        id: 'rold1',
        gameKey: 'www.chess.com/game/live/5',
        white: 'me',
        black: 'oldrival',
        colour: 'w',
        date: day(3),
        complete: true,
        marks: [],
      },
    ],
    ratings: [
      { platform: 'Chess.com blitz', date: day(9), rating: 1230 },
      { platform: 'Chess.com blitz', date: day(1), rating: 1254 },
    ],
    puzzle: { rating: 1420, count: 300, history: [] },
    profiles: { lichess: '', chesscom: 'me' },
    settings: { board: 'slate', pieces: 'cburnett', sound: false, haptics: false, nemesis: true, colour: 'r' },
    sync: {
      auto: false,
      ratedOnly: true,
      controls: ['blitz'],
      last: { lichess: 0, chesscom: 5 },
      seen: [],
      ledgerAt: 5,
      followed: ['Chess.com blitz'],
    },
    log: [{ d: day(1), k: 'p', t: 'Tactics', c: 1 }],
    session: { date: day(1), blocks: [] },
    gate: { stage: 3, set: 'proof', since: null },
  };
  await page.addInitScript(s => {
    if (!localStorage.getItem('rankup-v1')) localStorage.setItem('rankup-v1', JSON.stringify(s));
  }, old);
  // An address from the old app lands on the nearest screen.
  await open(page, 'progress');
  await expect(page.locator('.tabs a.active')).toHaveText('You');
  await expect(page.locator('#y-rating')).toHaveText('1254');
  await expect(page.locator('#y-trend')).toContainText('24 up');
  await expect(page.locator('#y-facts')).toContainText('1 to fix · 0 solved');
  await expect(page.locator('html')).toHaveAttribute('data-board', 'slate');
  await expect(page.locator('.toast.show')).toHaveCount(0);
  // The whole of the old data was set aside, and Settings hands it over.
  await page.click('#y-settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#legacy-download')]);
  const file = info.outputPath('before-7.json');
  await download.saveAs(file);
  const fs = await import('node:fs');
  expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ version: 11, session: { blocks: [] }, log: [{ k: 'p' }] });
  await page.click('#legacy-discard');
  await page.click('#confirm [data-answer="yes"]');
  expect(await page.evaluate(() => localStorage.getItem('rankup-before-7'))).toBeNull();
  // The position from the old game is the first thing on the Train board.
  await page.click('.tabs a[data-page="train"]');
  await expect(page.locator('#t-source')).toContainText('Your game against oldrival');
  await page.click('#t-show');
  await expect(page.locator('#t-next')).toBeVisible();
  const s = await saved(page);
  expect(s.version).toBe(12);
  expect(Object.keys(s).sort()).toEqual(['mistakes', 'profiles', 'puzzle', 'ratings', 'records', 'settings', 'sync', 'version']);
  expect(s.sync.reviewed).toEqual(['www.chess.com/game/live/5']);
});
