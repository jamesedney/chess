// Clock data from PGN %clk comments: time spent per move and rushed decisions.

/** "300+3" -> { base: 300, inc: 3 }; null for correspondence or unknown controls. */
export function parseTimeControl(tc) {
  const m = /^(\d+)(?:\+(\d+))?$/.exec(String(tc || '').trim());
  return m ? { base: Number(m[1]), inc: Number(m[2] || 0) } : null;
}

/**
 * Remaining clock after each move, in seconds, read from [%clk h:mm:ss] comments.
 * Returns an array the length of the game's move list, or null when the PGN
 * does not carry one clock per move.
 */
export function readClocks(pgn, moveCount) {
  const body = String(pgn).replace(/^\s*\[[^\]]*\]\s*$/gm, '');
  const found = [...body.matchAll(/\[%clk\s+(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)\]/g)].map(
    m => Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 10) / 10,
  );
  return found.length === moveCount && moveCount > 0 ? found : null;
}

/** Seconds spent on move i, or null when unknown. */
export function timeSpent(clocks, tc, i) {
  if (!clocks || !tc || clocks[i] == null) return null;
  const prev = i >= 2 ? clocks[i - 2] : tc.base;
  if (prev == null) return null;
  return Math.max(0, Math.round((prev - clocks[i] + tc.inc) * 10) / 10);
}

/** Thresholds scale with the time control: blitz moves are faster than rapid ones. */
export function thresholds(tc) {
  return { rushed: Math.max(3, tc.base * 0.015), trouble: Math.max(20, tc.base * 0.1) };
}

/**
 * Time facts for one move: { spent, left, rushed, trouble } where left is the
 * clock before the move. Null when the game has no clock data.
 */
export function moveTime(review, i) {
  const tc = review.tc;
  if (!review.clocks || !tc) return null;
  const spent = timeSpent(review.clocks, tc, i);
  const before = i >= 2 ? review.clocks[i - 2] : tc.base;
  if (spent == null || before == null) return null;
  const t = thresholds(tc);
  return { spent, left: before, rushed: spent < t.rushed, trouble: before < t.trouble };
}

/** Summary over the marked (mistake and blunder) moves of one game. */
export function timeSummary(review) {
  const marks = review.marks.filter(m => m.cls !== 'inaccuracy' && !m.cleared);
  let known = 0;
  let rushed = 0;
  let trouble = 0;
  for (const m of marks) {
    const t = moveTime(review, m.ply);
    if (!t) continue;
    known++;
    if (t.rushed) rushed++;
    if (t.trouble) trouble++;
  }
  return { known, rushed, trouble };
}

/** "1:05", "0:07", "1:02:03". */
export function formatClock(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
