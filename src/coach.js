// The coach: what your own games say you should work on, a weekly plan built
// from it, and an honest comparison of this month with the last.
// Pure functions of the saved state, so every rule here is unit tested.
import { KINDS, KIND_IDS, phaseOf } from './mistake-kinds.js';
import { timeSummary } from './clocks.js';
import { dateKey } from './state.js';
import { THEMES } from './themes.js';
import { calibration } from './assess.js';

const DAY = 86400000;
export const WINDOW_DAYS = 90;

/** Mistakes a deeper engine check found were not mistakes after all. */
function clearedIds(reviews) {
  const ids = new Set();
  for (const r of reviews) for (const m of r.marks) if (m.cleared && m.mistakeId) ids.add(m.mistakeId);
  return ids;
}

/** Your own mistakes from the last `days` days that still stand. */
export function recentMistakes(state, now = Date.now(), days = WINDOW_DAYS) {
  const cleared = clearedIds(state.reviews);
  return state.mistakes.filter(m => !cleared.has(m.id) && (m.created || now) >= now - days * DAY);
}

/**
 * Diagnose recurring weaknesses from saved mistakes and reviewed games.
 * confidence: 'none' (too little data to say anything), 'early' (a first
 * read that may change), or 'solid'.
 */
export function diagnose(state, now = Date.now()) {
  const mistakes = recentMistakes(state, now);
  const reviews = state.reviews.filter(r => r.complete && (r.created || now) >= now - WINDOW_DAYS * DAY);
  const counts = Object.fromEntries(KIND_IDS.map(k => [k, 0]));
  const phases = { opening: 0, middlegame: 0, endgame: 0 };
  for (const m of mistakes) {
    counts[m.kind && counts[m.kind] !== undefined ? m.kind : 'positional']++;
    phases[phaseOf(m.fen)]++;
  }
  const total = mistakes.length;
  const kinds = KIND_IDS.map(k => ({ kind: k, label: KINDS[k].label, count: counts[k], share: total ? counts[k] / total : 0 }))
    .filter(k => k.count)
    .sort((a, b) => b.count - a.count || KIND_IDS.indexOf(a.kind) - KIND_IDS.indexOf(b.kind));
  const blunders = reviews.reduce((n, r) => n + r.marks.filter(m => m.cls === 'blunder' && !m.cleared).length, 0);
  const time = reviews.reduce(
    (t, r) => {
      const s = timeSummary(r);
      return { known: t.known + s.known, rushed: t.rushed + s.rushed, trouble: t.trouble + s.trouble };
    },
    { known: 0, rushed: 0, trouble: 0 },
  );
  const confidence = total < 3 && reviews.length < 2 ? 'none' : total < 10 || reviews.length < 3 ? 'early' : 'solid';
  const focus = kinds[0]?.kind || null;
  const timeIssue =
    time.known >= 3 && time.rushed / time.known >= 0.4 ? 'rushed' : time.known >= 3 && time.trouble / time.known >= 0.4 ? 'trouble' : null;
  const weakPhase = total >= 5 ? Object.entries(phases).sort((a, b) => b[1] - a[1])[0] : null;
  const findings = [];
  // Judgement: candidate-move discipline and position assessment, from the drills.
  const cand = state.candidates || { asked: 0, hit: 0 };
  const candRate = cand.asked >= 10 ? cand.hit / cand.asked : null;
  const cal = calibration(state.calc?.assess?.last || []);
  const judgement = (candRate !== null && candRate < 0.5) || cal.verdict === 'optimistic' || cal.verdict === 'pessimistic';
  if (candRate !== null)
    findings.push(
      `The engine's best move was among your candidate moves ${Math.round(candRate * 100)}% of the time (${cand.asked} checks).`,
    );
  if (cal.verdict === 'optimistic' || cal.verdict === 'pessimistic') findings.push(cal.text);
  if (confidence !== 'none') {
    if (kinds[0])
      findings.push(`Your most common error is: ${kinds[0].label.toLowerCase()} (${kinds[0].count} of ${total} saved mistakes).`);
    if (reviews.length) findings.push(`${(blunders / reviews.length).toFixed(1)} blunders per reviewed game.`);
    if (timeIssue === 'rushed')
      findings.push(
        `${time.rushed} of ${time.known} serious mistakes with clock data were played in a hurry. Slow down at critical moments.`,
      );
    if (timeIssue === 'trouble')
      findings.push(
        `${time.trouble} of ${time.known} serious mistakes came when you were short of time. Spend less time early in the game.`,
      );
    if (weakPhase && weakPhase[1] / total >= 0.4)
      findings.push(`${Math.round((weakPhase[1] / total) * 100)}% of your mistakes happen in the ${weakPhase[0]}.`);
  }
  return {
    confidence,
    mistakes: total,
    games: reviews.length,
    kinds,
    phases,
    blundersPerGame: reviews.length ? blunders / reviews.length : null,
    time,
    timeIssue,
    focus,
    weakPhase: weakPhase && weakPhase[1] / total >= 0.4 ? weakPhase[0] : null,
    judgement,
    candidateRate: candRate,
    calibration: cal,
    findings,
  };
}

// ---------- Weekly plan ----------

/** The Monday that starts the week containing `date`, as YYYY-MM-DD. */
export function weekStart(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dateKey(d);
}

/** The weakest training theme by puzzle rating, if there is enough data. */
function weakTheme(state) {
  const tried = THEMES.filter(t => state.themes[t]?.count >= 3);
  return tried.sort((a, b) => state.themes[a].rating - state.themes[b].rating)[0] || null;
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const scaled = (base, level) => Math.max(1, Math.round(base * level));

/**
 * Build a plan for the week. `level` scales the targets: it rises after a
 * completed week and falls after a week that went mostly undone, so the plan
 * stays achievable.
 */
export function buildPlan(state, diagnosis, week, level = 1) {
  const focusTheme = diagnosis.focus ? KINDS[diagnosis.focus].theme : weakTheme(state) || 'Tactics';
  /** @typedef {{ id: string, label: string, detail?: string, metric: string, theme?: string, target: number, action: { page: string, params?: Record<string, string> } }} PlanItem */
  /** @type {PlanItem[]} */
  const items = [
    {
      id: 'days',
      label: `Train on ${clamp(scaled(4, level), 3, 7)} days`,
      metric: 'days',
      target: clamp(scaled(4, level), 3, 7),
      action: { page: 'train' },
    },
    {
      id: 'focus',
      label: `Solve ${scaled(12, level)} ${focusTheme.toLowerCase()} puzzles without help`,
      detail: diagnosis.focus
        ? `Chosen because your games show: ${KINDS[diagnosis.focus].label.toLowerCase()}.`
        : 'Your weakest puzzle theme so far.',
      metric: 'theme',
      theme: focusTheme,
      target: scaled(12, level),
      action: { page: 'train', params: { mode: 'daily', theme: focusTheme } },
    },
  ];
  const active = state.mistakes.filter(m => !m.archived).length;
  if (active)
    items.push({
      id: 'mistakes',
      label: `Re-solve ${Math.min(active, scaled(5, level))} of your own mistakes`,
      metric: 'mistakes',
      target: Math.min(active, scaled(5, level)),
      action: { page: 'train', params: { mode: 'mistakes' } },
    });
  items.push({
    id: 'review',
    label: `Review ${scaled(2, level)} of your games`,
    detail: 'New games keep this plan honest.',
    metric: 'reviews',
    target: scaled(2, level),
    action: { page: 'review' },
  });
  /** @type {PlanItem} */
  const drill =
    diagnosis.focus === 'positional' || diagnosis.judgement
      ? {
          id: 'drill',
          label: `Do ${scaled(2, level)} assess-the-position runs`,
          metric: 'assess',
          target: scaled(2, level),
          action: { page: 'drills', params: { drill: 'assess' } },
        }
      : diagnosis.weakPhase === 'endgame'
        ? {
            id: 'drill',
            label: `Win ${scaled(2, level)} endgame drills`,
            metric: 'endgames',
            target: scaled(2, level),
            action: { page: 'drills', params: { drill: 'endgames' } },
          }
        : diagnosis.focus === 'hung-piece'
          ? {
              id: 'drill',
              label: `Run ${scaled(3, level)} vision sprints`,
              metric: 'vision',
              target: scaled(3, level),
              action: { page: 'train', params: { mode: 'vision' } },
            }
          : diagnosis.focus === 'allowed-mate' || diagnosis.focus === 'missed-mate'
            ? {
                id: 'drill',
                label: `Do ${scaled(2, level)} find-every-check runs`,
                metric: 'checks',
                target: scaled(2, level),
                action: { page: 'drills', params: { drill: 'checks' } },
              }
            : {
                id: 'drill',
                label: `Do ${scaled(2, level)} visualisation runs`,
                metric: 'visual',
                target: scaled(2, level),
                action: { page: 'drills', params: { drill: 'visualise' } },
              };
  items.push(drill);
  return { week, level, focus: diagnosis.focus, items };
}

/** How far each item has got this week, from the attempt log and reviews. */
export function planProgress(state, plan) {
  const since = plan.week;
  const sinceMs = new Date(since + 'T00:00:00').getTime();
  const log = state.log.filter(e => e.d >= since);
  const count = fn => log.filter(fn).length;
  const days = new Set([
    ...log.map(e => e.d),
    ...Object.entries(state.days)
      .filter(([d, v]) => d >= since && (v.attempts || 0) + (v.vision || 0) > 0)
      .map(([d]) => d),
  ]).size;
  const value = item => {
    switch (item.metric) {
      case 'days':
        return days;
      case 'theme':
        return count(e => e.k === 'p' && e.t === item.theme && e.c);
      case 'mistakes':
        return count(e => e.k === 'm' && e.c);
      case 'reviews':
        return state.reviews.filter(r => r.complete && (r.created || 0) >= sinceMs).length;
      case 'endgames':
        return count(e => e.k === 'e' && e.c);
      case 'vision':
        return count(e => e.k === 'v');
      case 'checks':
        return count(e => e.k === 'c' && e.t === 'checks');
      case 'visual':
        return count(e => e.k === 'c' && e.t === 'visual');
      case 'assess':
        return count(e => e.k === 'c' && e.t === 'assess');
      default:
        return 0;
    }
  };
  const items = plan.items.map(it => {
    const done = Math.min(value(it), it.target);
    return { ...it, done, complete: done >= it.target };
  });
  const ratio = items.reduce((a, it) => a + it.done / it.target, 0) / items.length;
  return { items, ratio };
}

/**
 * Make sure the state holds this week's plan. A new week records how the last
 * one went and adapts the targets. Returns true when the plan changed.
 */
export function ensurePlan(state, now = new Date()) {
  const week = weekStart(now);
  if (state.plan?.week === week) return false;
  let level = state.plan?.level || 1;
  const history = state.plan?.history || [];
  if (state.plan) {
    const { ratio } = planProgress(state, state.plan);
    history.push({ week: state.plan.week, ratio: Math.round(ratio * 100) / 100 });
    level = clamp(ratio >= 1 ? level * 1.2 : ratio < 0.5 ? level * 0.8 : level, 0.5, 2);
  }
  state.plan = { ...buildPlan(state, diagnose(state, now.getTime()), week, level), history: history.slice(-12) };
  return true;
}

// ---------- Trends ----------

function windowDays(days, from, to) {
  let attempts = 0;
  let clean = 0;
  for (const [d, v] of Object.entries(days)) {
    if (d >= from && d < to) {
      attempts += v.attempts || 0;
      clean += v.clean || 0;
    }
  }
  return { attempts, clean };
}

/** The last value on or before a date in a dated series. */
function valueAt(series, date) {
  let v = null;
  for (const p of series) if (p.date <= date) v = p;
  return v;
}

/**
 * Compare the last 30 days with the 30 before. Each row says plainly whether
 * the change is bigger than normal variation, or that there is too little data.
 */
export function trends(state, now = new Date()) {
  const key = n => dateKey(new Date(now.getTime() - n * DAY));
  const [d0, d30, d60] = [key(-1), key(30), key(60)];
  const rows = [];

  // Puzzle accuracy: a two-proportion comparison, called only when the gap exceeds two standard errors.
  const a = windowDays(state.days, d30, d0);
  const b = windowDays(state.days, d60, d30);
  if (a.attempts >= 20 && b.attempts >= 20) {
    const pa = a.clean / a.attempts;
    const pb = b.clean / b.attempts;
    const p = (a.clean + b.clean) / (a.attempts + b.attempts);
    const se = Math.sqrt(p * (1 - p) * (1 / a.attempts + 1 / b.attempts)) || 1;
    const diff = pa - pb;
    const verdict = Math.abs(diff) < 2 * se ? 'flat' : diff > 0 ? 'better' : 'worse';
    rows.push({
      id: 'accuracy',
      label: 'Solved without help',
      now: `${Math.round(pa * 100)}%`,
      before: `${Math.round(pb * 100)}%`,
      verdict,
      text:
        verdict === 'flat'
          ? 'About the same. The difference is within normal variation.'
          : verdict === 'better'
            ? 'Clearly higher than the month before.'
            : 'Lower than the month before. Harder puzzles or less focus can both cause this.',
    });
  } else
    rows.push({
      id: 'accuracy',
      label: 'Solved without help',
      verdict: 'unknown',
      text: 'Needs at least 20 positions in each month to compare.',
    });

  // Puzzle rating over each window.
  const hist = state.puzzle.history;
  const r0 = valueAt(hist, d0);
  const r30 = valueAt(hist, d30);
  if (r0 && r30 && r0 !== r30) {
    const change = r0.rating - r30.rating;
    const verdict = Math.abs(change) < 30 ? 'flat' : change > 0 ? 'better' : 'worse';
    rows.push({
      id: 'puzzle',
      label: 'Puzzle rating',
      now: String(r0.rating),
      before: String(r30.rating),
      verdict,
      text:
        (verdict === 'flat' ? 'Steady.' : verdict === 'better' ? `Up ${change} in 30 days.` : `Down ${-change} in 30 days.`) +
        ' Puzzle rating measures training, not playing strength.',
    });
  } else rows.push({ id: 'puzzle', label: 'Puzzle rating', verdict: 'unknown', text: 'Needs rated puzzles across more than 30 days.' });

  // Serious mistakes per reviewed game.
  const per = (from, to) => {
    const games = state.reviews.filter(
      r => r.complete && r.created && dateKey(new Date(r.created)) >= from && dateKey(new Date(r.created)) < to,
    );
    const errors = games.reduce((n, r) => n + r.marks.filter(m => m.cls !== 'inaccuracy' && !m.cleared).length, 0);
    return { games: games.length, rate: games.length ? errors / games.length : 0 };
  };
  const ga = per(d30, d0);
  const gb = per(d60, d30);
  if (ga.games >= 2 && gb.games >= 2) {
    const diff = ga.rate - gb.rate;
    const verdict = Math.abs(diff) < 0.75 ? 'flat' : diff < 0 ? 'better' : 'worse';
    rows.push({
      id: 'errors',
      label: 'Mistakes per game',
      now: ga.rate.toFixed(1),
      before: gb.rate.toFixed(1),
      verdict,
      text:
        verdict === 'flat'
          ? `About the same over ${ga.games + gb.games} reviewed games.`
          : verdict === 'better'
            ? 'Fewer serious mistakes per game. Opponents vary, so keep reviewing to confirm.'
            : 'More serious mistakes per game. Opponents vary, so a few games can swing this.',
    });
  } else
    rows.push({ id: 'errors', label: 'Mistakes per game', verdict: 'unknown', text: 'Needs at least two reviewed games in each month.' });

  // Real rating on the most recently logged platform.
  const platform = state.ratings.at(-1)?.platform;
  const series = state.ratings.filter(r => r.platform === platform).map(r => ({ date: r.date, rating: r.rating }));
  const q0 = valueAt(series, d0);
  const q30 = valueAt(series, d30);
  if (platform && q0 && q30 && q0 !== q30) {
    const change = q0.rating - q30.rating;
    const verdict = Math.abs(change) < 25 ? 'flat' : change > 0 ? 'better' : 'worse';
    rows.push({
      id: 'real',
      label: `${platform} rating`,
      now: String(q0.rating),
      before: String(q30.rating),
      verdict,
      text: verdict === 'flat' ? 'Within normal game-to-game swings.' : `${change > 0 ? 'Up' : 'Down'} ${Math.abs(change)} in 30 days.`,
    });
  } else
    rows.push({
      id: 'real',
      label: 'Real rating',
      verdict: 'unknown',
      text: 'Log your rating on the Progress page at least a month apart to see a trend.',
    });
  return rows;
}
