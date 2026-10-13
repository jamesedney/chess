// Same clock, better move: your own saved positions replayed with the seconds
// you actually had on the clock when you went wrong. Lists the positions,
// records the runs and sums them up. Pure.
import { formatClock, moveTime } from './clocks.js';
import { outcome } from './openings.js';
import { dateKey, emptyDrillStats } from './state.js';

const DAY = 86400000;
/** Fewer saved positions than this and the pause drill runs instead. */
export const MIN_POSITIONS = 6;
/** Seconds given when the game carried no clock data. */
export const DEFAULT_SECONDS = 15;
const MIN_SECONDS = 5;
const MAX_SECONDS = 60;
const MAX_RUNS = 50;
const WEEK = 7 * DAY;

/**
 * @typedef {object} PressureItem
 * @property {string} id
 * @property {string} fen
 * @property {number} seconds  the countdown, 5–60 s from the clock or DEFAULT_SECONDS
 * @property {number | null} spent  seconds taken over the move in the game
 * @property {number | null} left  the clock before the move
 * @property {string} played
 * @property {string} reviewId
 * @property {number} ply
 * @property {boolean} lost
 * @property {boolean} rushed
 * @property {boolean} trouble
 * @property {boolean} hasClock
 * @property {boolean} first  never attempted yet
 */

/**
 * Saved positions from reviews of the last `days`, with the seconds you had.
 * Order: never attempted, then lost games, then with clock data, then rushed
 * or in time trouble, then the newest review. Clockless positions come last.
 * @returns {PressureItem[]}
 */
export function pressurePositions(state, { limit = 6, now = Date.now(), days = 60 } = {}) {
  const since = now - days * DAY;
  const reviews = new Map((state.reviews || []).map(r => [r.id, r]));
  /** @type {(PressureItem & { created: number })[]} */
  const items = [];
  for (const m of state.mistakes || []) {
    const ply = m.source?.ply;
    if (m.archived || !m.source?.reviewId || ply == null) continue;
    const r = reviews.get(m.source.reviewId);
    if (!r || !r.complete || (r.created || now) < since) continue;
    // A cleared mark means the engine withdrew the verdict: nothing to find here.
    const mark = (r.marks || []).find(k => k.ply === ply);
    if (!mark || mark.cleared) continue;
    const t = moveTime(r, ply);
    items.push({
      id: m.id,
      fen: m.fen,
      seconds: t ? Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(t.left))) : DEFAULT_SECONDS,
      spent: t?.spent ?? null,
      left: t?.left ?? null,
      played: m.played,
      reviewId: r.id,
      ply,
      lost: outcome(r.result, r.colour) === 0,
      rushed: !!t?.rushed,
      trouble: !!t?.trouble,
      hasClock: !!t,
      first: !(state.records?.[m.id]?.tries > 0),
      created: r.created || now,
    });
  }
  const rank = i => [i.first, i.lost, i.hasClock, i.rushed || i.trouble].map(Number);
  items.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let k = 0; k < ra.length; k++) if (ra[k] !== rb[k]) return rb[k] - ra[k];
    return b.created - a.created;
  });
  return items.slice(0, limit).map(({ created, ...item }) => item);
}

/** Seconds for the prompt: whole numbers, tenths only for quick moves. */
function spentText(spent) {
  return spent < 10 && !Number.isInteger(spent) ? spent.toFixed(1) : String(Math.round(spent));
}

/** The line shown while the countdown runs. */
export function promptFor(item) {
  if (!item.hasClock) return `No clock data for this game: ${item.seconds} seconds. Find the better move.`;
  const move = item.played ? `played ${item.played}` : 'moved';
  return `You had ${formatClock(item.left)} here and ${move} in ${spentText(item.spent)} s. Find the better move.`;
}

/** One finished run: n positions, inTime found inside the clock, first of them never seen before. */
export function recordRealRun(state, { n, inTime, first, firstInTime }, date = dateKey()) {
  const s = state.calc.real || emptyDrillStats();
  const pct = n > 0 ? Math.round((inTime / n) * 100) : 0;
  state.calc.real = {
    best: Math.max(s.best, pct),
    runs: s.runs + 1,
    last: [...s.last, { d: date, n, inTime, first, firstInTime }].slice(-MAX_RUNS),
  };
}

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/**
 * In-time rates over the recorded runs, overall and on first attempts, plus
 * the first week (the seven days from the earliest run) for a before/after.
 */
export function pressureStats(state) {
  const runs = state.calc?.real?.last || [];
  const out = { tries: 0, inTime: 0, rate: 0, first: { tries: 0, inTime: 0, rate: 0 }, firstWeek: { tries: 0, inTime: 0 } };
  let earliest = Infinity;
  for (const r of runs) earliest = Math.min(earliest, Date.parse(r.d));
  for (const r of runs) {
    out.tries += r.n || 0;
    out.inTime += r.inTime || 0;
    out.first.tries += r.first || 0;
    out.first.inTime += r.firstInTime || 0;
    if (Date.parse(r.d) - earliest < WEEK) {
      out.firstWeek.tries += r.n || 0;
      out.firstWeek.inTime += r.inTime || 0;
    }
  }
  out.rate = pct(out.inTime, out.tries);
  out.first.rate = pct(out.first.inTime, out.first.tries);
  return out;
}
