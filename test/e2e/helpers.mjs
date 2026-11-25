import { test as base, expect } from '@playwright/test';

/** A page that fails the test on any uncaught error or console error. */
export const test = base.extend({
  page: async ({ page, browserName }, use) => {
    // The first game against Nemesis picks a colour at random; tests play it as
    // White unless they say otherwise.
    await page.addInitScript(() => {
      if (!localStorage.getItem('rankup-practice')) localStorage.setItem('rankup-practice', JSON.stringify({ v: 7, pgn: '', color: 'w' }));
    });
    const errors = [];
    // WebKit occasionally traps inside the Stockfish WebAssembly build. The app
    // restarts the engine and retries, which the tests still have to see work.
    const knownVendorTrap = e => browserName === 'webkit' && /Out of bounds memory access/.test(e);
    page.on('pageerror', e => {
      if (!knownVendorTrap(e.message)) errors.push(e.message);
    });
    // WebKit reports the same trap as a console error ("Unhandled Promise
    // Rejection: RuntimeError: ...") when it happens inside the engine worker.
    page.on('console', m => {
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text()) && !knownVendorTrap(m.text())) errors.push(m.text());
    });
    await use(page);
    expect(errors, 'browser errors').toEqual([]);
    // Whatever the test saved must load again: a reload that sets saved data
    // aside means the app wrote something its own loader rejects.
    if (page.url().startsWith('http')) {
      const kept = () => page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('rankup-recovery-')).length);
      const before = await kept().catch(() => null);
      if (
        before !== null &&
        (await page
          .reload()
          .then(() => true)
          .catch(() => false))
      ) {
        expect(await kept(), 'saved data set aside on reload').toBe(before);
      }
    }
  },
});
export { expect };

export const sq = (page, square, board = '#board') => page.locator(`${board} [data-square="${square}"]`);

export async function move(page, from, to, board = '#board') {
  await sq(page, from, board).click();
  await sq(page, to, board).click();
}

export async function open(page, hash = 'train') {
  await page.goto('./#' + hash);
  await expect(page.locator('#main')).not.toBeEmpty();
}

/** A saved state in the current shape, with `extra` laid over the defaults. */
export function state(extra = {}) {
  return {
    version: 12,
    profiles: { lichess: '', chesscom: '' },
    puzzle: { rating: 1000, count: 0, history: [] },
    records: {},
    mistakes: [],
    ratings: [],
    settings: { board: 'green', pieces: 'cburnett', sound: false, haptics: false },
    ...extra,
    sync: {
      auto: true,
      ratedOnly: true,
      controls: ['blitz', 'rapid', 'classical'],
      last: { lichess: 0, chesscom: 0 },
      seen: [],
      reviewed: [],
      failed: [],
      backfillAt: 0,
      ...extra.sync,
    },
  };
}

/** Start the page with `saved` as its stored progress (once: a reload keeps what the app saved since). */
export async function seed(page, saved) {
  await page.addInitScript(s => {
    if (!localStorage.getItem('rankup-v1')) localStorage.setItem('rankup-v1', JSON.stringify(s));
  }, saved);
}

/** The progress the app has saved. */
export const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('rankup-v1')));

/** A position from one of your games: a back-rank mate in one that you missed by playing h3. */
export const BACK_RANK = {
  id: 'mback1',
  fen: '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1',
  line: ['e1e8'],
  played: 'h3',
  explanation: 'You had a forced mate in 1 starting with Re8#.',
  loss: 60,
  created: 1700000000000,
  game: { opp: 'rival', date: '2026-10-08' },
  mate: 1,
};
