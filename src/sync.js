// Automatic import: fetch the user's new games from Lichess and Chess.com and
// hand them to the analysis queue. The filters and URL building are pure and
// unit tested; the network calls take a fetch implementation.
import { splitPgn, readHeaders, loadGame, detectColour } from './pgn.js';
import { dateKey } from './state.js';

export const CONTROLS = ['bullet', 'blitz', 'rapid', 'classical', 'correspondence'];
export const DEFAULT_SYNC = () => ({
  auto: true,
  ratedOnly: true,
  controls: ['blitz', 'rapid', 'classical'],
  minMoves: 10,
  dailyCap: 5,
  last: { lichess: 0, chesscom: 0 },
  seen: [],
  today: { d: '', n: 0 },
  ledgerAt: 0, // when the game ledger was first filled (ms); 0 until the first sync after 5.0
});
const FIRST_SYNC_DAYS = 7;
const MAX_SEEN = 300;
/** The ledger's first fill reaches back this far, this many games; later syncs fetch SYNC_MAX. */
export const LEDGER_DAYS = 60;
export const LEDGER_MAX = 200;
export const SYNC_MAX = 60;
const DAY = 86400000;

/** Lichess games export for one user, newest first, filtered server-side where it can be. */
export function lichessUrl(username, sync, since, max = SYNC_MAX) {
  const perf = sync.controls.includes('bullet') ? [...sync.controls, 'ultraBullet'] : sync.controls;
  const q = new URLSearchParams({
    since: String(since),
    max: String(max),
    moves: 'true',
    tags: 'true',
    clocks: 'true',
    evals: 'true',
    opening: 'false',
    perfType: perf.join(','),
  });
  if (sync.ratedOnly) q.set('rated', 'true');
  return `https://lichess.org/api/games/user/${encodeURIComponent(username)}?${q}`;
}

/** Time-control class from a PGN TimeControl header, by Lichess's estimated-duration rule. */
export function controlClass(tc) {
  const m = /^(\d+)(?:\+(\d+))?$/.exec(String(tc || '').trim());
  if (!m) return /^\d+\/\d+$/.test(String(tc || '')) ? 'correspondence' : null;
  const total = Number(m[1]) + 40 * Number(m[2] || 0);
  if (total < 180) return 'bullet';
  if (total < 480) return 'blitz';
  if (total < 1500) return 'rapid';
  return 'classical';
}

/** A stable key for a game: its site URL when present, otherwise its moves. */
export function gameKey(pgn) {
  const h = readHeaders(pgn);
  if (h.Site && /^https?:\/\//.test(h.Site)) return h.Site.replace(/^https?:\/\//, '').replace(/\/(black|white)$/, '');
  if (h.Link && /^https?:\/\//.test(h.Link)) return h.Link.replace(/^https?:\/\//, '');
  return pgn
    .replace(/^\s*\[[^\]]*\]\s*$/gm, '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
}

/**
 * Decide whether a fetched game is worth analysing.
 * Returns { ok: true, colour } or { ok: false, reason }.
 */
export function acceptGame(pgn, usernames, sync, { rated = null, control = null } = {}) {
  const h = readHeaders(pgn);
  if (h.Variant && h.Variant !== 'Standard' && h.Variant !== 'From Position') return { ok: false, reason: 'variant' };
  if (!h.Result || h.Result === '*') return { ok: false, reason: 'unfinished' };
  const isRated = rated ?? (h.Event ? /rated/i.test(h.Event) && !/unrated|casual/i.test(h.Event) : null);
  if (sync.ratedOnly && isRated === false) return { ok: false, reason: 'casual' };
  const cls = control || controlClass(h.TimeControl);
  if (cls && !sync.controls.includes(cls)) return { ok: false, reason: 'time control' };
  const colour = detectColour(pgn, usernames);
  if (!colour) return { ok: false, reason: 'not your game' };
  let moves;
  try {
    moves = loadGame(pgn).history().length;
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  if (moves < sync.minMoves * 2) return { ok: false, reason: 'too short' };
  return { ok: true, colour };
}

/** The start of a game from its UTCDate/UTCTime headers, or null. */
function startMs(pgn) {
  const h = readHeaders(pgn);
  const d = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(h.UTCDate || '');
  const t = /^(\d{1,2}):(\d{2}):(\d{2})/.exec(h.UTCTime || '');
  return d && t ? Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2], +t[3]) : null;
}

/**
 * Fetch games from Lichess. The first sync after 5.0 reaches back LEDGER_DAYS
 * to fill the game ledger; games before the normal window are returned with
 * `fresh: false` so they feed the ledger but are not queued for review.
 */
export async function fetchLichessNew(username, sync, { fetchImpl = fetch, now = Date.now() } = {}) {
  const normalSince = sync.last.lichess || now - FIRST_SYNC_DAYS * DAY;
  // The 60-day backfill runs on the first sync after 5.0 and on the first sync of a Lichess account linked later.
  const backfill = !sync.ledgerAt || !sync.last.lichess;
  const since = backfill ? Math.min(normalSince, now - LEDGER_DAYS * DAY) : normalSince;
  let res;
  try {
    res = await fetchImpl(lichessUrl(username, sync, since, backfill ? LEDGER_MAX : SYNC_MAX), {
      headers: { Accept: 'application/x-chess-pgn' },
    });
  } catch {
    throw new Error('Could not reach lichess.org.');
  }
  if (res.status === 404) throw new Error(`No Lichess account called ${username}.`);
  if (res.status === 429) throw new Error('Lichess is rate-limiting requests. It will retry later.');
  if (!res.ok) throw new Error(`Lichess returned an error (${res.status}).`);
  return splitPgn(await res.text()).map(pgn => {
    const start = startMs(pgn);
    return { pgn, source: 'lichess', fresh: start === null || start >= normalSince };
  });
}

export async function fetchChessComNew(username, sync, { fetchImpl = fetch, now = Date.now() } = {}) {
  const since = sync.last.chesscom || now - FIRST_SYNC_DAYS * 86400000;
  const base = `https://api.chess.com/pub/player/${encodeURIComponent(username.toLowerCase())}/games/archives`;
  let res;
  try {
    res = await fetchImpl(base);
  } catch {
    throw new Error('Could not reach chess.com.');
  }
  if (res.status === 404) throw new Error(`No Chess.com account called ${username}.`);
  if (!res.ok) throw new Error(`Chess.com returned an error (${res.status}).`);
  const archives = ((await res.json()).archives || []).slice(-2);
  const out = [];
  for (const url of archives) {
    const r = await fetchImpl(url);
    if (!r.ok) continue;
    // Every game in the two archives feeds the ledger; only games after `since` are fresh.
    for (const g of ((await r.json()).games || []).reverse()) {
      if (!g.pgn || g.rules !== 'chess') continue;
      const control = g.time_class === 'daily' ? 'correspondence' : g.time_class || null;
      const ended = (g.end_time || 0) * 1000;
      out.push({
        pgn: g.pgn,
        source: 'chesscom',
        rated: !!g.rated,
        control,
        ended: ended || null,
        fresh: ended > since,
        results: { w: g.white?.result ?? null, b: g.black?.result ?? null },
        ratings: { w: g.white?.rating ?? null, b: g.black?.rating ?? null },
      });
    }
  }
  return out;
}

/**
 * Pick the games to queue from a fetch result, honouring the daily cap and the
 * list of games already seen. Mutates sync (seen, today, last). Pure otherwise.
 */
export function selectNew(fetched, { usernames, sync, source, now = Date.now() }) {
  const today = dateKey(new Date(now));
  if (sync.today.d !== today) sync.today = { d: today, n: 0 };
  const chosen = [];
  // Next time, fetch from an hour before this sync, or from before the start of
  // a game still running, so it is fetched again when it ends; `seen` removes the overlap.
  let from = now - 3600000;
  for (const g of fetched) {
    // Ledger-only games (before the review window) are neither queued nor marked seen.
    if (g.fresh === false) continue;
    const key = gameKey(g.pgn);
    if (sync.seen.includes(key)) continue;
    const verdict = acceptGame(g.pgn, usernames, sync, { rated: g.rated ?? null, control: g.control ?? null });
    // A game still in progress is not seen yet: it is fetched again when it ends.
    if (!verdict.ok && verdict.reason === 'unfinished') {
      const start = startMs(g.pgn);
      if (start !== null) from = Math.min(from, start - 60000);
      continue;
    }
    sync.seen.push(key);
    if (!verdict.ok) continue;
    if (sync.today.n >= sync.dailyCap) continue;
    sync.today.n++;
    chosen.push({ pgn: g.pgn, colour: verdict.colour, source, key, added: now });
  }
  sync.last[source] = from;
  if (sync.seen.length > MAX_SEEN) sync.seen.splice(0, sync.seen.length - MAX_SEEN);
  return chosen;
}
