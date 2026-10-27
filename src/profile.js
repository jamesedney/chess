// Where your points go: what your recent games say about how you lose, read
// from every game in the ledger and every serious mistake in your reviews,
// not only the move that decided each game. The You page shows it, and the
// planner takes its orders from it. Pure functions of the state.
import { annotate } from './tilt.js';
import { mainControl, score } from './ledger.js';
import { moveTime, rushedText } from './clocks.js';
import { WINDOW_DAYS } from './leak.js';

const DAY = 86400000;
/** A game over by move 30 is a short one. */
export const SHORT_PLIES = 60;
/** From the 4th game of a sitting on is late (the ledger counts a sitting's games from 1). */
export const LATE_GAME = 4;
/** A flag needs this many errors (or games) behind it, and this gap in score or share. */
export const MIN_ERRORS = 8;
export const MIN_GAMES = 10;
export const SCORE_GAP = 0.08;
/** Fast or hung: a share of serious mistakes this large is a flag. */
export const ERROR_SHARE = 0.4;
/** Behind at move 10 by this much on average, over this many games, with one colour. */
export const OPENING_DEFICIT = -80;
export const OPENING_GAMES = 4;
/** Recalling your repertoire positions from memory less often than this. */
export const RECALL_SHARE = 0.5;
export const RECALL_MIN = 10;

const SAFETY_KINDS = new Set(['hung-piece', 'allowed-mate']);
const pov = (e, colour) => (e == null ? null : colour === 'w' ? e : -e);
const part = rows => ({ games: rows.length, score: rows.length ? score(rows) : null });

/** The serious mistakes (not inaccuracies, not cleared) of these reviews, with how fast each was played. */
export function seriousErrors(state, reviews) {
  const out = [];
  for (const r of reviews) {
    for (const m of r.marks || []) {
      if (m.cleared || m.cls === 'inaccuracy') continue;
      const kind = state.mistakes?.find(x => x.id === m.mistakeId)?.kind || null;
      const t = r.clocks && r.tc ? moveTime(r, m.ply) : null;
      out.push({
        reviewId: r.id,
        ply: m.ply,
        fast: t ? t.rushed : null,
        hung: SAFETY_KINDS.has(kind) || (m.cls === 'blunder' && !kind),
        tc: r.tc || null,
      });
    }
  }
  return out;
}

/** Reviews created in [from, to). */
const reviewsBetween = (state, from, to) =>
  (state.reviews || []).filter(r => r.complete && (r.created || 0) >= from && (r.created || 0) < to);

/** Fast and hung shares over the serious mistakes of one window. */
function errorStats(errors) {
  const timed = errors.filter(e => e.fast !== null);
  return {
    n: errors.length,
    timed: timed.length,
    fast: timed.filter(e => e.fast).length,
    hung: errors.filter(e => e.hung).length,
  };
}

/**
 * The profile of the last `days`: the main control's games split by length and
 * by place in the sitting, your serious mistakes (how many fast, how many
 * hung), where you stand at move 10 with each colour, and how often you recall
 * your repertoire. `flags` names what is costing points, for the planner.
 */
export function pointsProfile(state, { now = Date.now(), days = WINDOW_DAYS } = {}) {
  const ledger = [...(state.ledger || [])].sort((a, b) => a.t - b.t);
  const control = mainControl(ledger, { now });
  const rows = control ? annotate(ledger).filter(r => r.tc === control && r.t >= now - days * DAY) : [];
  const losses = rows.filter(r => r.r === 0);
  const reviews = reviewsBetween(state, now - days * DAY, Infinity);
  const errors = errorStats(seriousErrors(state, reviews));
  const opening = {};
  for (const colour of ['w', 'b']) {
    const evals = reviews
      .filter(r => r.colour === colour && r.startFen?.startsWith('rnbqkbnr/pppppppp'))
      .map(r => pov(r.evals?.[20], colour));
    const known = evals.filter(e => e !== null);
    opening[colour] = { games: known.length, avg: known.length ? Math.round(known.reduce((a, b) => a + b, 0) / known.length) : null };
  }
  const log = (state.log || []).filter(e => e.k === 'o' && e.d >= new Date(now - days * DAY).toISOString().slice(0, 10));
  const recall = { n: log.length, clean: log.filter(e => e.c === 1).length };
  const short = part(rows.filter(r => r.n < SHORT_PLIES));
  const long = part(rows.filter(r => r.n >= SHORT_PLIES));
  const early = part(rows.filter(r => r.idx < LATE_GAME));
  const late = part(rows.filter(r => r.idx >= LATE_GAME));
  const gap = (a, b) => a.games >= MIN_GAMES && b.games >= MIN_GAMES && b.score - a.score >= SCORE_GAP;
  const flags = {
    fast: errors.timed >= MIN_ERRORS && errors.fast / errors.timed >= ERROR_SHARE,
    hung: errors.n >= MIN_ERRORS && errors.hung / errors.n >= ERROR_SHARE,
    short: gap(short, long),
    late: gap(late, early),
    opening: ['w', 'b'].some(c => opening[c].games >= OPENING_GAMES && opening[c].avg <= OPENING_DEFICIT),
    recall: recall.n >= RECALL_MIN && recall.clean / recall.n < RECALL_SHARE,
  };
  return {
    control,
    days,
    games: rows.length,
    score: rows.length ? score(rows) : null,
    lost: losses.length,
    reviewedLosses: losses.filter(r => (state.reviews || []).some(v => v.complete && v.gameKey === r.k)).length,
    short,
    long,
    early,
    late,
    errors,
    opening,
    recall,
    base: rows.find(r => r.base)?.base || 300,
    flags,
  };
}

/**
 * Is it working: the share of serious mistakes played fast and the share of
 * games lost by move 30, in the last two weeks and the two weeks before.
 * Each side is null when there is too little to compare.
 */
export function trend(state, { now = Date.now(), days = 14 } = {}) {
  const ledger = state.ledger || [];
  const control = mainControl(ledger, { now });
  const windowOf = (from, to) => {
    const errors = errorStats(seriousErrors(state, reviewsBetween(state, from, to)));
    const rows = ledger.filter(r => r.tc === control && r.t >= from && r.t < to);
    return {
      fast: errors.timed >= 5 ? { n: errors.timed, k: errors.fast } : null,
      shortLosses: rows.length >= MIN_GAMES ? { n: rows.length, k: rows.filter(r => r.r === 0 && r.n < SHORT_PLIES).length } : null,
    };
  };
  return { now: windowOf(now - days * DAY, Infinity), before: windowOf(now - 2 * days * DAY, now - days * DAY) };
}

const pct = x => `${Math.round(x * 100)}%`;
const evalText = cp => (cp > 0 ? '+' : cp < 0 ? '−' : '') + Math.abs(cp / 100).toFixed(1);

/** The profile as plain lines, the costliest first, each { id, text } and flagged when it costs points. */
export function profileLines(p) {
  const lines = [];
  const e = p.errors;
  if (e.timed >= MIN_ERRORS)
    lines.push({
      id: 'fast',
      flag: p.flags.fast,
      text: `${e.fast} of ${e.timed} serious mistakes were played in ${rushedText({ base: p.base, inc: 0 })}.`,
    });
  if (e.n >= MIN_ERRORS)
    lines.push({ id: 'hung', flag: p.flags.hung, text: `${e.hung} of ${e.n} serious mistakes left a piece or your king to be taken.` });
  if (p.short.games >= MIN_GAMES && p.long.games >= MIN_GAMES)
    lines.push({
      id: 'short',
      flag: p.flags.short,
      text: `You score ${pct(p.short.score)} in games over by move 30 and ${pct(p.long.score)} in longer ones.`,
    });
  if (p.late.games >= MIN_GAMES && p.early.games >= MIN_GAMES)
    lines.push({
      id: 'late',
      flag: p.flags.late,
      text: `You score ${pct(p.late.score)} from the 4th game of a sitting on and ${pct(p.early.score)} before it.`,
    });
  for (const [c, name] of [
    ['w', 'White'],
    ['b', 'Black'],
  ]) {
    const o = p.opening[c];
    if (o.games >= OPENING_GAMES && o.avg <= OPENING_DEFICIT)
      lines.push({ id: 'opening', flag: true, text: `As ${name} you stand ${evalText(o.avg)} at move 10 on average (${o.games} games).` });
  }
  if (p.recall.n >= RECALL_MIN)
    lines.push({
      id: 'recall',
      flag: p.flags.recall,
      text: `You recalled ${p.recall.clean} of ${p.recall.n} repertoire positions from memory.`,
    });
  return lines.sort((a, b) => Number(b.flag) - Number(a.flag));
}

/**
 * The play rule, adapted to your games: when your 4th game of a sitting on has
 * cost points over the last 30 days, the rule is 3 games. Takes and returns a
 * tilt profile (tilt.js), with its rule and label replaced.
 */
export function adaptRule(tilt, profile) {
  if (!profile?.flags.late || tilt.rule.games <= 3) return tilt;
  const r = tilt.rule;
  return {
    ...tilt,
    rule: {
      ...r,
      games: 3,
      default: false,
      label: 'Your rule',
      text: `Play 3 games. Stop after ${r.stopAfter} losses in a row. Wait ${r.waitMin} minutes after a loss.`,
    },
  };
}
