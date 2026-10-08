// Spaced repetition and puzzle selection.
export const DAY = 86400000;
export const INTERVAL_DAYS = [1, 3, 7, 14, 30];
export const RETRY_MS = 10 * 60000;

export const emptyRecord = () => ({ tries: 0, clean: 0, box: 0, due: 0, last: 0 });
export const isMistake = p => p.id.startsWith('m');

export function isDue(record, now) {
  return !!record && record.tries > 0 && record.due <= now;
}

/**
 * Update a record after an attempt. Clean solves of due positions move up a
 * box; any help or error sends the position back to box 0 for a quick retry.
 * Clean solves before the due date count as extra practice and keep the box.
 */
export function schedule(record, clean, now) {
  const r = { ...emptyRecord(), ...record };
  const dueNow = r.due <= now;
  r.tries++;
  if (clean) r.clean++;
  r.box = clean ? (dueNow ? Math.min(r.box + 1, 5) : r.box) : 0;
  if (!clean || dueNow) r.due = now + (clean ? INTERVAL_DAYS[r.box - 1] * DAY : RETRY_MS);
  r.last = now;
  return r;
}

/** Per-theme recall: how far attempted positions have climbed the boxes. */
export function themeStats(puzzles, records) {
  const stats = {};
  for (const p of puzzles) {
    const s = (stats[p.theme] ||= { total: 0, attempted: 0, clean: 0, recallSum: 0 });
    s.total++;
    const r = records[p.id];
    if (r?.tries) {
      s.attempted++;
      s.clean += r.clean > 0 ? 1 : 0;
      s.recallSum += Math.min(r.box, 3) / 3;
    }
  }
  for (const s of Object.values(stats)) s.recall = s.attempted ? Math.round((s.recallSum / s.attempted) * 100) : 0;
  return stats;
}

export function dueCount(puzzles, records, now) {
  return puzzles.filter(p => isDue(records[p.id], now)).length;
}

/**
 * Choose the next position.
 * Order: due reviews (personal mistakes first) → untried personal mistakes →
 * new puzzles near the target rating (preferring focus tags, else sometimes the weakest theme) →
 * extra practice: the least cleanly solved, least recently seen positions.
 */
export function choosePuzzle({
  puzzles,
  records,
  mode = 'daily',
  theme = null,
  seen = [],
  target = 1000,
  weakTheme = null,
  focusTags = [],
  strictTags = false,
  dueOnly = false,
  now = Date.now(),
  rng = Math.random,
}) {
  let pool = puzzles.filter(p => !p.archived && (!theme || p.theme === theme) && (mode !== 'mistakes' || isMistake(p)));
  // A curriculum block trains one skill: only puzzles with its tags, when there are any.
  if (strictTags && focusTags.length) {
    const tagged = pool.filter(p => (p.tags || []).some(t => focusTags.includes(t)));
    if (tagged.length) pool = tagged;
  }
  if (dueOnly) pool = pool.filter(p => isDue(records[p.id], now));
  if (!pool.length) return null;
  const unseen = pool.filter(p => !seen.includes(p.id));
  if (unseen.length) pool = unseen;
  const rec = p => records[p.id];
  // Extra practice when nothing is due: the positions solved cleanly fewest
  // times, then the least recently seen, with a little variety so consecutive
  // sessions do not replay the same order.
  const leastRecent = list => {
    const ranked = [...list].sort(
      (a, b) => (rec(a)?.clean || 0) - (rec(b)?.clean || 0) || (rec(a)?.last || 0) - (rec(b)?.last || 0) || a.id.localeCompare(b.id),
    );
    const top = ranked.slice(0, Math.min(3, ranked.length));
    return top[Math.floor(rng() * top.length)];
  };

  const due = pool.filter(p => isDue(rec(p), now));
  if (due.length) return due.sort((a, b) => isMistake(b) - isMistake(a) || rec(a).due - rec(b).due)[0];

  const newMistakes = pool.filter(p => isMistake(p) && !rec(p)?.tries);
  if (newMistakes.length && (mode === 'mistakes' || rng() < 0.5)) return newMistakes[0];
  if (mode === 'mistakes') return leastRecent(pool);

  let fresh = pool.filter(p => !isMistake(p) && !rec(p)?.tries);
  if (fresh.length) {
    // Tactics you missed in your own games come first; otherwise your weakest theme sometimes.
    if (focusTags.length && !strictTags && rng() < 0.6) {
      const focused = fresh.filter(p => (p.tags || []).some(t => focusTags.includes(t)));
      if (focused.length) fresh = focused;
    } else if (!theme && weakTheme && rng() < 0.35) {
      const weak = fresh.filter(p => p.theme === weakTheme);
      if (weak.length) fresh = weak;
    }
    for (const width of [100, 200, 350, 600, Infinity]) {
      const near = fresh.filter(p => Math.abs((p.rating || 1000) - target) <= width);
      if (near.length) return near[Math.floor(rng() * near.length)];
    }
  }
  return leastRecent(pool);
}
