// Read your real ratings from Lichess and Chess.com, so the goal tracks itself.
// Public endpoints only; nothing needs a login.

/** Time controls a goal can follow. */
export const RATING_PERFS = ['bullet', 'blitz', 'rapid', 'classical'];
const AUTO = ['rapid', 'blitz', 'classical'];
const CAP = s => s[0].toUpperCase() + s.slice(1);

/**
 * The time control to follow. `prefer` (bullet, blitz, rapid, classical) wins
 * when the account has games in it; otherwise the one you play most among
 * rapid, blitz and classical, rapid winning ties.
 */
export function mainPerf(counts, prefer = 'auto') {
  if (prefer !== 'auto' && counts[prefer] > 0) return prefer;
  const ranked = AUTO.filter(p => counts[p] > 0).sort((a, b) => counts[b] - counts[a] || (a === 'rapid' ? -1 : b === 'rapid' ? 1 : 0));
  return ranked[0] || null;
}

/**
 * Lichess: current ratings and up to 180 days of history for the main time
 * control. Returns { perf: 'Lichess rapid', rating, history: [{ date, rating }] }.
 */
export async function lichessRatings(username, fetchImpl = fetch, now = Date.now(), prefer = 'auto') {
  const res = await fetchImpl(`https://lichess.org/api/user/${encodeURIComponent(username)}`, { headers: { Accept: 'application/json' } });
  if (res.status === 404) throw new Error(`No Lichess account called ${username}.`);
  if (!res.ok) throw new Error(`Lichess returned an error (${res.status}).`);
  const user = await res.json();
  const perfs = user.perfs || {};
  const counts = Object.fromEntries(RATING_PERFS.map(p => [p, perfs[p]?.games || 0]));
  const perf = mainPerf(counts, prefer);
  if (!perf) return null;
  const out = { perf: `Lichess ${perf}`, rating: perfs[perf].rating, history: [] };
  try {
    const h = await fetchImpl(`https://lichess.org/api/user/${encodeURIComponent(username)}/rating-history`, {
      headers: { Accept: 'application/json' },
    });
    if (h.ok) {
      const series = (await h.json()).find(s => s.name === CAP(perf));
      const since = now - 180 * 86400000;
      const byDay = new Map();
      for (const [y, m, d, r] of series?.points || []) {
        const t = Date.UTC(y, m, d);
        if (t < since) continue;
        const date = new Date(t).toISOString().slice(0, 10);
        byDay.set(date, r);
      }
      out.history = [...byDay].map(([date, rating]) => ({ date, rating }));
    }
  } catch {}
  return out;
}

/** Chess.com: current rating for the main time control (no history in the public API). */
export async function chessComRatings(username, fetchImpl = fetch, prefer = 'auto') {
  const res = await fetchImpl(`https://api.chess.com/pub/player/${encodeURIComponent(username.toLowerCase())}/stats`);
  if (res.status === 404) throw new Error(`No Chess.com account called ${username}.`);
  if (!res.ok) throw new Error(`Chess.com returned an error (${res.status}).`);
  const stats = await res.json();
  const key = p => (p === 'classical' ? 'chess_daily' : `chess_${p}`);
  const games = p => {
    const r = stats[key(p)]?.record;
    return r ? (r.win || 0) + (r.loss || 0) + (r.draw || 0) : 0;
  };
  const counts = Object.fromEntries(['bullet', 'blitz', 'rapid', 'classical'].map(p => [p, games(p)]));
  const perf = mainPerf(counts, prefer);
  if (!perf) return null;
  return { perf: `Chess.com ${perf}`, rating: stats[key(perf)].last.rating, history: [] };
}

/**
 * Merge fetched ratings into the saved log: one entry per platform and day,
 * the latest value winning. Mutates `ratings`; returns how many changed.
 */
export function mergeRatings(ratings, { perf, rating, history }, today) {
  let changed = 0;
  const put = (date, value) => {
    const i = ratings.findIndex(r => r.platform === perf && r.date === date);
    if (i >= 0) {
      if (ratings[i].rating !== value) {
        ratings[i].rating = value;
        changed++;
      }
    } else {
      ratings.push({ rating: value, platform: perf, date });
      changed++;
    }
  };
  for (const h of history) put(h.date, h.rating);
  put(today, rating);
  ratings.sort((a, b) => a.date.localeCompare(b.date));
  if (ratings.length > 400) ratings.splice(0, ratings.length - 400);
  return changed;
}

/** The dated series for one platform, for charts and the projection. */
export function seriesFor(ratings, perf) {
  return ratings.filter(r => r.platform === perf).map(r => ({ date: r.date, rating: r.rating }));
}
