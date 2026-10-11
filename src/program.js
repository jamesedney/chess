// The planner: turns your goal, skill map and curriculum into today's session,
// a short list of blocks that fills the time you have. Pure functions of the
// saved state; src/session.js runs the result.
import { UNITS, BANDS, OBJECTIVES } from '../data/curriculum.js';
import { chooseUnit, currentBand, unitStatus, refresher, drillDone } from './curriculum.js';
import { skillMap, leaks } from './skills.js';
import { isDue } from './srs.js';
import { dateKey } from './state.js';
import { needsDebrief, pickMoments } from './debrief.js';
import { nextReplay } from './replay.js';
import { dueCards } from './repertoire.js';
import { focus } from './evidence.js';
import { CLOCK_DRILLS } from './timeprofile.js';

const DAY = 86400000;

/** The newest reviewed game whose saved positions have not been attempted. */
export function undrilledGame(state, now = Date.now()) {
  for (const r of state.reviews) {
    if (!r.complete || (r.created || 0) < now - 3 * DAY) continue;
    const open = r.marks
      .filter(m => m.mistakeId && !m.cleared)
      .map(m => m.mistakeId)
      .filter(id => {
        const m = state.mistakes.find(x => x.id === id);
        return m && !m.archived && !(state.records[id]?.tries > 0);
      });
    if (open.length) return { review: r, open: open.length };
  }
  return null;
}

/** The newest game from the last three days still waiting for its debrief. */
export function gameToDebrief(state, now = Date.now()) {
  return state.reviews.find(r => (r.created || 0) >= now - 3 * DAY && needsDebrief(r)) || null;
}

/** Puzzle tags that train a skill around the current band. */
export function tagsForSkill(state, skill) {
  const band = BANDS.indexOf(currentBand(state));
  const near = UNITS.filter(u => u.skill === skill && Math.abs(BANDS.findIndex(b => b.id === u.band) - band) <= 1);
  return [...new Set((near.length ? near : UNITS.filter(u => u.skill === skill)).flatMap(u => u.tags))];
}

const drillLabel = d =>
  d.type === 'endgame'
    ? 'Endgame drill'
    : { vision: 'Vision sprint', visual: 'Visualisation drill', checks: 'Find every check', assess: 'Assess the position' }[d.type];

/**
 * Today's session. ctx: { now, puzzles, goalStatus, target } where target is
 * the rating the skill map measures against. Returns { date, minutes, unit,
 * focus, blocks: [{ id, type, title, detail, est, params }] }.
 */
export function planSession(state, { now = Date.now(), puzzles = [], goalStatus = null, target = null } = {}) {
  const minutes = state.minutes || state.target?.minutes || 20;
  const map = skillMap(state, target || state.target?.target || state.puzzle.rating + 200, now);
  const order = map.map(s => s.id);
  const unit = chooseUnit(state, order);
  const lk = leaks(state, now);
  const refresh = refresher(lk);
  // What your debriefs, clock and recent results say to push on.
  const push = focus(state, now);
  const blocks = [];
  const add = b => blocks.push(b);

  // 1. Warm up the eyes.
  add({
    id: 'warmup',
    type: 'sprint',
    title: 'Warm-up: vision sprint',
    detail: 'One minute: capture the free piece.',
    est: 2,
    params: { mode: 'vision' },
    optional: true,
  });

  // 2. Your latest game first, while it is fresh: a debrief of the moments that
  // decided it, or, for a game already debriefed, its saved positions.
  const fresh = gameToDebrief(state, now);
  const game = fresh ? null : undrilledGame(state, now);
  if (fresh) {
    const opp = fresh.colour === 'w' ? fresh.black : fresh.white;
    const n = pickMoments(fresh).length;
    add({
      id: 'debrief',
      type: 'debrief',
      title: `Debrief: your game against ${opp}`,
      detail: `${n === 1 ? 'The moment' : `The ${n} moments`} that decided it: find the better move, then say what went wrong.`,
      est: Math.min(6, 1 + n * 1.5),
      params: { review: fresh.id, debrief: 1 },
    });
  }
  if (game) {
    const opp = game.review.colour === 'w' ? game.review.black : game.review.white;
    add({
      id: 'review',
      type: 'review',
      title: `Your game against ${opp}`,
      detail: `Find the better move in ${game.open === 1 ? 'the position' : `the ${game.open} positions`} where you went wrong.`,
      est: Math.min(6, game.open * 1.2),
      params: { mode: 'mistakes', review: game.review.id, limit: game.open },
      count: game.open,
    });
  }

  // 3. Spaced recall.
  const due = puzzles.filter(p => !p.archived && isDue(state.records[p.id], now)).length;
  if (due) {
    const n = Math.min(due, 6);
    add({
      id: 'recall',
      type: 'recall',
      title: `Recall: ${n} position${n === 1 ? '' : 's'} due`,
      detail: 'Solve them again before they fade.',
      est: n * 0.8,
      params: { mode: 'daily', due: 1, limit: n },
      count: n,
      optional: true,
    });
  }

  // 4–6. The current unit: lesson, puzzles, drill.
  if (unit) {
    const st = unitStatus(state, unit);
    if (unit.lesson && !st.lessonDone)
      add({ id: 'lesson', type: 'lesson', title: `Lesson: ${unit.title}`, detail: unit.concept, est: 5, params: { lesson: unit.lesson } });
    const rating = state.skills?.[unit.skill]?.rating || state.puzzle.rating;
    const n = goalStatus === 'behind' ? 10 : 8;
    add({
      id: 'unit',
      type: 'puzzles',
      title: `${unit.title}: ${n} puzzles`,
      detail: unit.concept,
      est: n,
      params: { mode: 'daily', tags: unit.tags, strict: 1, limit: n, unit: unit.id, rating },
      count: n,
    });
    if (unit.drill && !drillDone(state, unit.drill))
      add({
        id: 'drill',
        type: 'drill',
        title: drillLabel(unit.drill),
        detail: `Part of mastering ${unit.title.toLowerCase()}.`,
        est: unit.drill.type === 'endgame' ? 4 : 3,
        params:
          unit.drill.type === 'endgame'
            ? { drill: 'endgames', id: unit.drill.id }
            : unit.drill.type === 'vision'
              ? { mode: 'vision' }
              : { drill: unit.drill.type === 'visual' ? 'visualise' : unit.drill.type },
        drill: unit.drill,
        optional: true,
      });
  }

  // 7. Your clock habit, when it is the problem: the drill that trains it.
  if (push?.drill) {
    const d = push.drill;
    const n = d === 'pause' ? 6 : 10;
    const own = state.mistakes.filter(m => !m.archived).length >= 3;
    add({
      id: 'clock',
      type: 'clock',
      title: `${CLOCK_DRILLS[d].title}: ${n} positions`,
      detail: `${push.reason} ${CLOCK_DRILLS[d].detail}`,
      est: d === 'pause' ? 4 : 3,
      params: { mode: d === 'pause' && own ? 'mistakes' : 'daily', clock: d, limit: n },
      count: n,
    });
  }

  // 8. The weakest other skill: the one your debriefs point at, a refresher if
  // your games keep leaking it, or the furthest behind.
  const weak =
    push?.skill && push.skill !== unit?.skill
      ? push.skill
      : refresh && refresh.skill !== unit?.skill
        ? refresh.skill
        : order.find(s => s !== unit?.skill);
  if (weak) {
    const n = goalStatus === 'behind' ? 6 : 4;
    const rating = state.skills?.[weak]?.rating || state.puzzle.rating;
    add({
      id: 'weak',
      type: 'puzzles',
      title:
        refresh && refresh.skill === weak
          ? `Refresher: ${refresh.title.toLowerCase()}`
          : `${map.find(s => s.id === weak).label}: ${n} puzzles`,
      detail:
        push?.skill === weak
          ? push.reason
          : refresh && refresh.skill === weak
            ? 'Your recent games show this coming back.'
            : 'Your weakest skill after today’s unit.',
      est: n,
      params: {
        mode: 'daily',
        tags: refresh && refresh.skill === weak ? refresh.tags : tagsForSkill(state, weak),
        strict: 1,
        limit: n,
        rating,
      },
      count: n,
      optional: true,
    });
  }

  // 9. Play it again: one position from your games where a win slipped away
  // or a draw was there; first in line when conversions are slipping.
  const replay = nextReplay(state);
  if (replay)
    add({
      id: 'replay',
      type: 'replay',
      title: replay.goal === 'convert' ? 'Play it again: convert the win' : 'Play it again: hold the position',
      detail: `From your game against ${replay.opponent}, before ${replay.played}.`,
      est: 6,
      params: { replay: replay.id },
      optional: !push?.replay,
    });

  // 10. Your repertoire: the opening positions due for recall.
  const repDue = dueCards(state, now).length;
  if (repDue >= 3) {
    const n = Math.min(repDue, 6);
    add({
      id: 'repertoire',
      type: 'repertoire',
      title: `Your repertoire: ${n} positions`,
      detail: 'Your moves in the openings you play, and the better ones where you lost ground.',
      est: 3,
      params: { drill: 'repertoire', limit: n },
      count: n,
      optional: true,
    });
  }

  // 11. Play: apply it in a game with one objective. A game is part of the
  // session when you have not played one (here or online) for two days.
  const recentGame =
    state.games.some(g => g.d >= dateKey(new Date(now - 2 * DAY))) || state.reviews.some(r => (r.created || 0) >= now - 2 * DAY);
  const focusSkill = unit?.skill || weak || 'safety';
  add({
    id: 'game',
    type: 'game',
    title: 'Play a game',
    detail: `Objective: ${OBJECTIVES[focusSkill]}`,
    est: 15,
    params: { objective: OBJECTIVES[focusSkill] },
    optional: minutes < 20 || (recentGame && goalStatus !== 'behind'),
  });

  // Fit the time: required blocks always; optional ones while time allows.
  let used = blocks.filter(b => !b.optional).reduce((a, b) => a + b.est, 0);
  const fitted = blocks.filter(b => {
    if (!b.optional) return true;
    if (used + b.est > minutes * 1.15) return false;
    used += b.est;
    return true;
  });
  return {
    date: dateKey(new Date(now)),
    minutes,
    unit: unit?.id || null,
    focus: order.slice(0, 2),
    blocks: fitted.map(b => ({ ...b, status: 'todo' })),
  };
}

/** Counters a block's completion is measured against, taken when it starts. */
export function baseline(state) {
  return {
    log: state.log.length,
    games: state.games.length,
    vision: state.vision.runs,
    visual: state.calc.visual.runs,
    checks: state.calc.checks.runs,
    assess: state.calc.assess.runs,
    replays: Object.values(state.replays || {}).reduce((a, r) => a + r.tries, 0),
    endgames: Object.fromEntries(Object.entries(state.endgames).map(([k, v]) => [k, v.tries])),
  };
}

/** Whether a started block has been done. */
export function blockDone(state, block) {
  const base = block.base;
  if (!base) return false;
  const since = state.log.slice(base.log);
  switch (block.type) {
    case 'sprint':
      return state.vision.runs > base.vision;
    case 'review':
      return since.filter(e => e.k === 'm').length >= (block.count || 1);
    case 'recall':
    case 'puzzles':
      return since.filter(e => e.k === 'p' || e.k === 'm').length >= (block.count || 1);
    case 'lesson':
      return !!state.lessons[block.params.lesson]?.done;
    case 'drill': {
      const d = block.drill;
      if (d.type === 'endgame') return (state.endgames[d.id]?.tries || 0) > (base.endgames[d.id] || 0);
      if (d.type === 'vision') return state.vision.runs > base.vision;
      return state.calc[d.type].runs > base[d.type];
    }
    case 'game':
      return state.games.length > base.games;
    case 'debrief':
      return !!state.reviews.find(r => r.id === block.params.review)?.debriefed;
    case 'clock':
      return since.filter(e => e.k === 'p' && e.t === block.params.clock).length >= (block.count || 1);
    case 'replay':
      return Object.values(state.replays || {}).reduce((a, r) => a + r.tries, 0) > (base.replays || 0);
    case 'repertoire':
      return since.filter(e => e.k === 'o').length >= (block.count || 1);
    default:
      return false;
  }
}
