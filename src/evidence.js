// Is it working? Your recent games against the weeks before, per measure, with
// what you trained in each window, and the one problem the planner should push
// hardest on next. Pure functions of the state.
import { timeSummary } from './clocks.js';
import { outcome } from './openings.js';
import { dateKey } from './state.js';
import { habits } from './debrief.js';
import { timeProfile } from './timeprofile.js';
import { WINNING } from './replay.js';

const DAY = 86400000;
export const RECENT_DAYS = 14;
export const BEFORE_DAYS = 42;
const THREAT_KINDS = new Set(['hung-piece', 'allowed-mate']);

/** Per-game facts for one reviewed game. */
function gameFacts(state, r) {
  const marks = r.marks.filter(m => !m.cleared && m.cls !== 'inaccuracy');
  const kind = id => state.mistakes.find(m => m.id === id)?.kind;
  const sign = r.colour === 'w' ? 1 : -1;
  const winning = (r.evals || []).some((e, i) => e !== null && e !== undefined && sign * e >= WINNING && i > 0);
  return {
    score: outcome(r.result, r.colour),
    blunders: marks.filter(m => m.cls === 'blunder').length,
    threats: marks.filter(m => m.reason === 'threat' || (!m.reason && THREAT_KINDS.has(kind(m.mistakeId)))).length,
    rushed: timeSummary(r).rushed,
    clock: !!r.clocks,
    winning,
  };
}

function windowStats(state, games, from, to) {
  const list = games.filter(g => g.at >= from && g.at < to).map(g => g.facts);
  const n = list.length;
  const avg = key => (n ? list.reduce((a, f) => a + (f[key] ?? 0), 0) / n : null);
  const clocked = list.filter(f => f.clock);
  const winning = list.filter(f => f.winning && f.score !== null);
  const d0 = dateKey(new Date(from));
  const d1 = dateKey(new Date(to));
  const log = state.log.filter(e => e.d >= d0 && e.d < d1);
  return {
    games: n,
    score: n ? list.reduce((a, f) => a + (f.score ?? 0.5), 0) / n : null,
    blunders: avg('blunders'),
    threats: avg('threats'),
    rushed: clocked.length ? clocked.reduce((a, f) => a + f.rushed, 0) / clocked.length : null,
    clockGames: clocked.length,
    convert: winning.length >= 2 ? winning.filter(f => f.score === 1).length / winning.length : null,
    winningGames: winning.length,
    training: {
      puzzles: log.filter(e => e.k === 'p').length,
      ownMistakes: log.filter(e => e.k === 'm').length,
      debriefs: log.filter(e => e.k === 'b').length,
      replays: log.filter(e => e.k === 'r').length,
      repertoire: log.filter(e => e.k === 'o').length,
      clock: log.filter(e => e.k === 'p' && (e.t === 'pace' || e.t === 'pause')).length,
    },
  };
}

const MEASURES = [
  { id: 'blunders', label: 'Blunders per game', lower: true, step: 0.2 },
  { id: 'threats', label: 'Missed threats per game', lower: true, step: 0.2 },
  { id: 'rushed', label: 'Critical moves played in a hurry, per game', lower: true, step: 0.2 },
  { id: 'convert', label: 'Winning positions converted', lower: false, step: 0.15, percent: true },
  { id: 'score', label: 'Score', lower: false, step: 0.1, percent: true },
];

const fmt = (v, percent) => (v === null ? '–' : percent ? `${Math.round(v * 100)}%` : v.toFixed(1));

/**
 * The last two weeks against the six before them. Each row: { id, label, now,
 * before, verdict: better | worse | steady | unknown, text }. Verdicts need at
 * least three games in each window, and a change bigger than `step` and 20%.
 */
export function evidence(state, now = Date.now()) {
  const games = state.reviews.filter(r => r.complete).map(r => ({ at: r.created || 0, facts: gameFacts(state, r) }));
  const recent = windowStats(state, games, now - RECENT_DAYS * DAY, now + DAY);
  const before = windowStats(state, games, now - (RECENT_DAYS + BEFORE_DAYS) * DAY, now - RECENT_DAYS * DAY);
  const rows = MEASURES.map(m => {
    const a = recent[m.id];
    const b = before[m.id];
    const enough = recent.games >= 3 && before.games >= 3 && a !== null && b !== null;
    let verdict = 'unknown';
    if (enough) {
      const diff = a - b;
      const big = Math.abs(diff) >= m.step && (m.percent || Math.abs(diff) >= 0.2 * Math.max(Math.abs(b), 0.5));
      verdict = !big ? 'steady' : diff < 0 === m.lower ? 'better' : 'worse';
    }
    const text =
      verdict === 'unknown'
        ? 'Not enough games yet.'
        : `${fmt(b, m.percent)} → ${fmt(a, m.percent)}${verdict === 'steady' ? ', within normal variation' : ''}.`;
    return { id: m.id, label: m.label, now: a, before: b, verdict, text };
  });
  const headline = rows.find(r => r.verdict === 'better') || rows.find(r => r.verdict === 'worse') || null;
  return { recent, before, rows, headline };
}

/** One line for Today: the clearest change, or what is needed for one. */
export function headlineText(ev) {
  const h = ev.headline;
  if (!h) return ev.rows.every(r => r.verdict === 'unknown') ? null : 'Your recent games look like the weeks before: steady.';
  const name = h.label.replace(/ per game$/, '').toLowerCase();
  return `${h.verdict === 'better' ? 'Working' : 'Slipping'}: ${name} ${h.text.replace(/\.$/, '')} over the last two weeks.`;
}

/**
 * The one problem to push on, from your debrief notes, clock habits and the
 * evidence: { skill?, drill?, replay?, reason }. Null when nothing stands out.
 */
export function focus(state, now = Date.now()) {
  const h = habits(state);
  const p = timeProfile(state, now);
  const ev = evidence(state, now);
  const worse = id => ev.rows.find(r => r.id === id)?.verdict === 'worse';
  const top = h.total >= 4 && h.list[0]?.share >= 0.35 ? h.list[0] : null;
  if (p.drill === 'pause' || top?.id === 'rushed') return { drill: 'pause', reason: 'You play critical moves too fast.' };
  if (p.drill === 'pace' || top?.id === 'time') return { drill: 'pace', reason: 'You run short of time.' };
  if (worse('convert')) return { replay: true, reason: 'Fewer winning positions are being converted.' };
  if (top?.skill) return { skill: top.skill, reason: `Your debriefs keep saying: ${top.label.toLowerCase()}.` };
  if (worse('threats') || worse('blunders')) return { skill: 'safety', reason: 'More pieces and threats are being missed lately.' };
  return null;
}
