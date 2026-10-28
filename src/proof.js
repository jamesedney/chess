// Proof: the habit measured in your real games, and tested like an
// experiment. The gate trains one thing: time spent on captures and checks,
// and the hung pieces that come from playing them fast. Your imported games
// carry clocks, so both can be measured in the games you play online, with
// the gate on in practice and with it off, two weeks each. What moves is
// kept; what does not is dropped. Pure functions of the state; Today
// advances the experiment and You shows it.
import { Chess } from '../vendor/chess.js';
import { thresholds, timeSpent } from './clocks.js';
import { mainControl } from './ledger.js';
import { dateKey } from './state.js';

const DAY = 86400000;
/** Each phase of an experiment runs this long. */
export const PHASE_DAYS = 14;
/** A verdict needs this many reviewed games with clocks in each phase. */
export const MIN_GAMES = 8;
/** What counts as better: fast critical moves down by this share, or hung pieces per game down by this much. */
export const FAST_GAP = 0.08;
export const HUNG_GAP = 0.25;

const SAFETY = new Set(['hung-piece', 'allowed-mate']);

/**
 * Your critical moves (captures and checks) in a reviewed game with clocks:
 * [{ ply, san, spent, fast }] where spent is seconds and fast is under the
 * control's rushed threshold. Empty without clocks or a readable game.
 */
export function criticalMoves(review) {
  if (!review?.clocks || !review.tc || !Array.isArray(review.moves)) return [];
  const g = new Chess(review.startFen);
  const t = thresholds(review.tc);
  const out = [];
  for (let i = 0; i < review.moves.length && i < review.clocks.length; i++) {
    const mine = g.turn() === review.colour;
    let m;
    try {
      m = g.move(review.moves[i]);
    } catch {
      break;
    }
    if (!mine || !(m.captured || g.isCheck())) continue;
    const spent = timeSpent(review.clocks, review.tc, i);
    if (spent === null) continue;
    out.push({ ply: i, san: m.san, spent, fast: spent < t.rushed });
  }
  return out;
}

/** Reviews of the main control with clocks, played in [from, to). */
function clocked(state, control, from, to) {
  return (state.reviews || []).filter(
    r =>
      r.complete &&
      r.clocks &&
      r.tc &&
      (r.created || 0) >= from &&
      (r.created || 0) < to &&
      (!control || !r.tc || controlOf(r) === control),
  );
}

/** The ledger's control name for a review's time control. */
function controlOf(r) {
  const base = r.tc?.base ?? 0;
  const inc = r.tc?.inc ?? 0;
  const est = base + 40 * inc;
  return est < 180 ? 'bullet' : est < 480 ? 'blitz' : est < 1500 ? 'rapid' : 'classical';
}

/**
 * The habit in your real games over [from, to): { games, critical: { n, fast },
 * hung: { n, perGame } }. `fast` counts captures and checks played under
 * the rushed threshold; `hung` counts serious mistakes that hung a piece or
 * your king.
 */
export function habitIn(state, from, to, control = null) {
  const reviews = clocked(state, control, from, to);
  let n = 0;
  let fast = 0;
  let hung = 0;
  for (const r of reviews) {
    for (const c of criticalMoves(r)) {
      n++;
      if (c.fast) fast++;
    }
    for (const m of r.marks || []) {
      if (m.cleared || m.cls === 'inaccuracy') continue;
      const kind = state.mistakes?.find(x => x.id === m.mistakeId)?.kind || null;
      if (SAFETY.has(kind) || (m.cls === 'blunder' && !kind)) hung++;
    }
  }
  return { games: reviews.length, critical: { n, fast }, hung: { n: hung, perGame: reviews.length ? hung / reviews.length : null } };
}

/** The habit now against the two weeks before: { now, before }, each as habitIn. */
export function habitTrend(state, { now = Date.now(), days = PHASE_DAYS } = {}) {
  const control = mainControl(state.ledger || [], { now });
  return {
    control,
    now: habitIn(state, now - days * DAY, Infinity, control),
    before: habitIn(state, now - 2 * days * DAY, now - days * DAY, control),
  };
}

/** The share of critical moves played fast, or null without enough. */
const fastShare = h => (h.critical.n >= 10 ? h.critical.fast / h.critical.n : null);

/**
 * Judge an experiment from its two phases: { keep: true | false | null, text }.
 * Null when either phase has too few games with clocks.
 */
export function judge(on, off) {
  if (on.games < MIN_GAMES || off.games < MIN_GAMES)
    return {
      keep: null,
      text: `Not enough games with clocks yet (${on.games} with the gate on, ${off.games} off; ${MIN_GAMES} each needed).`,
    };
  const fOn = fastShare(on);
  const fOff = fastShare(off);
  const hOn = on.hung.perGame;
  const hOff = off.hung.perGame;
  const fastBetter = fOn !== null && fOff !== null && fOff - fOn >= FAST_GAP;
  const hungBetter = hOn !== null && hOff !== null && hOff - hOn >= HUNG_GAP;
  const pct = x => `${Math.round(x * 100)}%`;
  const parts = [];
  if (fOn !== null && fOff !== null) parts.push(`fast captures and checks ${pct(fOn)} with the gate on, ${pct(fOff)} off`);
  if (hOn !== null && hOff !== null) parts.push(`hung pieces ${hOn.toFixed(1)} a game on, ${hOff.toFixed(1)} off`);
  const detail = parts.join('; ');
  if (fastBetter || hungBetter) return { keep: true, text: `The gate works: ${detail}. Kept.` };
  return { keep: false, text: `The gate made no difference in your real games: ${detail}. Dropped.` };
}

/** The experiment running or last run on the gate, or null. */
export function currentExperiment(state) {
  return (state.experiments || []).find(e => e.habit === 'gate' && e.phase !== 'done') || null;
}

/**
 * Advance the gate experiment by the calendar. Starts one when none is
 * running and the gate is not set by hand: on for PHASE_DAYS at the stage
 * given, then off for PHASE_DAYS, then a verdict that sets the stage. A kept
 * gate steps down one stage for the next experiment (the fade), a dropped one
 * is off until you turn it on, an inconclusive one runs again. Mutates
 * state; returns the experiment changed, or null.
 */
export function advanceExperiment(state, now = Date.now()) {
  state.experiments ||= [];
  const gate = (state.gate ||= { stage: 3, set: 'default', since: null });
  if (gate.set === 'you') return null;
  let e = currentExperiment(state);
  if (!e) {
    if (gate.stage === 0) return null;
    e = {
      id: 'x' + now.toString(36),
      habit: 'gate',
      stage: gate.stage,
      phase: 'on',
      start: now,
      off: null,
      end: null,
      on: null,
      offResult: null,
      verdict: null,
    };
    state.experiments.push(e);
    gate.set = 'proof';
    gate.since = dateKey(new Date(now));
    return e;
  }
  const control = mainControl(state.ledger || [], { now });
  if (e.phase === 'on' && now >= e.start + PHASE_DAYS * DAY) {
    e.on = habitIn(state, e.start, now, control);
    e.phase = 'off';
    e.off = now;
    gate.stage = 0;
    gate.set = 'proof';
    gate.since = dateKey(new Date(now));
    return e;
  }
  if (e.phase === 'off' && now >= e.off + PHASE_DAYS * DAY) {
    e.offResult = habitIn(state, e.off, now, control);
    e.verdict = judge(e.on, e.offResult);
    e.phase = 'done';
    e.end = now;
    if (e.verdict.keep === true) gate.stage = Math.max(1, e.stage - 1);
    else if (e.verdict.keep === false) gate.stage = 0;
    else gate.stage = e.stage;
    gate.set = 'proof';
    gate.since = dateKey(new Date(now));
    if (state.experiments.length > 20) state.experiments.splice(0, state.experiments.length - 20);
    return e;
  }
  return null;
}

/** "Gate on (captures and checks), day 3 of 14; then off for 14 days." for the running experiment. */
export function experimentLine(e, now = Date.now()) {
  if (!e) return null;
  const stages = ['off', 'only where Nemesis set a trap', 'captures', 'captures and checks'];
  if (e.phase === 'on') {
    const day = Math.min(PHASE_DAYS, Math.floor((now - e.start) / DAY) + 1);
    return `Gate on (${stages[e.stage]}), day ${day} of ${PHASE_DAYS}; then off for ${PHASE_DAYS} days, and the two compared in your real games.`;
  }
  if (e.phase === 'off') {
    const day = Math.min(PHASE_DAYS, Math.floor((now - e.off) / DAY) + 1);
    return `Gate off, day ${day} of ${PHASE_DAYS}; the verdict follows.`;
  }
  return e.verdict?.text || null;
}
