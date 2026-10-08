import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, migrate, validate, CURRENT_VERSION } from '../../src/state.js';
import { makeGoal, nextTarget, projection, trendSlope, paceFor } from '../../src/goal.js';
import { mainPerf, mergeRatings, lichessRatings, chessComRatings, seriesFor } from '../../src/ratings.js';
import { skillsOf, seedSkills, recordSkillPuzzle, leaks, skillMap } from '../../src/skills.js';
import {
  UNITS,
  BANDS,
  unitById,
  unitStatus,
  recordUnitPuzzle,
  refreshMastery,
  place,
  currentBand,
  chooseUnit,
  refresher,
  pathSummary,
  bandForRating,
} from '../../src/curriculum.js';
import { planSession, baseline, blockDone } from '../../src/program.js';
import { updateGoal, goalStatus, PUZZLE_PERF } from '../../src/progress-model.js';
import { SKILLS, OBJECTIVES } from '../../data/curriculum.js';
import { lessons as LESSONS } from '../../data/lessons.js';
import { puzzles } from '../../data/puzzles.js';

const NOW = new Date('2026-10-08T12:00:00Z');
const day = n => new Date(NOW.getTime() + n * 86400000).toISOString().slice(0, 10);
const fresh = () => defaults();
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

test('the curriculum is well formed', () => {
  const ids = new Set();
  const lessonIds = new Set(LESSONS.map(l => l.id));
  for (const u of UNITS) {
    assert.ok(!ids.has(u.id), `duplicate unit ${u.id}`);
    ids.add(u.id);
    assert.ok(
      BANDS.some(b => b.id === u.band),
      `${u.id} band`,
    );
    assert.ok(SKILLS[u.skill], `${u.id} skill`);
    assert.ok(u.tags.length, `${u.id} tags`);
    assert.ok(u.gate.puzzles > 0 && u.gate.accuracy > 0 && u.gate.accuracy <= 1, `${u.id} gate`);
    if (u.lesson) assert.ok(lessonIds.has(u.lesson), `${u.id} lesson ${u.lesson} exists`);
    // Every unit's tags must train at least one skill, so solving them moves the map.
    assert.ok(skillsOf(u.tags).length, `${u.id} tags map to a skill`);
    // Strict unit sessions need enough puzzles to reach the gate without repeats.
    const pool = puzzles.filter(p => u.tags.some(t => p.tags?.includes(t))).length;
    assert.ok(pool >= u.gate.puzzles * 3, `${u.id} has ${pool} puzzles`);
  }
  for (const b of BANDS)
    assert.ok(
      UNITS.some(u => u.band === b.id),
      `${b.id} has units`,
    );
  for (const s of Object.keys(SKILLS)) assert.ok(OBJECTIVES[s], `objective for ${s}`);
});

test('goal: next target, deadline from pace, and trend slope', () => {
  assert.equal(nextTarget(1180), 1400);
  assert.equal(nextTarget(1250), 1400);
  assert.equal(nextTarget(640), 800);
  assert.ok(paceFor(1000, 45) > paceFor(1000, 20));
  const g = makeGoal({ perf: 'Lichess rapid', rating: 1180, minutes: 20, now: NOW });
  assert.equal(g.target, 1400);
  assert.equal(g.start.date, '2026-10-08');
  assert.ok(g.by > '2027-01-01' && g.by < '2027-12-31', g.by);
  assert.equal(trendSlope([{ date: day(0), rating: 1000 }]), null);
  assert.equal(
    Math.round(
      trendSlope([
        { date: day(0), rating: 1000 },
        { date: day(10), rating: 1050 },
      ]),
    ),
    5,
  );
});

test('goal: the projection ignores history from before the plan started', () => {
  const goal = makeGoal({ perf: 'X', rating: 1180, now: NOW });
  // Rating fell before the plan; that must not count against it.
  const series = [
    { date: day(-60), rating: 1300 },
    { date: day(-30), rating: 1240 },
    { date: day(0), rating: 1180 },
  ];
  const p = projection(goal, series, NOW);
  assert.equal(p.status, 'on-track');
  assert.equal(p.current, 1180);
  assert.ok(p.projected >= goal.target - 5, `projected ${p.projected}`);
  // Two months of steady decline after the start is behind.
  const later = new Date(NOW.getTime() + 70 * 86400000);
  const falling = [...series, { date: day(30), rating: 1160 }, { date: day(70), rating: 1130 }];
  const q = projection(goal, falling, later);
  assert.equal(q.status, 'behind');
  // Reaching the target is reached.
  assert.equal(projection(goal, [...series, { date: day(20), rating: 1405 }], NOW).status, 'reached');
});

test('ratings: main time control, merging and platform readers', async () => {
  assert.equal(mainPerf({ rapid: 12, blitz: 300 }), 'rapid');
  assert.equal(mainPerf({ rapid: 3, blitz: 30 }), 'blitz');
  assert.equal(mainPerf({}), null);

  const log = [];
  assert.equal(mergeRatings(log, { perf: 'Lichess rapid', rating: 1200, history: [{ date: day(-5), rating: 1190 }] }, day(0)), 2);
  assert.equal(mergeRatings(log, { perf: 'Lichess rapid', rating: 1200, history: [] }, day(0)), 0);
  assert.equal(mergeRatings(log, { perf: 'Lichess rapid', rating: 1210, history: [] }, day(0)), 1);
  assert.deepEqual(seriesFor(log, 'Lichess rapid'), [
    { date: day(-5), rating: 1190 },
    { date: day(0), rating: 1210 },
  ]);

  const lichess = async url =>
    url.endsWith('/rating-history')
      ? json([
          {
            name: 'Rapid',
            points: [
              [2026, 8, 1, 1150],
              [2026, 8, 1, 1160],
              [2020, 0, 1, 900],
            ],
          },
        ])
      : json({ perfs: { rapid: { rating: 1180, games: 140 }, blitz: { rating: 1050, games: 30 } } });
  const r = await lichessRatings('me', lichess, NOW.getTime());
  assert.equal(r.perf, 'Lichess rapid');
  assert.equal(r.rating, 1180);
  assert.deepEqual(r.history, [{ date: '2026-09-01', rating: 1160 }]);
  await assert.rejects(
    lichessRatings('nobody', async () => json({}, 404)),
    /No Lichess account/,
  );

  const cc = await chessComRatings('Me', async url => {
    assert.match(url, /player\/me\/stats$/);
    return json({ chess_blitz: { last: { rating: 980 }, record: { win: 20, loss: 20, draw: 2 } } });
  });
  assert.deepEqual(cc, { perf: 'Chess.com blitz', rating: 980, history: [] });
});

test('skills: tags map to skills and puzzles move the right ratings', () => {
  assert.deepEqual(skillsOf(['fork', 'mateIn2']).sort(), ['mating', 'tactics']);
  const skills = seedSkills(1000);
  recordSkillPuzzle(skills, ['fork'], 1000, true);
  assert.ok(skills.tactics.rating > 1000);
  assert.equal(skills.tactics.count, 1);
  assert.equal(skills.endgames.rating, 1000);
  recordSkillPuzzle(skills, ['rookEndgame'], 1000, false);
  assert.ok(skills.endgames.rating < 1000);
});

test('skills: leaks from reviewed games widen the gap', () => {
  const s = fresh();
  s.puzzle.rating = 1000;
  s.skills = seedSkills(1000);
  const now = NOW.getTime();
  s.mistakes = [1, 2, 3].map(i => ({
    id: `m${i}`,
    kind: 'hung-piece',
    fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
  }));
  s.reviews = [1, 2, 3].map(i => ({
    id: `r${i}`,
    complete: true,
    created: now - i * 3600000,
    marks: [{ mistakeId: `m${i}`, cls: 'blunder' }],
  }));
  const lk = leaks(s, now);
  assert.equal(lk.games, 3);
  assert.equal(lk.perGame.safety, 1);
  const map = skillMap(s, 1200, now);
  assert.equal(map[0].id, 'safety');
  assert.equal(map[0].effective, 880);
  const r = refresher(lk);
  assert.equal(r.skill, 'safety');
  assert.equal(refresher({ games: 2, perGame: { safety: 3 } }), null);
});

test('curriculum: placement starts you at your level', () => {
  const s = fresh();
  place(s, 1180, day(0));
  assert.equal(bandForRating(1180).id, 'b3');
  assert.equal(currentBand(s).id, 'b3');
  assert.ok(UNITS.filter(u => u.band === 'b1' || u.band === 'b2').every(u => s.curriculum.units[u.id]?.placed));
  const sum = pathSummary(s);
  assert.equal(sum.band.id, 'b3');
  assert.equal(sum.bandDone, 0);
  const beginner = fresh();
  place(beginner, 600, day(0));
  assert.equal(currentBand(beginner).id, 'b1');
});

test('curriculum: the weakest skill picks the unit, and the gate masters it', () => {
  const s = fresh();
  place(s, 1180, day(0));
  const unit = chooseUnit(s, ['tactics', 'safety']);
  assert.equal(unit.id, 'c-deflect');
  assert.equal(s.curriculum.current, 'c-deflect');
  // The current unit sticks even if the order changes.
  assert.equal(chooseUnit(s, ['mating']).id, 'c-deflect');
  assert.equal(unitStatus(s, unit).progress, 0);
  for (let i = 0; i < unit.gate.puzzles - 1; i++) assert.deepEqual(recordUnitPuzzle(s, ['deflection'], true, day(0)), []);
  assert.ok(unitStatus(s, unit).progress > 0.85 && unitStatus(s, unit).progress < 1);
  const mastered = recordUnitPuzzle(s, ['deflection'], true, day(0));
  assert.deepEqual(
    mastered.map(u => u.id),
    ['c-deflect'],
  );
  assert.equal(s.curriculum.current, null);
  assert.equal(unitStatus(s, unit).progress, 1);
  assert.notEqual(chooseUnit(s, ['tactics']).id, 'c-deflect');
});

test('curriculum: low accuracy holds the gate, and a lesson must be finished', () => {
  const s = fresh();
  place(s, 1180, day(0));
  const unit = unitById('c-deflect');
  for (let i = 0; i < 20; i++) recordUnitPuzzle(s, ['deflection'], i % 2 === 0, day(0));
  assert.equal(unitStatus(s, unit).done, false);
  const withLesson = unitById('c-reply');
  for (let i = 0; i < 12; i++) recordUnitPuzzle(s, withLesson.tags, true, day(0));
  assert.equal(unitStatus(s, withLesson).done, false);
  assert.equal(unitStatus(s, withLesson).progress, 0.5);
  s.lessons[withLesson.lesson] = { done: true };
  assert.deepEqual(
    refreshMastery(s, day(0)).map(u => u.id),
    ['c-reply'],
  );
});

test('planner: a session fits the time and leads with the current unit', () => {
  const s = fresh();
  s.puzzle.rating = 1180;
  s.skills = seedSkills(1180);
  place(s, 1180, day(0));
  s.minutes = 20;
  const plan = planSession(s, { now: NOW.getTime(), goalStatus: 'on-track', target: 1400 });
  const ids = plan.blocks.map(b => b.id);
  assert.ok(ids.includes('unit'), ids.join());
  assert.ok(ids.includes('game'), 'a game when none was played recently');
  const unit = plan.blocks.find(b => b.id === 'unit');
  assert.equal(unit.params.unit, plan.unit);
  assert.equal(unit.params.strict, 1);
  assert.ok(plan.blocks.reduce((a, b) => a + b.est, 0) <= 20 * 1.15 + 15);
  assert.ok(plan.blocks.every(b => b.status === 'todo'));

  // More time adds the optional blocks; behind adds volume.
  s.minutes = 60;
  const long = planSession(s, { now: NOW.getTime(), goalStatus: 'behind', target: 1400 });
  assert.ok(long.blocks.length > plan.blocks.length);
  assert.equal(long.blocks.find(b => b.id === 'unit').count, 10);

  // A recent game makes the game optional; with ten minutes it drops out.
  s.minutes = 10;
  s.games.push({ d: day(0) });
  const short = planSession(s, { now: NOW.getTime(), goalStatus: 'on-track', target: 1400 });
  assert.ok(!short.blocks.some(b => b.id === 'game'));
  assert.ok(short.blocks.some(b => b.id === 'unit'));
});

test('planner: a fresh game review comes first and blocks know when they are done', () => {
  const s = fresh();
  s.puzzle.rating = 1180;
  place(s, 1180, day(0));
  s.minutes = 30;
  s.mistakes = [{ id: 'm1', kind: 'missed-tactic', fen: '8/8/8/8/8/8/8/K6k w - - 0 1' }];
  s.reviews = [
    {
      id: 'r1',
      complete: true,
      created: NOW.getTime(),
      colour: 'w',
      white: 'me',
      black: 'Rival',
      marks: [{ mistakeId: 'm1', cls: 'mistake' }],
    },
  ];
  const plan = planSession(s, { now: NOW.getTime(), target: 1400 });
  const review = plan.blocks.find(b => b.id === 'review');
  assert.ok(review, plan.blocks.map(b => b.id).join());
  assert.match(review.title, /Rival/);
  assert.ok(plan.blocks.indexOf(review) < plan.blocks.findIndex(b => b.id === 'unit'));

  const block = { ...review, base: baseline(s) };
  assert.equal(blockDone(s, block), false);
  s.log.push({ k: 'm' });
  assert.equal(blockDone(s, block), true);
  const game = { type: 'game', base: baseline(s) };
  s.games.push({ d: day(0) });
  assert.equal(blockDone(s, game), true);
  assert.equal(blockDone(s, { type: 'game' }), false, 'not started');
});

test('goal model: created from the puzzle rating, switches to a real one, and moves on when reached', () => {
  const s = fresh();
  s.puzzle.rating = 900;
  updateGoal(s, NOW);
  assert.equal(s.target.perf, PUZZLE_PERF);
  assert.equal(s.target.target, 1100);
  s.ratings.push({ platform: 'Lichess rapid', rating: 1180, date: day(0) });
  updateGoal(s, NOW);
  assert.equal(s.target.perf, 'Lichess rapid');
  assert.equal(s.target.target, 1400);
  assert.equal(goalStatus(s, NOW).current, 1180);
  s.ratings.push({ platform: 'Lichess rapid', rating: 1402, date: day(40) });
  const later = new Date(NOW.getTime() + 40 * 86400000);
  const m = updateGoal(s, later);
  assert.equal(m.target, 1400);
  assert.equal(s.milestones.length, 1);
  assert.equal(s.target.target, 1600);
  assert.equal(s.target.start.rating, 1402);
});

test('state v6: new fields default, migrate and validate', () => {
  assert.equal(CURRENT_VERSION, 6);
  const d = fresh();
  assert.equal(d.onboarded, false);
  assert.deepEqual(d.curriculum, { units: {}, current: null, placed: false });
  assert.ok(d.skills.tactics);
  const old = { ...fresh(), version: 5 };
  delete old.skills;
  delete old.curriculum;
  delete old.target;
  delete old.milestones;
  const m = migrate(old);
  assert.equal(m.version, 6);
  assert.ok(m.skills.safety);
  assert.ok(Array.isArray(m.milestones));
  assert.doesNotThrow(() => validate(m));
});
