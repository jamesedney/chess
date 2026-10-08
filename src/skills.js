// The skill model: a rating for each skill in the curriculum, updated from
// every rated puzzle, and corrected by what your real games show. The planner
// trains the skill furthest below where your target rating needs it.
import { SKILLS } from '../data/curriculum.js';
import { updateRating } from './rating.js';
import { phaseOf } from './mistake-kinds.js';

export const SKILL_IDS = Object.keys(SKILLS);

/** Which skills a puzzle tag exercises. */
const TAG_SKILLS = {
  hangingPiece: ['safety'],
  capturingDefender: ['safety', 'tactics'],
  fork: ['tactics'],
  pin: ['tactics'],
  skewer: ['tactics'],
  discoveredAttack: ['tactics'],
  doubleCheck: ['tactics'],
  deflection: ['tactics'],
  attraction: ['tactics'],
  clearance: ['tactics'],
  interference: ['tactics'],
  xRayAttack: ['tactics'],
  trappedPiece: ['tactics'],
  intermezzo: ['calculation'],
  mateIn1: ['mating'],
  mateIn2: ['mating'],
  mateIn3: ['mating', 'calculation'],
  mateIn4: ['mating', 'calculation'],
  mateIn5: ['mating', 'calculation'],
  backRankMate: ['mating'],
  smotheredMate: ['mating'],
  kingsideAttack: ['mating'],
  exposedKing: ['mating'],
  sacrifice: ['tactics', 'mating'],
  long: ['calculation'],
  veryLong: ['calculation'],
  defensiveMove: ['calculation', 'safety'],
  quietMove: ['strategy'],
  zugzwang: ['strategy', 'endgames'],
  advancedPawn: ['strategy'],
  promotion: ['endgames'],
  rookEndgame: ['endgames'],
  pawnEndgame: ['endgames'],
  queenEndgame: ['endgames'],
  bishopEndgame: ['endgames'],
  knightEndgame: ['endgames'],
  endgame: ['endgames'],
  opening: ['openings'],
  attackingF2F7: ['openings'],
};

/** The skills a puzzle trains, from its tags. */
export function skillsOf(tags = []) {
  const out = new Set();
  for (const t of tags) for (const s of TAG_SKILLS[t] || []) out.add(s);
  return [...out];
}

/** Fresh skill ratings seeded at one rating. */
export function seedSkills(rating) {
  return Object.fromEntries(SKILL_IDS.map(s => [s, { rating, count: 0 }]));
}

/** Update every skill a rated puzzle exercises. Mutates and returns `skills`. */
export function recordSkillPuzzle(skills, tags, puzzleRating, clean) {
  for (const s of skillsOf(tags)) {
    const cur = skills[s] || { rating: puzzleRating, count: 0 };
    const u = updateRating(cur.rating, cur.count, puzzleRating, clean ? 1 : 0);
    skills[s] = { rating: u.rating, count: cur.count + 1 };
  }
  return skills;
}

const KIND_SKILL = {
  'hung-piece': 'safety',
  'allowed-mate': 'safety',
  'missed-mate': 'mating',
  'missed-tactic': 'tactics',
  positional: 'strategy',
};
const DAY = 86400000;

/**
 * Leaks: serious mistakes per reviewed game, by skill, over the last games.
 * Endgame and opening mistakes also count against those skills.
 */
export function leaks(state, now = Date.now(), lastGames = 8) {
  const reviews = state.reviews.filter(r => r.complete && (r.created || 0) >= now - 60 * DAY).slice(0, lastGames);
  const out = Object.fromEntries(SKILL_IDS.map(s => [s, 0]));
  if (!reviews.length) return { games: 0, perGame: out };
  const ids = new Set(reviews.flatMap(r => r.marks.filter(m => !m.cleared && m.cls !== 'inaccuracy' && m.mistakeId).map(m => m.mistakeId)));
  for (const m of state.mistakes) {
    if (!ids.has(m.id)) continue;
    out[KIND_SKILL[m.kind] || 'strategy']++;
    const phase = phaseOf(m.fen);
    if (phase === 'endgame') out.endgames++;
    if (phase === 'opening') out.openings += 0.5;
  }
  for (const r of reviews) {
    const unexplained = r.marks.filter(m => !m.cleared && m.cls === 'blunder' && !m.mistakeId).length;
    out.safety += unexplained * 0.5;
  }
  const perGame = Object.fromEntries(SKILL_IDS.map(s => [s, out[s] / reviews.length]));
  return { games: reviews.length, perGame };
}

/**
 * The skill map: for each skill, a rating, how it compares with what the
 * target needs, and a priority for the planner (higher = train sooner).
 * Each serious mistake per game in a skill counts as 120 rating points of gap.
 */
export function skillMap(state, target, now = Date.now()) {
  const base = state.puzzle.rating;
  const lk = leaks(state, now);
  return SKILL_IDS.map(id => {
    const s = state.skills?.[id] || { rating: base, count: 0 };
    const leak = lk.perGame[id] || 0;
    const effective = Math.round(s.rating - leak * 120);
    const gap = target - effective;
    return { id, label: SKILLS[id].label, short: SKILLS[id].short, rating: s.rating, count: s.count, leak, effective, gap };
  }).sort((a, b) => b.gap - a.gap);
}
