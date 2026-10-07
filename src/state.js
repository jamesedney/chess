// Persistent training state: defaults, migrations, validation and storage.
// Pure functions are exported for the unit tests; load/save take a storage
// object so tests can pass a fake.
import { Chess } from '../vendor/chess.js';
import { tryUci } from './chess-utils.js';
import { STAGES } from './themes.js';
import { LEVELS, DEFAULT_LEVEL } from './strength.js';

export const STORAGE_KEY = 'rankup-v1'; // Kept for continuity; the version lives inside.
export const RECOVERY_PREFIX = 'rankup-recovery-';
export const CURRENT_VERSION = 2;
export const MAX_REVIEWS = 20;

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
  };
}

const V1_SKILL_TO_LEVEL = { 0: 'beginner', 3: 'novice', 8: 'elo1600', 20: 'full' };

/** Upgrade any supported saved state to the current version. Throws on unknown input. */
export function migrate(input) {
  if (!input || typeof input !== 'object') throw new Error('Not a Rankup state');
  let s = structuredClone(input);
  if (s.version === 1) {
    const base = defaults();
    const level = [0, 1, 2, 3].includes(s.level) ? s.level : 0;
    s = {
      ...base,
      records: s.records || {},
      mistakes: (s.mistakes || []).map(m => ({ ...m, tags: m.tags || [] })),
      days: s.days || {},
      read: s.read || [],
      ratings: s.ratings || [],
      goal: [4, 8, 12].includes(s.goal) ? s.goal : 8,
      coach: typeof s.coach === 'boolean' ? s.coach : true,
      strength: V1_SKILL_TO_LEVEL[s.skill] || DEFAULT_LEVEL,
      puzzle: { rating: STAGES[level].rating, count: 0, history: [] },
      version: 2,
    };
  }
  if (s.version !== CURRENT_VERSION) throw new Error('Unsupported backup version ' + s.version);
  // Fill fields added after a backup was made within the same version.
  return { ...defaults(), ...s };
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
    run = prev && Math.round((d - prev) / 86400000) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return { current, best: Math.max(best, current) };
}
