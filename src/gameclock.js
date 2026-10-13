// A user-side game clock for practice games and Play it again: it runs only on
// your turn, adds the increment when your move is in, and tells when you have
// run out. The opponent's time is never tracked. Pure functions; the Play page
// owns the timer and the clock object, and passes `now` in.
import { formatClock } from './clocks.js';

const DAY = 86400000;

/** @typedef {{ base: number, inc: number, left: number, running: boolean, at: number | null }} Clock */

export const DEFAULT_CONTROL = { base: 300, inc: 0 };

/** A fresh clock with the full base time, not running. @returns {Clock} */
export function makeClock({ base, inc }) {
  return { base, inc, left: base, running: false, at: null };
}

/** Your turn begins: the clock starts at `now`. A clock already running keeps its start. */
export function startTurn(clock, now = Date.now()) {
  if (!clock.running) {
    clock.running = true;
    clock.at = now;
  }
  return clock;
}

/**
 * Your move is in: returns the seconds spent and charges them, then adds the
 * increment. The time left never goes below zero here; whether you ran out is
 * `flagged`'s question. A clock that was not running spends nothing.
 */
export function endTurn(clock, now = Date.now()) {
  if (!clock.running) return 0;
  const spent = Math.max(0, (now - (clock.at ?? now)) / 1000);
  clock.left = Math.max(0, clock.left - spent + clock.inc);
  clock.running = false;
  clock.at = null;
  return spent;
}

/** Seconds left at `now`, counting the running turn; never negative. */
export function timeLeft(clock, now = Date.now()) {
  const elapsed = clock.running ? Math.max(0, (now - (clock.at ?? now)) / 1000) : 0;
  return Math.max(0, clock.left - elapsed);
}

/** Out of time: nothing left at `now`. */
export function flagged(clock, now = Date.now()) {
  return timeLeft(clock, now) <= 0;
}

/**
 * The control you play most among your blitz games over the last `days`, as
 * { base, inc, text: '5+0' }; the fallback (5+0) when the ledger has none.
 */
export function userControl(ledger, { now = Date.now(), days = 42, fallback = DEFAULT_CONTROL } = {}) {
  /** @type {Record<string, { base: number, inc: number, n: number }>} */
  const counts = {};
  const from = now - days * DAY;
  for (const r of ledger || []) {
    if (r.tc !== 'blitz' || r.base == null || r.t < from) continue;
    const key = `${r.base}+${r.inc || 0}`;
    counts[key] ||= { base: r.base, inc: r.inc || 0, n: 0 };
    counts[key].n++;
  }
  // Most played first; on a tie the control seen first (the oldest row) wins.
  const best = Object.values(counts).sort((a, b) => b.n - a.n)[0];
  const control = best ? { base: best.base, inc: best.inc } : { base: fallback.base, inc: fallback.inc };
  return { ...control, text: controlText(control) };
}

/** "5+0" from { base: 300, inc: 0 }: minutes plus increment seconds, as sites write it. */
export function controlText({ base, inc }) {
  const minutes = base % 60 === 0 ? String(base / 60) : (base / 60).toFixed(1).replace(/\.0$/, '');
  return `${minutes}+${inc || 0}`;
}

/** "0:07" for the chip. */
export function clockText(seconds) {
  return formatClock(seconds);
}
