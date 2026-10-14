// The game ledger: one small row for every finished online game the sync
// fetched, reviewed or not, so results, terminations, ratings and times can be
// read across a losing streak. Only the last 20 games are reviewed in full;
// the ledger holds 400. Pure functions; src/queue.js fills it on every sync.
import { readHeaders, detectColour, loadGame } from './pgn.js';
import { controlClass, gameKey } from './sync.js';
import { parseTimeControl, readClocks } from './clocks.js';
import { outcome } from './openings.js';

export const MAX_LEDGER = 400;
export const TERMS = ['mate', 'resign', 'time', 'abandon', 'draw', 'other'];
const DAY = 86400000;

/** When a game started and ended, in ms. Rows with x: 0 know only one of the two. */
export const startOf = row => row.t - (row.d || 0) * 1000;
export const endOf = row => row.t;

/** Score over rows: the mean result from your side, or null with no rows. */
export function score(rows) {
  return rows.length ? rows.reduce((a, r) => a + r.r, 0) / rows.length : null;
}

/** ms from "2026.10.08" and "21:42:05" PGN headers, or null. */
function utc(date, time) {
  const d = /^(\d{4})[.-](\d{2})[.-](\d{2})$/.exec(String(date || ''));
  const t = /^(\d{1,2}):(\d{2}):(\d{2})/.exec(String(time || ''));
  if (!d || !t) return null;
  return Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]), Number(t[3]));
}

/** The game's start from its headers (Lichess and Chess.com both write UTCDate/UTCTime), or null. */
export function startTime(headers) {
  return utc(headers.UTCDate, headers.UTCTime) ?? utc(headers.Date, headers.StartTime);
}

/** The game's end from Chess.com's EndDate/EndTime headers, or null. */
export function endTime(headers) {
  const end = utc(headers.EndDate || headers.UTCDate, headers.EndTime);
  if (end === null) return null;
  const start = startTime(headers);
  // EndTime without EndDate can cross midnight: the end is never before the start.
  return start !== null && end < start ? end + DAY : end;
}

/**
 * Seconds both sides spent, from the clocks after each move: for each side,
 * the base time minus what was left, plus the increment it received. Capped
 * at what the control allows.
 */
export function consumedSeconds(clocks, tc) {
  if (!clocks || !tc || !clocks.length) return null;
  const n = clocks.length;
  let total = 0;
  for (const side of [0, 1]) {
    let last = tc.base;
    let moves = 0;
    for (let i = side; i < n; i += 2) {
      if (clocks[i] == null) return null;
      last = clocks[i];
      moves++;
    }
    total += tc.base - last + tc.inc * moves;
  }
  return Math.max(0, Math.min(Math.round(total), 2 * tc.base + tc.inc * n));
}

/** Chess.com's per-side result strings, read for the loser (or either side of a draw). */
const CHESSCOM_RESULTS = {
  checkmated: 'mate',
  timeout: 'time',
  resigned: 'resign',
  abandoned: 'abandon',
  agreed: 'draw',
  repetition: 'draw',
  stalemate: 'draw',
  insufficient: 'draw',
  '50move': 'draw',
  timevsinsufficient: 'draw',
};

/** How the game ended: 'mate' | 'resign' | 'time' | 'abandon' | 'draw' | 'other'. */
/**
 * @param {{ headers?: Record<string, string>, results?: { w?: string | null, b?: string | null } | null,
 *   colour: string, result: string, mated?: boolean }} game
 */
export function terminationOf({ headers = /** @type {Record<string, string>} */ ({}), results = null, colour, result, mated = false }) {
  const draw = result === '1/2-1/2';
  if (results) {
    const loser = result === '1-0' ? 'b' : result === '0-1' ? 'w' : null;
    const word = String((loser ? results[loser] : results.w || results.b) || '').toLowerCase();
    if (CHESSCOM_RESULTS[word]) return CHESSCOM_RESULTS[word];
  }
  const term = String(headers.Termination || '');
  if (/time forfeit|on time/i.test(term)) return 'time';
  if (/abandon/i.test(term)) return 'abandon';
  if (/by checkmate/i.test(term)) return 'mate';
  if (/by resignation/i.test(term)) return 'resign';
  if (/drawn|draw/i.test(term)) return 'draw';
  if (/^normal$/i.test(term) || /won|lost/i.test(term)) return draw ? 'draw' : mated ? 'mate' : 'resign';
  if (!term) return draw ? 'draw' : mated ? 'mate' : 'other';
  return 'other';
}

/** 'lichess.org/abcd1234' from a Site or Link header, the same rule as sync.gameKey; null when not a URL. */
export function keyFromSite(site) {
  if (!site || !/^https?:\/\//.test(site)) return null;
  return site.replace(/^https?:\/\//, '').replace(/\/(black|white)$/, '');
}

/**
 * One row from a fetched game, or null when it is unfinished, a variant, not
 * yours, unreadable, or has no time at all. `ended` (ms), `control`, `rated`,
 * `results` ({ w, b }) and `ratings` ({ w, b }) come from Chess.com's JSON
 * when the game came from there; the PGN headers cover the rest.
 */
export function ledgerEntry(
  pgn,
  { usernames, source, key = null, ended = null, control = null, rated = null, results = null, ratings = null },
) {
  const h = /** @type {Record<string, string>} */ (readHeaders(pgn));
  if (h.Variant && h.Variant !== 'Standard' && h.Variant !== 'From Position') return null;
  if (!h.Result || h.Result === '*') return null;
  const colour = detectColour(pgn, usernames);
  if (!colour) return null;
  let game;
  try {
    game = loadGame(pgn);
  } catch {
    return null;
  }
  const r = outcome(h.Result, colour);
  if (r === null) return null;
  const n = game.history().length;
  const tc = parseTimeControl(h.TimeControl);
  const clocks = tc ? readClocks(pgn, n) : null;
  const d = consumedSeconds(clocks, tc);
  let t;
  if (ended) t = ended;
  else {
    const end = endTime(h);
    const start = startTime(h);
    if (end !== null) t = end;
    else if (start !== null) t = d === null ? start : start + d * 1000;
    else return null;
  }
  const elo = side => {
    const v = Number(ratings?.[side] ?? h[side === 'w' ? 'WhiteElo' : 'BlackElo']);
    return v >= 100 && v <= 3500 ? Math.round(v) : null;
  };
  const isRated =
    rated ??
    (h.Event ? (/rated/i.test(h.Event) && !/unrated|casual/i.test(h.Event) ? true : /casual|unrated/i.test(h.Event) ? false : true) : true);
  return {
    k: key || gameKey(pgn),
    t,
    d,
    x: d === null ? 0 : 1,
    r,
    c: colour,
    tc: control === 'daily' ? 'correspondence' : control || controlClass(h.TimeControl),
    base: tc ? tc.base : null,
    inc: tc ? tc.inc : null,
    term: terminationOf({ headers: h, results, colour, result: h.Result, mated: game.isCheckmate() }),
    n,
    me: elo(colour),
    opp: elo(colour === 'w' ? 'b' : 'w'),
    rated: isRated ? 1 : 0,
    src: source === 'chesscom' ? 'chesscom' : 'lichess',
  };
}

/**
 * Rows for every finished game of yours in a fetch result, deduped within the
 * batch. `known` keys are skipped before any parsing, so a sync that returns
 * the same two months again costs almost nothing; so are games that ended at
 * or before `after` (the oldest row of a full ledger), which could not stay.
 */
export function ledgerFrom(fetched, { usernames, known = new Set(), after = 0 }) {
  const out = [];
  const seen = new Set();
  for (const g of fetched) {
    if (!g?.pgn) continue;
    if (after && g.ended && g.ended <= after) continue;
    const key = gameKey(g.pgn);
    if (seen.has(key) || known.has(key)) continue;
    seen.add(key);
    const row = ledgerEntry(g.pgn, {
      usernames,
      key,
      source: g.source,
      ended: g.ended || null,
      control: g.control || null,
      rated: typeof g.rated === 'boolean' ? g.rated : null,
      results: g.results || null,
      ratings: g.ratings || null,
    });
    if (row) out.push(row);
  }
  return out;
}

/**
 * Merge rows into the ledger: the same key replaces its old row, rows stay in
 * time order, and the oldest beyond MAX_LEDGER are dropped. Mutates `ledger`;
 * returns how many new rows are in the ledger afterwards (a row older than a
 * full ledger is dropped at once and not counted).
 */
export function recordLedger(ledger, rows) {
  const pushed = [];
  for (const row of rows) {
    const i = ledger.findIndex(r => r.k === row.k);
    if (i >= 0) ledger[i] = row;
    else {
      ledger.push(row);
      pushed.push(row);
    }
  }
  ledger.sort((a, b) => a.t - b.t);
  if (ledger.length > MAX_LEDGER) ledger.splice(0, ledger.length - MAX_LEDGER);
  return pushed.filter(row => ledger.includes(row)).length;
}

/** The time-control class you play most at a board over the last `days`, or null; daily games do not count. */
export function mainControl(ledger, { now = Date.now(), days = 42 } = {}) {
  const counts = {};
  for (const r of ledger) if (r.tc && r.tc !== 'correspondence' && r.t >= now - days * DAY) counts[r.tc] = (counts[r.tc] || 0) + 1;
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
}

/** Rows that ended in [from, to), optionally in one control. */
export function rowsBetween(ledger, from, to, { control = null } = {}) {
  return ledger.filter(r => r.t >= from && r.t < to && (!control || r.tc === control));
}

/** Consecutive losses ending at the newest row (optionally in one control). */
export function lossRun(ledger, { control = null } = {}) {
  const rows = control ? ledger.filter(r => r.tc === control) : ledger;
  let length = 0;
  for (let i = rows.length - 1; i >= 0 && rows[i].r === 0; i--) length++;
  return { length, endedAt: length ? rows[rows.length - 1].t : null };
}

/** The longest run of consecutive losses among rows in time order. */
export function longestRun(rows) {
  let best = 0;
  let run = 0;
  for (const r of [...rows].sort((a, b) => a.t - b.t)) {
    run = r.r === 0 ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

const finite = (n, min = -Infinity, max = Infinity) => Number.isFinite(n) && n >= min && n <= max;
const VALID_TC = ['bullet', 'blitz', 'rapid', 'classical', 'correspondence'];

/** An error string for a malformed ledger, or null. Used by state.validate. */
export function validateLedger(ledger) {
  if (!Array.isArray(ledger) || ledger.length > MAX_LEDGER * 2) return 'ledger';
  for (const r of ledger) {
    if (!r || typeof r.k !== 'string' || !finite(r.t, 0)) return 'ledger row';
    if (r.d !== null && !finite(r.d, 0)) return 'ledger row';
    if (![0, 1].includes(r.x) || ![0, 0.5, 1].includes(r.r) || !['w', 'b'].includes(r.c)) return 'ledger row';
    if (r.tc !== null && !VALID_TC.includes(r.tc)) return 'ledger row';
    if ((r.base !== null && !finite(r.base, 0)) || (r.inc !== null && !finite(r.inc, 0))) return 'ledger row';
    if (!TERMS.includes(r.term) || !finite(r.n, 0)) return 'ledger row';
    if ((r.me !== null && !finite(r.me, 100, 3500)) || (r.opp !== null && !finite(r.opp, 100, 3500))) return 'ledger row';
    if (![0, 1].includes(r.rated) || !['lichess', 'chesscom'].includes(r.src)) return 'ledger row';
  }
  return null;
}
