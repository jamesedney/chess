// Is it working? Your recent games against the weeks before, per measure, with
// what you trained in each window, and the one problem the planner should push
// hardest on next. Pure functions of the state.
import { timeSummary, moveTime } from './clocks.js';
import { outcome } from './openings.js';
import { dateKey } from './state.js';
import { habits } from './debrief.js';
import { timeProfile } from './timeprofile.js';
import { WINNING } from './replay.js';
import { mainControl, rowsBetween, score, longestRun } from './ledger.js';
import { annotate } from './tilt.js';
import { streakMode, diagnoseStreak, classifyLoss, reviewFor } from './leak.js';

const DAY = 86400000;
export const RECENT_DAYS = 14;
export const BEFORE_DAYS = 42;
/** Games (reviewed, clocked, on the ledger, after a loss, classified losses) in each window before a verdict speaks. */
export const MIN_GAMES = 3;
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
    fast: marks.filter(m => m.cls === 'blunder' && moveTime(r, m.ply)?.rushed).length,
    clock: !!r.clocks,
    winning,
  };
}

/**
 * What the ledger says about one window, read once for both: the main
 * control (rated rows only when the sync is), the rows started straight after
 * a loss, and the losses classified against the current leak.
 */
function ledgerFacts(state, now) {
  const ledger = state.ledger || [];
  const control = mainControl(ledger, { now });
  const ratedOnly = !!state.sync?.ratedOnly;
  const leak = diagnoseStreak(state, { now }).leak;
  const rows = annotate(ledger);
  const losses = rows
    .filter(r => r.r === 0 && (!control || r.tc === control))
    .map(row => ({ t: row.t, ...classifyLoss(reviewFor(state, row), row, state) }));
  return {
    rows,
    main: rows.filter(r => r.tc === control && (!ratedOnly || r.rated)),
    quick: rows.filter(r => r.quick),
    leak,
    losses: losses.filter(l => l.chess || l.tilt).map(l => ({ t: l.t, hit: leak === 'tilt' ? l.tilt : !!leak && l.chess === leak })),
  };
}

function windowStats(state, games, lf, from, to) {
  const list = games.filter(g => g.at >= from && g.at < to).map(g => g.facts);
  const n = list.length;
  const avg = key => (n ? list.reduce((a, f) => a + (f[key] ?? 0), 0) / n : null);
  const clocked = list.filter(f => f.clock);
  const clockAvg = key => (clocked.length ? clocked.reduce((a, f) => a + f[key], 0) / clocked.length : null);
  const winning = list.filter(f => f.winning && f.score !== null);
  const d0 = dateKey(new Date(from));
  const d1 = dateKey(new Date(to));
  const log = state.log.filter(e => e.d >= d0 && e.d < d1);
  const inWindow = rows => rowsBetween(rows, from, to);
  const main = inWindow(lf.main);
  const rows = inWindow(lf.rows);
  const quick = inWindow(lf.quick);
  const losses = inWindow(lf.losses);
  return {
    games: n,
    score: n ? list.reduce((a, f) => a + (f.score ?? 0.5), 0) / n : null,
    blunders: avg('blunders'),
    threats: avg('threats'),
    rushed: clockAvg('rushed'),
    fast: clockAvg('fast'),
    clockGames: clocked.length,
    convert: winning.length >= 2 ? winning.filter(f => f.score === 1).length / winning.length : null,
    winningGames: winning.length,
    ledgerScore: score(main),
    afterLoss: score(quick),
    run: rows.length ? longestRun(rows) : null,
    leak: lf.leak && losses.length ? losses.filter(l => l.hit).length / losses.length : null,
    ledger: { rows: rows.length, main: main.length, quick: quick.length, losses: losses.length },
    training: {
      puzzles: log.filter(e => e.k === 'p').length,
      ownMistakes: log.filter(e => e.k === 'm').length,
      debriefs: log.filter(e => e.k === 'b').length,
      replays: log.filter(e => e.k === 'r').length,
      repertoire: log.filter(e => e.k === 'o').length,
      clock: log.filter(e => e.k === 'p' && (e.t === 'pace' || e.t === 'pause')).length,
      safe: log.filter(e => e.k === 'p' && e.t === 'safe').length,
      real: log.filter(e => e.k === 'p' && e.t === 'real').length,
    },
  };
}

/**
 * The measures, in the order the pages show them. `needs(w)` is the minimum a
 * window must hold before the row's verdict speaks; `score` reads the ledger
 * when both windows hold three rows of the main control, else the reviews.
 */
export const MEASURES = [
  { id: 'blunders', label: 'Blunders per game', lower: true, step: 0.2, needs: w => w.games >= MIN_GAMES },
  { id: 'threats', label: 'Missed threats per game', lower: true, step: 0.2, needs: w => w.games >= MIN_GAMES },
  { id: 'rushed', label: 'Critical moves played in a hurry, per game', lower: true, step: 0.2, needs: w => w.clockGames >= MIN_GAMES },
  {
    id: 'convert',
    label: 'Winning positions converted',
    lower: false,
    step: 0.15,
    percent: true,
    needs: w => w.games >= MIN_GAMES && w.winningGames >= 2,
  },
  { id: 'score', label: 'Score', lower: false, step: 0.1, percent: true, needs: w => w.games >= MIN_GAMES },
  {
    id: 'afterLoss',
    label: 'Score straight after a loss',
    lower: false,
    step: 0.15,
    percent: true,
    needs: w => w.ledger.quick >= MIN_GAMES,
  },
  { id: 'run', label: 'Longest loss run', lower: true, step: 1, needs: w => w.ledger.rows >= MIN_GAMES },
  {
    id: 'leak',
    label: 'Losses that began with the leak',
    lower: true,
    step: 0.15,
    percent: true,
    needs: w => w.ledger.losses >= MIN_GAMES,
  },
  { id: 'fast', label: 'Blunders played in under 4 seconds, per game', lower: true, step: 0.2, needs: w => w.clockGames >= MIN_GAMES },
];

const fmt = (v, percent) => (v === null ? '–' : percent ? `${Math.round(v * 100)}%` : v.toFixed(1));

/**
 * The last two weeks against the six before them. Each row: { id, label, now,
 * before, verdict: better | worse | steady | unknown, text }. Verdicts need
 * each window to hold the row's minimum (three games as a rule), and a change
 * bigger than `step` and 20%. `scoreSource` says where the score row reads.
 */
export function evidence(state, now = Date.now()) {
  const games = state.reviews.filter(r => r.complete).map(r => ({ at: r.created || 0, facts: gameFacts(state, r) }));
  const lf = ledgerFacts(state, now);
  const recent = windowStats(state, games, lf, now - RECENT_DAYS * DAY, now + DAY);
  const before = windowStats(state, games, lf, now - (RECENT_DAYS + BEFORE_DAYS) * DAY, now - RECENT_DAYS * DAY);
  const scoreSource = recent.ledger.main >= MIN_GAMES && before.ledger.main >= MIN_GAMES ? 'ledger' : 'reviews';
  const rows = MEASURES.map(m => {
    const fromLedger = m.id === 'score' && scoreSource === 'ledger';
    const key = fromLedger ? 'ledgerScore' : m.id;
    const a = recent[key];
    const b = before[key];
    const enough = a !== null && b !== null && (fromLedger || (m.needs(recent) && m.needs(before)));
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
  return { recent, before, rows, headline, scoreSource, leak: lf.leak };
}

/** One line for Today: the clearest change, or what is needed for one. */
export function headlineText(ev) {
  const h = ev.headline;
  if (!h) return ev.rows.every(r => r.verdict === 'unknown') ? null : 'Your recent games look like the weeks before: steady.';
  const name = h.label.replace(/ per game$/, '').toLowerCase();
  return `${h.verdict === 'better' ? 'Working' : 'Slipping'}: ${name} ${h.text.replace(/\.$/, '')} over the last two weeks.`;
}

/**
 * The one problem to push on: in a losing streak the leak that started your
 * losses, else your debrief notes, clock habits and the evidence:
 * { skill?, drill?, replay?, reason }. Null when nothing stands out.
 */
export function focus(state, now = Date.now()) {
  if (streakMode(state, now)) {
    const d = diagnoseStreak(state, { now });
    const reason = d.line;
    if (d.leak === 'rushed' || d.leak === 'safety') return { drill: 'pause', skill: 'safety', reason };
    if (d.leak === 'clock') return { drill: 'pace', reason };
    if (d.leak === 'convert') return { replay: true, reason };
    if (d.leak === 'opening') return { skill: 'openings', reason };
    if (d.leak === 'calc') return { skill: 'calculation', reason };
    // A tilt leak, or none yet: the usual rules.
  }
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
