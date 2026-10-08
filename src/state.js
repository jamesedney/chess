// Persistent training state: defaults, migrations, validation and storage.
// Pure functions are exported for the unit tests; load/save take a storage
// object so tests can pass a fake.
import { Chess } from '../vendor/chess.js';
import { tryUci } from './chess-utils.js';
import { STAGES } from './themes.js';
import { LEVELS, DEFAULT_LEVEL } from './strength.js';
import { KIND_IDS, kindFromExplanation } from './mistake-kinds.js';
import { BOARD_THEMES, PIECE_SETS, DEFAULT_APPEARANCE } from './appearance.js';
import { DEFAULT_SYNC, CONTROLS } from './sync.js';
import { SKILLS } from '../data/curriculum.js';

export const STORAGE_KEY = 'rankup-v1'; // Kept for continuity; the version lives inside.
export const RECOVERY_PREFIX = 'rankup-recovery-';
export const CURRENT_VERSION = 6;
export const MAX_GAMES = 50;
export const MAX_REVIEWS = 20;
export const MAX_LOG = 4000;

export function defaults() {
  return {
    version: CURRENT_VERSION,
    records: {},
    mistakes: [],
    days: {},
    read: [],
    lessons: {},
    ratings: [],
    goal: 8,
    coach: true,
    strength: DEFAULT_LEVEL,
    difficulty: 0,
    puzzle: { rating: STAGES[0].rating, count: 0, history: [] },
    themes: {},
    reviews: [],
    vision: { best: 0, runs: 0, last: [] },
    profiles: { lichess: '', chesscom: '' },
    // Added in version 3.
    log: [], // one row per finished exercise: { d: date, k: kind, t: theme or drill, c: 1 clean | 0 }
    plan: null, // this week's plan; see plan.js
    endgames: {}, // drill id -> { tries, wins, best }
    calc: { visual: emptyDrillStats(), checks: emptyDrillStats(), assess: emptyDrillStats() },
    settings: { ...DEFAULT_APPEARANCE, sound: true, haptics: true, autoLevel: true, candidates: false },
    // Added in version 4.
    sync: DEFAULT_SYNC(), // automatic import of your online games
    games: [], // finished practice games: { d: date, level, r: 1 win | 0.5 draw | 0 loss }
    // Added in version 5.
    candidates: { asked: 0, hit: 0, last: [] }, // candidate-move checks in practice games: { d, h: 1 | 0 }
    // Added in version 6.
    onboarded: false,
    minutes: 20, // daily training time the planner fills
    target: null, // { perf, start: { rating, date }, target, by, minutes }
    milestones: [], // targets reached: { date, perf, rating, target }
    skills: seedSkills(STAGES[0].rating), // skill id -> { rating, count }
    curriculum: { units: {}, current: null, placed: false },
    session: null, // today's plan; see program.js
  };
}

/** Skill ratings all starting at one rating. */
export function seedSkills(rating) {
  return Object.fromEntries(Object.keys(SKILLS).map(s => [s, { rating, count: 0 }]));
}

const THEME_SKILL = {
  'Board vision': 'safety',
  'King safety': 'mating',
  Tactics: 'tactics',
  Calculation: 'calculation',
  Strategy: 'strategy',
  Endgames: 'endgames',
  'Opening habits': 'openings',
};

export const emptyDrillStats = () => ({ best: 0, runs: 0, last: [] });

/** Exercise kinds in the log. */
export const LOG_KINDS = ['p', 'm', 'e', 'c', 'v']; // puzzle, my mistake, endgame, calculation, vision

const V1_SKILL_TO_LEVEL = { 0: 'beginner', 3: 'novice', 8: 'elo1600', 20: 'full' };

/**
 * Each migration upgrades a state from version `from` to `from + 1`. Every
 * saved state and backup goes through the chain, so old data always has one
 * tested path to the current shape. Never edit a migration once released;
 * add a new one.
 */
export const MIGRATIONS = [
  {
    from: 1,
    run(s) {
      const level = [0, 1, 2, 3].includes(s.level) ? s.level : 0;
      return {
        records: s.records || {},
        mistakes: (s.mistakes || []).map(m => ({ ...m, tags: m.tags || [] })),
        days: s.days || {},
        read: s.read || [],
        lessons: {},
        ratings: s.ratings || [],
        goal: [4, 8, 12].includes(s.goal) ? s.goal : 8,
        coach: typeof s.coach === 'boolean' ? s.coach : true,
        strength: V1_SKILL_TO_LEVEL[s.skill] || DEFAULT_LEVEL,
        difficulty: 0,
        puzzle: { rating: STAGES[level].rating, count: 0, history: [] },
        themes: {},
        reviews: [],
        vision: { best: 0, runs: 0, last: [] },
        profiles: { lichess: '', chesscom: '' },
      };
    },
  },
  {
    from: 2,
    run(s) {
      return {
        ...s,
        mistakes: (s.mistakes || []).map(m => (m.kind ? m : { ...m, kind: kindFromExplanation(m.explanation) })),
        log: [],
        plan: null,
        endgames: {},
        calc: { visual: emptyDrillStats(), checks: emptyDrillStats() },
        settings: { ...DEFAULT_APPEARANCE, sound: true, haptics: true },
      };
    },
  },
  {
    from: 3,
    run(s) {
      return { ...s, settings: { ...s.settings, autoLevel: true }, sync: DEFAULT_SYNC(), games: [] };
    },
  },
  {
    from: 5,
    run(s) {
      // Seed each skill from the matching theme rating where there is one.
      const skills = seedSkills(s.puzzle?.rating || STAGES[0].rating);
      for (const [theme, skill] of Object.entries(THEME_SKILL)) {
        const t = s.themes?.[theme];
        if (t?.count) skills[skill] = { rating: t.rating, count: t.count };
      }
      const active = !!(s.profiles?.lichess || s.profiles?.chesscom || s.puzzle?.count || s.reviews?.length);
      return {
        ...s,
        onboarded: active,
        minutes: 20,
        target: null,
        milestones: [],
        skills,
        curriculum: { units: {}, current: null, placed: false },
        session: null,
        sync: { ...s.sync, ratingsAt: 0 },
      };
    },
  },
  {
    from: 4,
    run(s) {
      return {
        ...s,
        settings: { ...s.settings, candidates: false },
        calc: { ...s.calc, assess: emptyDrillStats() },
        candidates: { asked: 0, hit: 0, last: [] },
      };
    },
  },
];

/** Upgrade any supported saved state to the current version. Throws on unknown input. */
export function migrate(input) {
  if (!input || typeof input !== 'object') throw new Error('Not a Rankup state');
  let s = structuredClone(input);
  if (!Number.isInteger(s.version) || s.version < 1 || s.version > CURRENT_VERSION)
    throw new Error('Unsupported backup version ' + s.version);
  while (s.version < CURRENT_VERSION) {
    const step = MIGRATIONS.find(m => m.from === s.version);
    if (!step) throw new Error('No migration from version ' + s.version);
    s = { ...step.run(s), version: s.version + 1 };
  }
  // Fill fields added after a backup was made within the same version.
  const base = defaults();
  return {
    ...base,
    ...s,
    settings: { ...base.settings, ...s.settings },
    calc: { ...base.calc, ...s.calc },
    sync: { ...base.sync, ...s.sync },
    skills: { ...base.skills, ...s.skills },
    curriculum: { ...base.curriculum, ...s.curriculum },
  };
}

const isDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
const finite = (n, min = -Infinity, max = Infinity) => Number.isFinite(n) && n >= min && n <= max;

/** Check a migrated state. Returns an error message, or null when valid. */
export function validate(s) {
  if (!s || s.version !== CURRENT_VERSION) return 'wrong version';
  if (!s.records || typeof s.records !== 'object') return 'records';
  for (const r of Object.values(s.records)) {
    if (!r || !['tries', 'clean', 'box', 'due'].every(k => finite(r[k], 0)) || r.box > 5) return 'record';
  }
  if (!Array.isArray(s.mistakes)) return 'mistakes';
  for (const p of s.mistakes) {
    if (!p || typeof p.id !== 'string' || !/^m[a-z0-9]+$/i.test(p.id) || typeof p.fen !== 'string') return 'mistake';
    if (p.source && p.source.reviewId !== undefined && (typeof p.source.reviewId !== 'string' || !Number.isInteger(p.source.ply)))
      return 'mistake source';
    if (!Array.isArray(p.line) || !p.line.length || p.line.length > 7) return 'mistake line';
    let g;
    try {
      g = new Chess(p.fen);
    } catch {
      return 'mistake position';
    }
    for (const u of p.line) if (!tryUci(g, u)) return 'mistake move';
  }
  if (!s.days || typeof s.days !== 'object') return 'days';
  for (const [d, v] of Object.entries(s.days)) if (!isDate(d) || !finite(v?.attempts, 0) || !finite(v?.clean, 0)) return 'day';
  if (!Array.isArray(s.read) || !s.read.every(i => Number.isInteger(i))) return 'read';
  if (!s.lessons || typeof s.lessons !== 'object') return 'lessons';
  for (const [id, l] of Object.entries(s.lessons))
    if (!/^[a-z0-9-]+$/.test(id) || !l || !Number.isInteger(l.step) || l.step < 0 || typeof l.done !== 'boolean') return 'lesson progress';
  if (!Array.isArray(s.ratings)) return 'ratings';
  for (const r of s.ratings) if (!finite(r?.rating, 100, 3500) || typeof r.platform !== 'string' || !isDate(r.date)) return 'rating';
  if (![4, 8, 12].includes(s.goal)) return 'goal';
  if (typeof s.coach !== 'boolean') return 'coach';
  if (!LEVELS.some(l => l.id === s.strength)) return 'strength';
  if (![-200, 0, 200].includes(s.difficulty)) return 'difficulty';
  if (!s.puzzle || !finite(s.puzzle.rating, 100, 3500) || !finite(s.puzzle.count, 0) || !Array.isArray(s.puzzle.history))
    return 'puzzle rating';
  if (!s.themes || typeof s.themes !== 'object') return 'themes';
  for (const t of Object.values(s.themes)) if (!finite(t?.rating, 100, 3500) || !finite(t?.count, 0)) return 'theme rating';
  if (!Array.isArray(s.reviews)) return 'reviews';
  for (const r of s.reviews) {
    if (!r || typeof r.id !== 'string' || !/^r[a-z0-9]+$/i.test(r.id) || !Array.isArray(r.moves) || !Array.isArray(r.evals))
      return 'review';
    if (typeof r.startFen !== 'string' || !Array.isArray(r.marks) || !r.marks.every(m => Number.isInteger(m?.ply))) return 'review marks';
  }
  if (!s.vision || !finite(s.vision.best, 0)) return 'vision';
  if (!s.profiles || typeof s.profiles !== 'object') return 'profiles';
  for (const m of s.mistakes) if (m.kind !== undefined && !KIND_IDS.includes(m.kind)) return 'mistake kind';
  if (!Array.isArray(s.log) || s.log.length > MAX_LOG * 2) return 'log';
  for (const e of s.log)
    if (!e || !isDate(e.d) || !LOG_KINDS.includes(e.k) || typeof e.t !== 'string' || ![0, 1].includes(e.c)) return 'log entry';
  if (s.plan !== null && (typeof s.plan !== 'object' || !isDate(s.plan.week) || !Array.isArray(s.plan.items))) return 'plan';
  if (!s.endgames || typeof s.endgames !== 'object') return 'endgames';
  for (const e of Object.values(s.endgames)) if (!finite(e?.tries, 0) || !finite(e?.wins, 0)) return 'endgame progress';
  for (const k of ['visual', 'checks', 'assess'])
    if (!s.calc?.[k] || !finite(s.calc[k].best, 0) || !finite(s.calc[k].runs, 0)) return 'calc';
  const st = s.settings;
  if (!st || !BOARD_THEMES[st.board] || !PIECE_SETS[st.pieces] || typeof st.sound !== 'boolean' || typeof st.haptics !== 'boolean')
    return 'settings';
  if (typeof st.autoLevel !== 'boolean' || typeof st.candidates !== 'boolean') return 'settings';
  if (!s.candidates || !finite(s.candidates.asked, 0) || !finite(s.candidates.hit, 0) || !Array.isArray(s.candidates.last))
    return 'candidates';
  if (typeof s.onboarded !== 'boolean' || ![10, 20, 30, 45, 60].includes(s.minutes)) return 'onboarding';
  if (s.target !== null) {
    const t = s.target;
    if (
      typeof t !== 'object' ||
      typeof t.perf !== 'string' ||
      !finite(t.target, 100, 3500) ||
      !isDate(t.by) ||
      !finite(t.start?.rating, 100, 3500)
    )
      return 'target';
  }
  if (!Array.isArray(s.milestones)) return 'milestones';
  if (!s.skills || typeof s.skills !== 'object') return 'skills';
  for (const v of Object.values(s.skills)) if (!finite(v?.rating, 100, 3500) || !finite(v?.count, 0)) return 'skill';
  if (!s.curriculum || typeof s.curriculum.units !== 'object' || typeof s.curriculum.placed !== 'boolean') return 'curriculum';
  for (const [id, u] of Object.entries(s.curriculum.units))
    if (!/^[a-z0-9-]+$/.test(id) || !finite(u?.tries, 0) || !finite(u?.clean, 0) || !Array.isArray(u.recent)) return 'unit progress';
  if (s.session !== null && (typeof s.session !== 'object' || !isDate(s.session.date) || !Array.isArray(s.session.blocks)))
    return 'session';
  const sy = s.sync;
  if (!sy || typeof sy.auto !== 'boolean' || typeof sy.ratedOnly !== 'boolean' || !Array.isArray(sy.controls)) return 'sync';
  if (!sy.controls.every(c => CONTROLS.includes(c)) || !finite(sy.minMoves, 0, 60) || !finite(sy.dailyCap, 1, 50)) return 'sync';
  if (!sy.last || !finite(sy.last.lichess, 0) || !finite(sy.last.chesscom, 0) || !Array.isArray(sy.seen)) return 'sync';
  if (!Array.isArray(s.games) || s.games.length > MAX_GAMES * 2) return 'games';
  for (const g of s.games) if (!g || !isDate(g.d) || !LEVELS.some(l => l.id === g.level) || ![0, 0.5, 1].includes(g.r)) return 'game';
  return null;
}

/** Parse, migrate and validate text from storage or a backup file. */
export function parseState(text) {
  const state = migrate(JSON.parse(text));
  const problem = validate(state);
  if (problem) throw new Error('Invalid state: ' + problem);
  return state;
}

/**
 * Load from storage. When saved data cannot be read, keep a copy under a
 * recovery key instead of letting the next save overwrite it.
 */
export function loadState(storage, now = Date.now()) {
  let raw;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { state: defaults(), storageOK: false, recovered: false };
  }
  if (!raw) return { state: defaults(), storageOK: true, recovered: false };
  try {
    return { state: parseState(raw), storageOK: true, recovered: false };
  } catch {
    try {
      storage.setItem(RECOVERY_PREFIX + now, raw);
    } catch {}
    return { state: defaults(), storageOK: true, recovered: true };
  }
}

/** Append a finished exercise to the log, keeping it bounded. */
export function logAttempt(state, { kind, theme, clean, date = dateKey() }) {
  state.log.push({ d: date, k: kind, t: String(theme || ''), c: clean ? 1 : 0 });
  if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
}

/** Record a finished practice game. */
/** Record whether the engine's best move was among the candidates named before a move. */
export function logCandidates(state, hit, date = dateKey()) {
  state.candidates.asked++;
  if (hit) state.candidates.hit++;
  state.candidates.last.push({ d: date, h: hit ? 1 : 0 });
  if (state.candidates.last.length > 100) state.candidates.last.splice(0, state.candidates.last.length - 100);
}

export function logGame(state, { level, result, date = dateKey() }) {
  state.games.push({ d: date, level, r: result });
  if (state.games.length > MAX_GAMES) state.games.splice(0, state.games.length - MAX_GAMES);
}

export function saveState(storage, state) {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function recoveryKeys(storage) {
  const keys = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k?.startsWith(RECOVERY_PREFIX)) keys.push(k);
    }
  } catch {}
  return keys.sort();
}

export function dateKey(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** Consecutive days with at least one attempt, ending today or yesterday. */
export function streaks(days, today = new Date()) {
  const active = v => (v?.attempts || 0) + (v?.vision || 0) > 0;
  const has = d => active(days[dateKey(d)]);
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!has(cursor)) cursor.setDate(cursor.getDate() - 1);
  let current = 0;
  while (has(cursor)) {
    current++;
    cursor.setDate(cursor.getDate() - 1);
  }
  const keys = Object.keys(days)
    .filter(k => active(days[k]))
    .sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const k of keys) {
    const d = new Date(k + 'T12:00:00');
    run = prev && Math.round((d.getTime() - prev.getTime()) / 86400000) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return { current, best: Math.max(best, current) };
}
