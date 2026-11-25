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

/**
 * Choose the next position to train. While positions from your own games are
 * waiting (due again, or never tried), two of every three come from them and
 * the third is a puzzle; `turn` counts positions served this sitting.
 * Puzzles: one due for another look first, else a new one near your rating,
 * else the one seen longest ago. `seen` holds ids already served this sitting,
 * so a position missed a moment ago is not asked again at once.
 * Returns { position, own } or null when there is nothing at all.
 */
export function nextPosition({ mistakes, puzzles, records, rating, turn = 0, seen = [], now = Date.now(), rng = Math.random }) {
  const skip = new Set(seen);
  const rec = p => records[p.id];
  const mine = mistakes.filter(m => !m.archived && !skip.has(m.id));
  const ownDue = mine.filter(m => isDue(rec(m), now)).sort((a, b) => rec(a).due - rec(b).due);
  const own = ownDue[0] || mine.find(m => !rec(m)?.tries) || null;

  const pool = puzzles.filter(p => !skip.has(p.id));
  const puzzleDue = pool.filter(p => isDue(rec(p), now)).sort((a, b) => rec(a).due - rec(b).due);
  let puzzle = puzzleDue[0] || null;
  if (!puzzle) {
    const fresh = pool.filter(p => !rec(p)?.tries);
    for (const width of [75, 150, 300, 600, Infinity]) {
      const near = fresh.filter(p => Math.abs((p.rating || rating) - rating) <= width);
      if (near.length) {
        puzzle = near[Math.floor(rng() * near.length)];
        break;
      }
    }
  }
  // Every puzzle tried and none due: the one seen longest ago.
  if (!puzzle && pool.length) puzzle = [...pool].sort((a, b) => (rec(a)?.last || 0) - (rec(b)?.last || 0))[0];

  const wantOwn = turn % 3 !== 2;
  const position = wantOwn ? own || puzzle : puzzle || own;
  return position ? { position, own: isMistake(position) } : null;
}

/** Positions from your games still to fix (never solved cleanly, or due again) and those solved. */
export function ownCounts(mistakes, records, now = Date.now()) {
  let waiting = 0;
  let solved = 0;
  for (const m of mistakes) {
    if (m.archived) continue;
    const r = records[m.id];
    if (r?.clean && !isDue(r, now)) solved++;
    else waiting++;
  }
  return { waiting, solved };
}
