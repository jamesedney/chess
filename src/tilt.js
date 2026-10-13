// The stop line: how many games to play tonight, when to stop, and what it
// costs when you don't, read from the game ledger. Groups games into sittings,
// scores the games played straight after a loss and the late games of a
// sitting, and says when a STOP card is live. Pure; the pages render it.
import { startOf, endOf, score, lossRun, longestRun } from './ledger.js';
import { dateKey } from './state.js';

const DAY = 86400000;
/** The fixed play rule: games a night, the loss run that ends it, the wait after a loss. */
export const RULE = { games: 4, stopAfter: 2, waitMin: 2 };
/** A gap longer than this between games starts a new sitting. */
export const SITTING_MS = 30 * 60000;
/** A game started within this of a loss is "straight after a loss". */
export const QUICK_MS = 120000;
/** The STOP card stays up this long after a loss. */
export const LIVE_MS = 20 * 60000;
/** Two losses in a row within this of now shape the rest of the night. */
export const TONIGHT_MS = 3 * 3600000;
/** Games in each bucket before its verdict speaks. */
export const MIN_BUCKET = 8;
/** The score gap (0.15 = 15 points) that makes a verdict. */
export const GAP = 0.15;
/** Reset timestamps kept. */
const MAX_RESETS = 50;
/** A row counts as "after a reset" when it starts within this of the reset. */
const AFTER_RESET_MS = 30 * 60000;
const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * @typedef {{ k: string, t: number, d: number | null, x: number, r: number, c: string, tc: string | null, base: number | null,
 *   inc: number | null, term: string, n: number, me: number | null, opp: number | null, rated: number, src: string }} Row
 * @typedef {Row & { idx: number, quick: boolean, prevLoss: boolean, sitting: number }} AnnotatedRow
 * @typedef {{ n: number, score: number | null }} Bucket
 */

// Rows with x: 0 know only one of start and end; using t for both over-estimates
// every gap, so a quick game can be missed but never invented.
const begins = row => (row.x ? startOf(row) : row.t);
const ends = row => endOf(row);
const byTime = rows => [...rows].sort((a, b) => a.t - b.t);
/** @returns {Bucket} */
const bucket = rows => ({ n: rows.length, score: score(rows) });
/** Floating-point safe: is a at least GAP above b? */
const gapAtLeast = (a, b) => a - b >= GAP - 1e-9;
const percent = s => Math.round(s * 100) + '%';
/** "5 of 16": the points (wins plus half-draws) over the games, from a bucket. */
const ofText = b => `${Math.round(b.score * b.n * 2) / 2} of ${b.n}`;
const word = n => WORDS[n] || String(n);

/** Every row in time order with its place in a sitting and whether it came straight after a loss. */
/** @returns {AnnotatedRow[]} */
export function annotate(ledger) {
  const out = [];
  let prev = null;
  let sitting = -1;
  let idx = 0;
  for (const row of byTime(ledger || [])) {
    const gap = prev ? begins(row) - ends(prev) : Infinity;
    if (!prev || gap > SITTING_MS) {
      sitting++;
      idx = 0;
    }
    idx++;
    const prevLoss = idx > 1 && prev.r === 0;
    out.push({ ...row, idx, prevLoss, quick: prevLoss && gap <= QUICK_MS, sitting });
    prev = row;
  }
  return out;
}

/** Games grouped into sittings: { start, end, games }. */
export function sittings(ledger) {
  /** @type {{ start: number, end: number, games: AnnotatedRow[] }[]} */
  const out = [];
  for (const row of annotate(ledger)) {
    if (row.idx === 1) out.push({ start: begins(row), end: ends(row), games: [] });
    const s = out[out.length - 1];
    s.games.push(row);
    s.end = ends(row);
  }
  return out;
}

/** The rows that count as today, by the local date. */
const todayRows = (rows, now) => {
  const today = dateKey(new Date(now));
  return rows.filter(r => dateKey(new Date(r.t)) === today);
};

/**
 * What the last `days` of games say: the score straight after a loss against
 * the rest, the late games of a sitting against the early ones, the loss runs,
 * today, and the losses on time. A verdict speaks only with 8 games in each
 * bucket and a gap of 15 points; the rule itself never changes.
 */
export function tiltProfile(ledger, { now = Date.now(), days = 42 } = {}) {
  const all = annotate(ledger);
  const rows = all.filter(r => r.t >= now - days * DAY);
  const afterLoss = { quick: bucket(rows.filter(r => r.quick)), rest: bucket(rows.filter(r => !r.quick)) };
  const deep = { late: bucket(rows.filter(r => r.idx >= 5)), early: bucket(rows.filter(r => r.idx <= 4)) };
  const today = todayRows(rows, now);
  const losses = rows.filter(r => r.r === 0);
  /** @type {('quick' | 'deep')[]} */
  const verdicts = [];
  const lines = [];
  if (afterLoss.quick.n >= MIN_BUCKET && afterLoss.rest.n >= MIN_BUCKET && gapAtLeast(afterLoss.rest.score, afterLoss.quick.score)) {
    verdicts.push('quick');
    lines.push(
      `Straight after a loss: ${ofText(afterLoss.quick)} (${percent(afterLoss.quick.score)}). ` +
        `Your other games: ${percent(afterLoss.rest.score)}.`,
    );
  }
  if (deep.late.n >= MIN_BUCKET && deep.early.n >= MIN_BUCKET && gapAtLeast(deep.early.score, deep.late.score)) {
    verdicts.push('deep');
    lines.push(
      `Games 5 and later in a sitting: ${ofText(deep.late)} (${percent(deep.late.score)}). Games 1–4: ${percent(deep.early.score)}.`,
    );
  }
  return {
    games: rows.length,
    afterLoss,
    deep,
    runs: { current: lossRun(ledger || []).length, longest14: longestRun(rows.filter(r => r.t >= now - 14 * DAY)) },
    today: { games: today.length, score: score(today), lastEnd: today.length ? Math.max(...today.map(ends)) : null },
    flagged: { losses: losses.length, onTime: losses.filter(r => r.term === 'time').length },
    verdicts,
    rule: {
      ...RULE,
      default: verdicts.length === 0,
      label: verdicts.length ? 'Your rule' : 'Default rule',
      text: `Play ${RULE.games} games. Stop after ${RULE.stopAfter} losses in a row. Wait ${RULE.waitMin} minutes after a loss.`,
    },
    lines,
  };
}

const newestOf = ledger => (ledger && ledger.length ? byTime(ledger)[ledger.length - 1] : null);

const agoText = minutes => (minutes === 0 ? 'just now' : minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`);

/**
 * Is the STOP card live (a loss in the last 20 minutes), and is tonight shaped
 * by two losses in a row within 3 hours? `text` is the card's sentence; the
 * page adds the sync time after it.
 */
export function stopState(state, now = Date.now()) {
  const ledger = state.ledger || [];
  const newest = newestOf(ledger);
  const run = lossRun(ledger).length;
  if (!newest) return { live: false, tonight: false, minutesAgo: null, run, resetDone: null, text: '' };
  const since = Math.max(0, now - ends(newest));
  const minutesAgo = Math.floor(since / 60000);
  const live = newest.r === 0 && since <= LIVE_MS;
  const tonight = run >= 2 && since <= TONIGHT_MS;
  const after = (state.stop?.resets || []).filter(t => t > ends(newest));
  const resetDone = after.length ? Math.max(...after) : null;
  let text = '';
  if (live) {
    const profile = tiltProfile(ledger, { now });
    const { quick, rest } = profile.afterLoss;
    const middle = profile.verdicts.includes('quick')
      ? `Straight after a loss: ${ofText(quick)} (${percent(quick.score)}); other games ${percent(rest.score)}.`
      : `Wait ${RULE.waitMin} minutes.`;
    text = `You lost ${agoText(minutesAgo)}. ${middle} Reset: 4 minutes, then play.`;
  } else if (tonight) {
    text = `${word(run)} losses in a row, ${minutesAgo} min ago. Four of your positions, then stop for tonight.`;
  }
  return { live, tonight, minutesAgo, run, resetDone, text };
}

/**
 * What the four-minute reset runs: a Safe-or-hanging run when four items are
 * available (`safeCount`, from safecheck.safeItems), else the pause drill on
 * three of your own mistakes, else a vision sprint.
 */
export function resetParams(state, { safeCount = 0 } = {}) {
  if (safeCount >= 4) return { mode: 'safe', limit: 4 };
  const own = (state.mistakes || []).filter(m => !m.archived).length;
  if (own >= 3) return { mode: 'mistakes', clock: 'pause', limit: 3 };
  return { mode: 'vision' };
}

/** Remember that a reset was completed now. */
export function recordReset(state, now = Date.now()) {
  if (!state.stop) state.stop = { since: null, resets: [] };
  if (!Array.isArray(state.stop.resets)) state.stop.resets = [];
  state.stop.resets.push(now);
  if (state.stop.resets.length > MAX_RESETS) state.stop.resets.splice(0, state.stop.resets.length - MAX_RESETS);
}

/** "13 Oct" from a "2026-10-13" date. */
const shortDate = date => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : String(date);
};

/**
 * Games before and since the rule first showed (`state.stop.since`): the score
 * straight after a loss, the longest loss run, and the games started within 30
 * minutes of a reset. Null before the rule has shown.
 */
export function sinceStop(state, now = Date.now()) {
  const since = state.stop?.since;
  if (!since) return null;
  const all = annotate(state.ledger || []).filter(r => r.t <= now);
  const before = all.filter(r => dateKey(new Date(r.t)) < since);
  const after = all.filter(r => dateKey(new Date(r.t)) >= since);
  const resets = state.stop.resets || [];
  const afterResetRows = all.filter(r => resets.some(t => begins(r) >= t && begins(r) - t <= AFTER_RESET_MS));
  const quick = { before: bucket(before.filter(r => r.quick)), since: bucket(after.filter(r => r.quick)) };
  const runs = { before: longestRun(before), since: longestRun(after) };
  const afterReset = bucket(afterResetRows);
  const parts = [];
  if (quick.since.n) {
    const was = quick.before.n ? ` (was ${ofText(quick.before)})` : '';
    parts.push(`straight after a loss ${ofText(quick.since)}${was}.`);
  }
  if (afterReset.n) parts.push(`After a reset: ${ofText(afterReset)}.`);
  parts.push(`Longest loss run ${runs.since}${before.length ? ` (was ${runs.before})` : ''}.`);
  const text = `Since the stop line (${shortDate(since)}): ${parts.join(' ')}`;
  return { since, quick, runs, afterReset, text };
}

/** The one-line rule under the Today header. */
export function ruleLine(profile) {
  const r = profile?.rule || RULE;
  return `Play rule: ${r.games} games · stop after ${r.stopAfter} losses in a row · ${r.waitMin} min between games`;
}
