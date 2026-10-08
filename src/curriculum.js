// Progress through the curriculum: mastery gates, placement, the current unit
// and refreshers when your games show an old weakness coming back.
import { BANDS, UNITS } from '../data/curriculum.js';

export { BANDS, UNITS };

export const unitById = id => UNITS.find(u => u.id === id) || null;
export const bandById = id => BANDS.find(b => b.id === id) || null;
export const unitsIn = bandId => UNITS.filter(u => u.band === bandId);
const RECENT = 10;

/** The band a rating sits in. */
export function bandForRating(rating) {
  return BANDS.find(b => rating < b.ceiling) || BANDS.at(-1);
}

export function emptyCurriculum() {
  return { units: {}, current: null, placed: false };
}

function progressOf(state, id) {
  return state.curriculum.units[id] || { tries: 0, clean: 0, recent: [], done: false, placed: false };
}

/** Whether a unit's drill requirement is met. */
export function drillDone(state, drill) {
  if (!drill) return true;
  switch (drill.type) {
    case 'endgame':
      return (state.endgames[drill.id]?.wins || 0) > 0;
    case 'vision':
      return state.vision.best >= drill.score;
    case 'visual':
      return state.calc.visual.best >= drill.score;
    case 'checks':
      return state.calc.checks.best >= drill.score;
    case 'assess':
      return state.calc.assess.runs >= drill.runs;
    default:
      return true;
  }
}

/** Everything about one unit's progress, for the path view and the planner. */
export function unitStatus(state, unit) {
  const p = progressOf(state, unit.id);
  const accuracy = p.recent.length ? p.recent.reduce((a, b) => a + b, 0) / p.recent.length : 0;
  const lessonDone = !unit.lesson || !!state.lessons[unit.lesson]?.done;
  const drillOk = drillDone(state, unit.drill);
  const puzzlesOk = p.clean >= unit.gate.puzzles && accuracy >= unit.gate.accuracy;
  return {
    ...p,
    accuracy,
    lessonDone,
    drillOk,
    puzzlesOk,
    done: p.done,
    progress: p.done
      ? 1
      : (Math.min(1, p.clean / unit.gate.puzzles) + (unit.lesson ? (lessonDone ? 1 : 0) : 0) + (unit.drill ? (drillOk ? 1 : 0) : 0)) /
        (1 + (unit.lesson ? 1 : 0) + (unit.drill ? 1 : 0)),
  };
}

function setProgress(state, id, patch) {
  state.curriculum.units[id] = { ...progressOf(state, id), ...patch };
}

/**
 * Mark units whose gates are now met as mastered. Call after anything that
 * could complete one: a puzzle, a lesson, a drill. Returns the units mastered.
 */
export function refreshMastery(state, date) {
  const mastered = [];
  for (const unit of UNITS) {
    const st = unitStatus(state, unit);
    if (st.done) continue;
    if (st.puzzlesOk && st.lessonDone && st.drillOk) {
      setProgress(state, unit.id, { done: true, at: date });
      mastered.push(unit);
    }
  }
  if (mastered.some(u => u.id === state.curriculum.current)) state.curriculum.current = null;
  return mastered;
}

/** Credit a puzzle attempt to every open unit it trains. Returns units mastered by it. */
export function recordUnitPuzzle(state, tags, clean, date) {
  const band = currentBand(state);
  const limit = BANDS.indexOf(band) + 1;
  for (const unit of UNITS) {
    if (BANDS.findIndex(b => b.id === unit.band) > limit) continue;
    if (!unit.tags.some(t => tags.includes(t))) continue;
    const p = progressOf(state, unit.id);
    if (p.done) continue;
    setProgress(state, unit.id, {
      tries: p.tries + 1,
      clean: p.clean + (clean ? 1 : 0),
      recent: [...p.recent, clean ? 1 : 0].slice(-RECENT),
    });
  }
  return refreshMastery(state, date);
}

/**
 * Placement: units in bands well below your rating count as known, so you
 * start where you are. They come back as refreshers if your games say so.
 */
export function place(state, rating, date) {
  for (const unit of UNITS) {
    const band = bandById(unit.band);
    if (band.ceiling <= rating - 100 && !progressOf(state, unit.id).done)
      setProgress(state, unit.id, { done: true, placed: true, at: date });
  }
  state.curriculum.placed = true;
}

/** The first band with unfinished units. */
export function currentBand(state) {
  return BANDS.find(b => unitsIn(b.id).some(u => !progressOf(state, u.id).done)) || BANDS.at(-1);
}

/**
 * The unit to work on: the current one until it is mastered, then the open
 * unit in the current band whose skill is furthest behind. skillOrder lists
 * skill ids from weakest to strongest.
 */
export function chooseUnit(state, skillOrder = []) {
  const keep = unitById(state.curriculum.current);
  if (keep && !progressOf(state, keep.id).done) return keep;
  const band = currentBand(state);
  const open = unitsIn(band.id).filter(u => !progressOf(state, u.id).done);
  if (!open.length) return null;
  const rank = u => {
    const i = skillOrder.indexOf(u.skill);
    return i < 0 ? skillOrder.length : i;
  };
  const pick = [...open].sort((a, b) => rank(a) - rank(b) || UNITS.indexOf(a) - UNITS.indexOf(b))[0];
  state.curriculum.current = pick.id;
  return pick;
}

/**
 * A refresher when real games keep showing a weakness: the earliest unit for
 * the leakiest skill, if it leaks at least `threshold` serious mistakes a game
 * over at least three games.
 */
export function refresher(leakReport, threshold = 0.6) {
  if (leakReport.games < 3) return null;
  const worst = Object.entries(leakReport.perGame).sort((a, b) => b[1] - a[1])[0];
  if (!worst || worst[1] < threshold) return null;
  return UNITS.find(u => u.skill === worst[0]) || null;
}

/** Counts for the path header: mastered units overall and in the current band. */
export function pathSummary(state) {
  const band = currentBand(state);
  const inBand = unitsIn(band.id);
  return {
    band,
    bandDone: inBand.filter(u => progressOf(state, u.id).done).length,
    bandTotal: inBand.length,
    done: UNITS.filter(u => progressOf(state, u.id).done).length,
    total: UNITS.length,
  };
}
