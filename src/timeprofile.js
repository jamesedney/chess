// How you use the clock, from the %clk data in your imported games: critical
// moves played too fast, easy ones played too slowly, time trouble and games
// lost on time. Picks the drill that trains the habit. Pure.
import { moveTime, thresholds } from './clocks.js';
import { outcome } from './openings.js';

const DAY = 86400000;

/** Seconds that count as a long think for a time control. */
export const slowThreshold = tc => Math.max(20, tc.base * 0.08);

/**
 * Clock habits over recent games with clock data. Returns { games, critical,
 * rushed, slow, moves, trouble, flagged, verdict, drill } where verdict is
 * 'rushed' (critical moments played fast), 'slow' (time trouble or losses on
 * time), 'balanced' or null when there is too little data.
 */
export function timeProfile(state, now = Date.now(), days = 60) {
  const out = { games: 0, critical: 0, rushed: 0, slow: 0, moves: 0, trouble: 0, flagged: 0, verdict: null, drill: null };
  for (const r of state.reviews) {
    if (!r.complete || !r.clocks || !r.tc || (r.created || now) < now - days * DAY) continue;
    out.games++;
    const marked = new Set(r.marks.filter(m => !m.cleared && m.cls !== 'inaccuracy').map(m => m.ply));
    const t = thresholds(r.tc);
    let inTrouble = false;
    let lastLeft = null;
    for (let i = 0; i < r.moves.length; i++) {
      const isMine = (i % 2 === 0) === (r.startFen.split(' ')[1] === r.colour);
      if (!isMine) continue;
      const mt = moveTime(r, i);
      if (!mt) continue;
      out.moves++;
      lastLeft = r.clocks[i];
      if (marked.has(i)) {
        out.critical++;
        if (mt.rushed) out.rushed++;
      } else if (mt.spent >= slowThreshold(r.tc)) out.slow++;
      // Short of time before move 30: the clock, not the position, decided the rest.
      if (i < 60 && mt.left < t.trouble) inTrouble = true;
    }
    if (inTrouble) out.trouble++;
    if (outcome(r.result, r.colour) === 0 && lastLeft !== null && lastLeft <= 2) out.flagged++;
  }
  if (out.games >= 2) {
    if (out.critical >= 3 && out.rushed / out.critical >= 0.4) out.verdict = 'rushed';
    else if (out.trouble / out.games >= 0.3 || out.flagged >= 2) out.verdict = 'slow';
    else out.verdict = 'balanced';
  }
  out.drill = out.verdict === 'rushed' ? 'pause' : out.verdict === 'slow' ? 'pace' : null;
  return out;
}

/** One sentence about the profile, for the You page. */
export function profileText(p) {
  if (!p.verdict) return 'Import a few games with clock data (Lichess or Chess.com) to see how you use your time.';
  if (p.verdict === 'rushed')
    return `${p.rushed} of your ${p.critical} costliest moves were played in a hurry. The pause drill trains a check before critical moves.`;
  if (p.verdict === 'slow')
    return `You were short of time before move 30 in ${p.trouble} of ${p.games} games${p.flagged ? ` and lost ${p.flagged} on time` : ''}. The pace drill trains faster decisions in simple positions.`;
  return `Your clock use looks balanced over ${p.games} games: no pattern of rushing critical moves or running short.`;
}

/** The two clock drills, as training modes. */
export const CLOCK_DRILLS = {
  pace: { title: 'Pace drill', seconds: 15, detail: 'Easier positions, 15 seconds each: decide quickly when it is simple.' },
  pause: { title: 'Pause drill', lock: 8, detail: 'Your own critical positions: the board waits 8 seconds while you check their threats.' },
  real: { title: 'Same clock', detail: 'Your own positions, with the seconds you actually had.' },
};
