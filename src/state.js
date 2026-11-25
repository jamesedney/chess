// Saved progress: its shape, validation and storage. The app keeps very
// little: who you are online, your puzzle rating, the positions from your own
// games, when each position is next due, your real ratings, and how the board
// looks. Pure functions are exported for the unit tests; load and save take a
// storage object so tests can pass a fake.
import { Chess } from '../vendor/chess.js';
import { tryUci } from './chess-utils.js';
import { BOARD_THEMES, PIECE_SETS, DEFAULT_APPEARANCE } from './appearance.js';
import { DEFAULT_SYNC, CONTROLS, MAX_REVIEWED } from './sync.js';

export const STORAGE_KEY = 'rankup-v1'; // Kept for continuity; the version lives inside.
export const RECOVERY_PREFIX = 'rankup-recovery-';
/** Where the data of a pre-7.0 install is kept, once, so nothing 7.0 dropped is lost. */
export const LEGACY_KEY = 'rankup-before-7';
export const CURRENT_VERSION = 12;
export const START_RATING = 1000;
/** Positions from your games kept at most; past this the oldest solved ones go. */
export const MAX_MISTAKES = 600;

export function defaults() {
  return {
    version: CURRENT_VERSION,
    profiles: { lichess: '', chesscom: '' },
    puzzle: { rating: START_RATING, count: 0, history: [] }, // history: one { date, rating } a day
    records: {}, // position id -> { tries, clean, box, due, last }: see srs.js
    mistakes: [], // positions from your own games, newest first: see mistakes.js
    ratings: [], // your real ratings by day: { platform, date, rating }
    sync: DEFAULT_SYNC(),
    settings: { ...DEFAULT_APPEARANCE, sound: true, haptics: true },
  };
}

const isDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
const finite = (n, min = -Infinity, max = Infinity) => Number.isFinite(n) && n >= min && n <= max;
const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : []);

/** A position's line is playable from its position: the check every saved or imported position must pass. */
function playable(fen, line) {
  if (typeof fen !== 'string' || !Array.isArray(line) || !line.length || line.length > 7) return false;
  let g;
  try {
    g = new Chess(fen);
  } catch {
    return false;
  }
  for (const u of line) if (typeof u !== 'string' || !tryUci(g, u)) return false;
  return true;
}

/** The game key the sync uses, from a review's Site header. */
function keyFromSite(site) {
  if (typeof site !== 'string' || !/^https?:\/\//.test(site)) return null;
  return site.replace(/^https?:\/\//, '').replace(/\/(black|white)$/, '');
}

/**
 * Bring a state saved by any version before 7.0 (versions 1 to 11) to the
 * current shape. Everything the app still uses is carried over: your
 * accounts, puzzle rating, saved positions and when they are due, real
 * ratings, which games were already read, and how the board looks. The rest
 * (lessons, plans, drills, logs, the reviewed games themselves) is dropped.
 */
export function fromLegacy(s) {
  const base = defaults();
  const reviews = Array.isArray(s.reviews) ? s.reviews.filter(isObject) : [];
  const byId = new Map(reviews.map(r => [r.id, r]));
  const marks = new Map();
  for (const r of reviews) for (const m of Array.isArray(r.marks) ? r.marks : []) if (m?.mistakeId) marks.set(m.mistakeId, m);
  const mistakes = (Array.isArray(s.mistakes) ? s.mistakes : [])
    .filter(m => isObject(m) && typeof m.id === 'string' && /^m[a-z0-9]+$/i.test(m.id) && playable(m.fen, m.line))
    .map(m => {
      const r = m.source?.reviewId ? byId.get(m.source.reviewId) : null;
      return {
        id: m.id,
        fen: m.fen,
        line: m.line,
        played: typeof m.played === 'string' ? m.played : String(m.title || '').replace(/^Instead of /, ''),
        explanation: typeof m.explanation === 'string' ? m.explanation : '',
        loss: finite(m.loss, 0) ? m.loss : 0,
        created: finite(m.created, 0) ? m.created : 0,
        ...(m.archived ? { archived: true } : {}),
        ...(marks.get(m.id)?.deep ? { deep: true } : {}),
        game: r ? { opp: String((r.colour === 'w' ? r.black : r.white) || ''), date: isDate(r.date) ? r.date : '' } : null,
      };
    });
  let board = s.settings?.board;
  // The default board changed twice: walnut to grey in 4.1, grey to green in 5.3. Other choices stay.
  if (s.version <= 7 && board === 'walnut') board = 'grey';
  if (s.version <= 9 && board === 'grey') board = 'green';
  const old = isObject(s.sync) ? s.sync : {};
  const reviewed = reviews
    .filter(r => r.complete)
    .map(r => (typeof r.gameKey === 'string' ? r.gameKey : keyFromSite(r.site)))
    .filter(Boolean);
  return {
    version: CURRENT_VERSION,
    profiles: {
      lichess: typeof s.profiles?.lichess === 'string' ? s.profiles.lichess : '',
      chesscom: typeof s.profiles?.chesscom === 'string' ? s.profiles.chesscom : '',
    },
    puzzle:
      isObject(s.puzzle) && finite(s.puzzle.rating, 100, 3500)
        ? {
            rating: s.puzzle.rating,
            count: finite(s.puzzle.count, 0) ? s.puzzle.count : 0,
            history: (Array.isArray(s.puzzle.history) ? s.puzzle.history : [])
              .filter(h => isDate(h?.date) && finite(h.rating, 100, 3500))
              .map(h => ({ date: h.date, rating: h.rating })),
          }
        : base.puzzle,
    records: Object.fromEntries(
      Object.entries(isObject(s.records) ? s.records : {}).filter(
        ([id, r]) => /^[a-z0-9]+$/i.test(id) && r && ['tries', 'clean', 'box', 'due'].every(k => finite(r[k], 0)) && r.box <= 5,
      ),
    ),
    mistakes,
    ratings: (Array.isArray(s.ratings) ? s.ratings : []).filter(
      r => finite(r?.rating, 100, 3500) && typeof r.platform === 'string' && isDate(r.date),
    ),
    sync: {
      ...base.sync,
      auto: typeof old.auto === 'boolean' ? old.auto : base.sync.auto,
      ratedOnly: typeof old.ratedOnly === 'boolean' ? old.ratedOnly : base.sync.ratedOnly,
      controls: Array.isArray(old.controls) ? old.controls.filter(c => CONTROLS.includes(c)) : base.sync.controls,
      last: {
        lichess: finite(old.last?.lichess, 0) ? old.last.lichess : 0,
        chesscom: finite(old.last?.chesscom, 0) ? old.last.chesscom : 0,
      },
      seen: strings(old.seen),
      failed: strings(old.failed),
      ...(finite(old.ratingsAt, 0) ? { ratingsAt: old.ratingsAt } : {}),
      ...(isObject(old.perfs) ? { perfs: old.perfs } : {}),
      ...(Array.isArray(old.followed) ? { followed: strings(old.followed) } : {}),
      backfillAt: finite(old.ledgerAt, 0) ? old.ledgerAt : 0,
      reviewed: [...new Set(reviewed)].slice(-MAX_REVIEWED),
    },
    settings: {
      board: BOARD_THEMES[board] ? board : base.settings.board,
      pieces: PIECE_SETS[s.settings?.pieces] ? s.settings.pieces : base.settings.pieces,
      sound: typeof s.settings?.sound === 'boolean' ? s.settings.sound : true,
      haptics: typeof s.settings?.haptics === 'boolean' ? s.settings.haptics : true,
    },
  };
}

/** Upgrade any supported saved state to the current version. Throws on unknown input. */
export function migrate(input) {
  if (!isObject(input)) throw new Error('Not a Rankup state');
  const v = input.version;
  if (!Number.isInteger(v) || v < 1 || v > CURRENT_VERSION) throw new Error('Unsupported backup version ' + v);
  const s = v < CURRENT_VERSION ? fromLegacy(structuredClone(input)) : structuredClone(input);
  // Fill fields added after a backup was made within the same version.
  const base = defaults();
  return { ...base, ...s, settings: { ...base.settings, ...s.settings }, sync: { ...base.sync, ...s.sync } };
}

/** Check a migrated state. Returns an error message, or null when valid. */
export function validate(s) {
  if (!s || s.version !== CURRENT_VERSION) return 'wrong version';
  if (!isObject(s.profiles) || typeof s.profiles.lichess !== 'string' || typeof s.profiles.chesscom !== 'string') return 'profiles';
  if (!isObject(s.puzzle) || !finite(s.puzzle.rating, 100, 3500) || !finite(s.puzzle.count, 0) || !Array.isArray(s.puzzle.history))
    return 'puzzle rating';
  for (const h of s.puzzle.history) if (!isDate(h?.date) || !finite(h.rating, 100, 3500)) return 'puzzle history';
  if (!isObject(s.records)) return 'records';
  for (const [id, r] of Object.entries(s.records)) {
    if (!/^[a-z0-9]+$/i.test(id)) return 'record id';
    if (!r || !['tries', 'clean', 'box', 'due'].every(k => finite(r[k], 0)) || r.box > 5) return 'record';
  }
  if (!Array.isArray(s.mistakes)) return 'mistakes';
  for (const p of s.mistakes) {
    if (!isObject(p) || typeof p.id !== 'string' || !/^m[a-z0-9]+$/i.test(p.id)) return 'mistake';
    if (!playable(p.fen, p.line)) return 'mistake position';
    if (typeof p.played !== 'string' || typeof p.explanation !== 'string') return 'mistake text';
    if (p.game !== null && p.game !== undefined && (!isObject(p.game) || typeof p.game.opp !== 'string')) return 'mistake game';
  }
  if (!Array.isArray(s.ratings)) return 'ratings';
  for (const r of s.ratings) if (!finite(r?.rating, 100, 3500) || typeof r.platform !== 'string' || !isDate(r.date)) return 'rating';
  const sy = s.sync;
  if (!isObject(sy) || typeof sy.auto !== 'boolean' || typeof sy.ratedOnly !== 'boolean' || !Array.isArray(sy.controls)) return 'sync';
  if (!sy.controls.every(c => CONTROLS.includes(c))) return 'sync';
  if (!isObject(sy.last) || !finite(sy.last.lichess, 0) || !finite(sy.last.chesscom, 0)) return 'sync';
  for (const k of ['seen', 'failed', 'reviewed']) if (!Array.isArray(sy[k]) || !sy[k].every(x => typeof x === 'string')) return 'sync';
  const st = s.settings;
  if (!isObject(st) || !BOARD_THEMES[st.board] || !PIECE_SETS[st.pieces]) return 'settings';
  if (typeof st.sound !== 'boolean' || typeof st.haptics !== 'boolean') return 'settings';
  return null;
}

/** Parse, migrate and validate text from storage or a backup file. */
export function parseState(text) {
  const state = migrate(JSON.parse(text));
  const problem = validate(state);
  if (problem) throw new Error('Invalid state: ' + problem);
  return state;
}

/** How much history a state holds, to choose between it and a recovered copy. */
function weight(s) {
  return s.mistakes.length + s.ratings.length + Object.keys(s.records).length + s.puzzle.count;
}

/**
 * A copy set aside because an older version could not read it may load now.
 * Bring back the readable copy with the most history when it holds more than
 * the state just loaded, and keep the state it replaces as a recovery copy.
 */
function restoreRecovered(storage, current, now) {
  let best = null;
  try {
    for (const key of recoveryKeys(storage)) {
      try {
        const saved = parseState(storage.getItem(key));
        if (!best || weight(saved) > weight(best.saved)) best = { key, saved };
      } catch {}
    }
  } catch {
    return null;
  }
  if (!best || weight(best.saved) <= weight(current)) return null;
  try {
    if (weight(current) > 0) storage.setItem(RECOVERY_PREFIX + now, JSON.stringify(current));
    storage.setItem(STORAGE_KEY, JSON.stringify(best.saved));
    storage.removeItem(best.key);
  } catch {
    return null;
  }
  return best.saved;
}

/**
 * Load from storage. When saved data cannot be read, keep a copy under a
 * recovery key instead of letting the next save overwrite it; when a kept
 * copy can be read again, bring it back. Data saved before 7.0 is copied
 * aside once, whole, before it is slimmed down.
 */
export function loadState(storage, now = Date.now()) {
  let raw;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { state: defaults(), storageOK: false, recovered: false, restored: false };
  }
  let state = defaults();
  let recovered = false;
  if (raw) {
    try {
      state = parseState(raw);
      if (JSON.parse(raw).version < CURRENT_VERSION) {
        // Best effort: a full storage simply keeps no copy.
        try {
          if (!storage.getItem(LEGACY_KEY)) storage.setItem(LEGACY_KEY, raw);
        } catch {}
      }
    } catch {
      // Keep one copy: once it is stored, clear the original so the next
      // load does not copy the same data again.
      try {
        storage.setItem(RECOVERY_PREFIX + now, raw);
        storage.removeItem(STORAGE_KEY);
      } catch {}
      recovered = true;
    }
  }
  const back = restoreRecovered(storage, state, now + 1);
  if (back) return { state: back, storageOK: true, recovered: false, restored: true };
  return { state, storageOK: true, recovered, restored: false };
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
