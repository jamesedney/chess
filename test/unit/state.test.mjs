import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, migrate, validate, parseState, loadState, RECOVERY_PREFIX, STORAGE_KEY, streaks, dateKey } from '../../src/state.js';

// A backup in the format written by Rankup 1.0.
const V1 = {
  version: 1,
  records: { p001: { tries: 2, clean: 1, box: 1, due: 1, last: 1 } },
  mistakes: [
    {
      id: 'mabc',
      title: 'Instead of Nf3',
      fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
      line: ['g1f3', 'b8c6', 'f1c4'],
      theme: 'Personal mistakes',
      level: 2,
      goal: 'Find the improvement.',
      explanation: 'x',
      played: 'Qh5',
      loss: 150,
      created: 1,
    },
  ],
  days: { '2026-10-01': { attempts: 8, clean: 6 } },
  read: [0, 2],
  ratings: [{ rating: 1210, platform: 'Chess.com rapid', date: '2026-10-01' }],
  level: 2,
  goal: 12,
  coach: false,
  skill: 8,
};

test('defaults are valid', () => {
  assert.equal(validate(defaults()), null);
});

test('a version 1 backup migrates without losing progress', () => {
  const s = migrate(V1);
  assert.equal(validate(s), null);
  assert.equal(s.version, 2);
  assert.deepEqual(s.records, V1.records);
  assert.equal(s.mistakes[0].id, 'mabc');
  assert.deepEqual(s.mistakes[0].tags, []);
  assert.equal(s.goal, 12);
  assert.equal(s.coach, false);
  assert.equal(s.strength, 'elo1600');
  assert.equal(s.puzzle.rating, 1400, 'Calculation stage seeds the puzzle rating');
  assert.deepEqual(s.ratings, V1.ratings);
});

test('invalid data is rejected', () => {
  assert.throws(() => parseState('{"version":9}'));
  assert.throws(() => parseState('not json'));
  const bad = defaults();
  bad.mistakes.push({ id: 'mx', fen: '8/8/8/8/8/8/8/8 w - - 0 1', line: ['e2e4'] });
  assert.notEqual(validate(bad), null);
  const badMove = defaults();
  badMove.mistakes.push({ id: 'my', fen: V1.mistakes[0].fen, line: ['e2e5'] });
  assert.match(validate(badMove), /mistake/);
});

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: k => (k in data ? data[k] : null),
    setItem: (k, v) => (data[k] = String(v)),
    removeItem: k => delete data[k],
    key: i => Object.keys(data)[i],
    get length() {
      return Object.keys(data).length;
    },
  };
}

test('unreadable saved data is kept under a recovery key', () => {
  const storage = fakeStorage({ [STORAGE_KEY]: '{broken' });
  const out = loadState(storage, 42);
  assert.equal(out.recovered, true);
  assert.equal(storage.data[RECOVERY_PREFIX + 42], '{broken');
  assert.equal(validate(out.state), null);
});

test('saved v1 data loads as v2', () => {
  const out = loadState(fakeStorage({ [STORAGE_KEY]: JSON.stringify(V1) }));
  assert.equal(out.recovered, false);
  assert.equal(out.state.version, 2);
});

test('blocked storage is reported', () => {
  const out = loadState({
    getItem() {
      throw new Error('denied');
    },
  });
  assert.equal(out.storageOK, false);
});

test('streaks count consecutive active days, including vision sprints', () => {
  const today = new Date(2026, 9, 7);
  const day = n => dateKey(new Date(2026, 9, 7 - n));
  const days = {
    [day(0)]: { attempts: 3, clean: 1 },
    [day(1)]: { attempts: 0, clean: 0, vision: 1 },
    [day(2)]: { attempts: 5, clean: 5 },
    [day(5)]: { attempts: 1, clean: 0 },
  };
  assert.deepEqual(streaks(days, today), { current: 3, best: 3 });
  const yesterdayOnly = { [day(1)]: { attempts: 1, clean: 1 } };
  assert.equal(streaks(yesterdayOnly, today).current, 1, 'a streak survives until the day ends');
});
