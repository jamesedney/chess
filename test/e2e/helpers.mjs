import { test as base, expect } from '@playwright/test';

/** A page that fails the test on any uncaught error or console error. */
export const test = base.extend({
  page: async ({ page, browserName }, use) => {
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
