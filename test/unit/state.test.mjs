import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaults,
  validate,
  migrate,
  parseState,
  loadState,
  saveState,
  recoveryKeys,
  dateKey,
  CURRENT_VERSION,
  STORAGE_KEY,
  RECOVERY_PREFIX,
  LEGACY_KEY,
} from '../../src/state.js';

class FakeStorage {
  constructor(initial = {}) {
    this.map = new Map(Object.entries(initial));
  }
  get length() {
    return this.map.size;
  }
  key(i) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
}

const BACK_RANK = '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1';
const mistake = (extra = {}) => ({
  id: 'mabc1',
  title: 'Instead of h3',
  fen: BACK_RANK,
  line: ['e1e8'],
  theme: 'Personal mistakes',
  tags: ['mate'],
  goal: 'Deliver checkmate in one.',
  explanation: 'You had a forced mate in 1 starting with Re8#.',
  kind: 'missed-mate',
  played: 'h3',
  loss: 61,
  created: 1700000000000,
  source: { reviewId: 'rxyz1', ply: 40 },
  ...extra,
});

/** A state as 6.0 saved it (version 11), with the fields 7.0 reads and plenty it does not. */
const v11 = (extra = {}) => ({
  version: 11,
  records: { mabc1: { tries: 2, clean: 1, box: 1, due: 5, last: 4 }, p001: { tries: 1, clean: 1, box: 1, due: 9, last: 8 } },
  mistakes: [mistake(), mistake({ id: 'mprac', source: { practice: true }, fen: '7k/8/5KQ1/8/8/8/8/8 w - - 0 1', line: ['g6g7'] })],
  ratings: [{ rating: 1254, platform: 'Chess.com blitz', date: '2026-10-27' }],
  puzzle: { rating: 1420, count: 300, history: [{ date: '2026-10-27', rating: 1420, extra: 1 }] },
  profiles: { lichess: '', chesscom: 'JamesAE95' },
  reviews: [
    {
      id: 'rxyz1',
      gameKey: 'www.chess.com/game/live/1',
      white: 'JamesAE95',
      black: 'rival',
      colour: 'w',
      date: '2026-10-26',
      complete: true,
      moves: ['e4'],
      evals: [0, 0],
      marks: [{ ply: 40, mistakeId: 'mabc1', deep: true }],
    },
    { id: 'rxyz2', site: 'https://lichess.org/abcd1234/black', complete: true, moves: [], evals: [], marks: [] },
    { id: 'rxyz3', gameKey: 'lichess.org/half', complete: false, moves: [], evals: [], marks: [] },
  ],
  settings: { board: 'ocean', pieces: 'merida', sound: false, haptics: true, autoLevel: true, colour: 'r', nemesis: true },
  sync: {
    auto: true,
    ratedOnly: true,
    controls: ['blitz'],
    minMoves: 10,
    dailyCap: 5,
    last: { lichess: 0, chesscom: 1761000000000 },
    seen: ['www.chess.com/game/live/1'],
    failed: ['www.chess.com/game/live/9'],
    ledgerAt: 1760000000000,
    followed: ['Chess.com blitz'],
    perfs: { 'Chess.com blitz': 1254 },
  },
  log: [{ d: '2026-10-27', k: 'p', t: 'Tactics', c: 1 }],
  ledger: [{ k: 'x' }],
  gate: { stage: 3, set: 'proof', since: null },
  session: { date: '2026-10-27', blocks: [] },
  lessons: { forks: { step: 2, done: false } },
  ...extra,
});

test('defaults are valid, and hold only what the app uses', () => {
  const d = defaults();
  assert.equal(validate(d), null);
  assert.deepEqual(Object.keys(d).sort(), ['mistakes', 'profiles', 'puzzle', 'ratings', 'records', 'settings', 'sync', 'version']);
  assert.equal(d.version, CURRENT_VERSION);
});

test('a 6.0 state keeps accounts, ratings, positions and their schedule, and drops the rest', () => {
  const s = migrate(v11());
  assert.equal(validate(s), null);
  assert.equal(s.version, CURRENT_VERSION);
  assert.deepEqual(s.profiles, { lichess: '', chesscom: 'JamesAE95' });
  assert.deepEqual(s.puzzle, { rating: 1420, count: 300, history: [{ date: '2026-10-27', rating: 1420 }] });
  assert.deepEqual(s.ratings, [{ rating: 1254, platform: 'Chess.com blitz', date: '2026-10-27' }]);
  assert.deepEqual(Object.keys(s.records), ['mabc1', 'p001']);
  // A position from an online game says who it was against; one from a practice game does not.
  assert.deepEqual(s.mistakes[0], {
    id: 'mabc1',
    fen: BACK_RANK,
    line: ['e1e8'],
    played: 'h3',
    explanation: 'You had a forced mate in 1 starting with Re8#.',
    loss: 61,
    created: 1700000000000,
    deep: true,
    game: { opp: 'rival', date: '2026-10-26' },
  });
  assert.equal(s.mistakes[1].game, null);
  assert.equal(s.mistakes[1].deep, undefined);
  // Games already read are not read again: by their key, or by their Site when the key was never saved.
  assert.deepEqual(s.sync.reviewed, ['www.chess.com/game/live/1', 'lichess.org/abcd1234']);
  assert.equal(s.sync.backfillAt, 1760000000000);
  assert.deepEqual(s.sync.controls, ['blitz']);
  assert.deepEqual(s.sync.failed, ['www.chess.com/game/live/9']);
  assert.deepEqual(s.sync.followed, ['Chess.com blitz']);
  assert.equal(s.sync.dailyCap, undefined);
  assert.deepEqual(s.settings, { board: 'ocean', pieces: 'merida', sound: false, haptics: true });
  for (const gone of ['reviews', 'log', 'ledger', 'gate', 'session', 'lessons']) assert.equal(s[gone], undefined, gone);
});

test('a version 1 backup still loads', () => {
  const s = migrate({ version: 1, level: 2, mistakes: [mistake({ source: undefined, played: undefined })], records: {}, ratings: [] });
  assert.equal(validate(s), null);
  assert.equal(s.mistakes[0].played, 'h3', 'read from the old title');
  assert.equal(s.puzzle.rating, defaults().puzzle.rating);
  assert.equal(s.settings.board, defaults().settings.board);
});

test('the old default boards move to the current default; a board you chose stays', () => {
  assert.equal(migrate(v11({ version: 7, settings: { board: 'walnut' } })).settings.board, 'green');
  assert.equal(migrate(v11({ version: 9, settings: { board: 'grey' } })).settings.board, 'green');
  assert.equal(migrate(v11({ version: 10, settings: { board: 'grey' } })).settings.board, 'grey');
  assert.equal(migrate(v11({ version: 10, settings: { board: 'walnut' } })).settings.board, 'walnut');
  assert.equal(migrate(v11({ settings: { board: 'no-such-board', pieces: 'nope' } })).settings.pieces, 'cburnett');
});

test('old data that 7.0 cannot use is dropped item by item, not the whole state', () => {
  const s = migrate(
    v11({
      mistakes: [mistake(), mistake({ id: 'mbad1', line: ['a1a8'] }), mistake({ id: '<img>', line: ['e1e8'] }), null],
      records: { ok1: { tries: 1, clean: 0, box: 0, due: 1 }, bad: { tries: -1 }, 'x<y': { tries: 1, clean: 0, box: 0, due: 1 } },
      ratings: [{ rating: 1200, platform: 'Lichess blitz', date: '2026-01-01' }, { rating: 'x' }],
    }),
  );
  assert.equal(validate(s), null);
  assert.deepEqual(
    s.mistakes.map(m => m.id),
    ['mabc1'],
  );
  assert.deepEqual(Object.keys(s.records), ['ok1']);
  assert.equal(s.ratings.length, 1);
});

test('invalid current data is rejected, and newer or malformed versions are refused', () => {
  const bad = change => {
    const s = defaults();
    change(s);
    return validate(s);
  };
  assert.equal(
    bad(s => s.mistakes.push({ id: 'm1', fen: BACK_RANK, line: ['a1a8'], played: 'h3', explanation: '' })),
    'mistake position',
  );
  assert.equal(
    bad(s => s.mistakes.push({ id: '<b>', fen: BACK_RANK, line: ['e1e8'], played: 'h3', explanation: '' })),
    'mistake',
  );
  assert.equal(
    bad(s => (s.records['a<b'] = { tries: 1, clean: 0, box: 0, due: 0 })),
    'record id',
  );
  assert.equal(
    bad(s => (s.records.p1 = { tries: 1, clean: 0, box: 9, due: 0 })),
    'record',
  );
  assert.equal(
    bad(s => (s.settings.board = 'nope')),
    'settings',
  );
  assert.equal(
    bad(s => (s.sync.reviewed = [1])),
    'sync',
  );
  assert.equal(
    bad(s => (s.puzzle.rating = 9999)),
    'puzzle rating',
  );
  assert.throws(() => migrate({ version: CURRENT_VERSION + 1 }), /Unsupported/);
  assert.throws(() => migrate({ version: 'x' }), /Unsupported/);
  assert.throws(() => migrate(null), /Not a Rankup state/);
  assert.throws(() => parseState('{"version":12,"puzzle":5}'), /Invalid state/);
});

test('a backup missing a later-added field gets the default', () => {
  const s = defaults();
  delete s.settings.haptics;
  delete s.sync.failed;
  const back = parseState(JSON.stringify(s));
  assert.equal(back.settings.haptics, true);
  assert.deepEqual(back.sync.failed, []);
});

test('data saved before 7.0 is copied aside once, whole, before it is slimmed', () => {
  const raw = JSON.stringify(v11());
  const storage = new FakeStorage({ [STORAGE_KEY]: raw });
  const { state, recovered, restored } = loadState(storage, 1000);
  assert.equal(state.version, CURRENT_VERSION);
  assert.equal(recovered, false);
  assert.equal(restored, false);
  assert.equal(storage.getItem(LEGACY_KEY), raw);
  assert.deepEqual(recoveryKeys(storage), [], 'it is not treated as unreadable data');
  // Saving and loading again leaves the copy alone and adds no other.
  saveState(storage, state);
  storage.setItem(LEGACY_KEY, 'kept');
  loadState(storage, 2000);
  assert.equal(storage.getItem(LEGACY_KEY), 'kept');
  // A storage too full for the copy still loads.
  const full = new FakeStorage({ [STORAGE_KEY]: raw });
  full.setItem = () => {
    throw new Error('quota');
  };
  assert.equal(loadState(full, 1000).state.mistakes.length, 2);
});

test('unreadable saved data is kept under a recovery key', () => {
  const storage = new FakeStorage({ [STORAGE_KEY]: '{not json' });
  const { state, recovered } = loadState(storage, 1234);
  assert.equal(recovered, true);
  assert.equal(validate(state), null);
  assert.equal(storage.getItem(RECOVERY_PREFIX + 1234), '{not json');
  assert.equal(storage.getItem(STORAGE_KEY), null);
});

test('a recovery copy that reads again comes back when it holds more history, and broken copies are skipped', () => {
  const heavy = migrate(v11());
  const storage = new FakeStorage({
    [RECOVERY_PREFIX + 1]: JSON.stringify(heavy),
    [RECOVERY_PREFIX + 2]: '{broken',
  });
  const { state, restored } = loadState(storage, 5000);
  assert.equal(restored, true);
  assert.equal(state.mistakes.length, 2);
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).puzzle.count, 300);
  assert.deepEqual(recoveryKeys(storage), [RECOVERY_PREFIX + 2]);
  // A lighter copy is not restored over more history.
  const light = new FakeStorage({ [STORAGE_KEY]: JSON.stringify(heavy), [RECOVERY_PREFIX + 1]: JSON.stringify(defaults()) });
  assert.equal(loadState(light, 5000).restored, false);
});

test('blocked storage is reported', () => {
  const blocked = {
    getItem() {
      throw new Error('denied');
    },
  };
  const { state, storageOK } = loadState(blocked);
  assert.equal(storageOK, false);
  assert.equal(validate(state), null);
});

test('date keys are local calendar days', () => {
  assert.equal(dateKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});
