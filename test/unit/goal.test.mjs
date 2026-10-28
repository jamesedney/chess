import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, migrate, validate, CURRENT_VERSION } from '../../src/state.js';
import { makeGoal, nextTarget, projection, trendSlope, paceFor } from '../../src/goal.js';
import { mainPerf, mergeRatings, lichessRatings, chessComRatings, seriesFor } from '../../src/ratings.js';
import { skillsOf, seedSkills, recordSkillPuzzle, leaks, skillMap } from '../../src/skills.js';
import { planSession, baseline, blockDone } from '../../src/program.js';
import { updateGoal, goalStatus, PUZZLE_PERF } from '../../src/progress-model.js';
import { SKILLS, OBJECTIVES } from '../../data/skills.js';
import { lessons as LESSONS } from '../../data/lessons.js';
import { puzzles } from '../../data/puzzles.js';

const NOW = new Date('2026-10-08T12:00:00Z');
const day = n => new Date(NOW.getTime() + n * 86400000).toISOString().slice(0, 10);
const fresh = () => defaults();
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

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

test('goal: a new goal is on track on day one, whatever the rating and time', () => {
  for (let rating = 400; rating <= 2400; rating += 37)
    for (const minutes of [10, 20, 30, 45, 60]) {
      const goal = makeGoal({ perf: 'X', rating, minutes, now: NOW });
      const p = projection(goal, [{ date: day(0), rating }], NOW);
      assert.equal(p.status, 'on-track', `${rating} at ${minutes} min: projected ${p.projected} for ${goal.target}`);
    }
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
  // Auto follows what you play most; rapid wins a tie.
  assert.equal(mainPerf({ rapid: 12, blitz: 300 }), 'blitz');
  assert.equal(mainPerf({ rapid: 30, blitz: 30 }), 'rapid');
  assert.equal(mainPerf({ bullet: 900, blitz: 5 }), 'blitz', 'bullet only when chosen');
  assert.equal(mainPerf({}), null);
  // A chosen time control wins when there are games in it.
  assert.equal(mainPerf({ rapid: 300, blitz: 12 }, 'blitz'), 'blitz');
  assert.equal(mainPerf({ rapid: 300, bullet: 40 }, 'bullet'), 'bullet');
  assert.equal(mainPerf({ rapid: 300 }, 'blitz'), 'rapid', 'falls back when none');

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
  const b = await lichessRatings('me', lichess, NOW.getTime(), 'blitz');
  assert.equal(b.perf, 'Lichess blitz');
  assert.equal(b.rating, 1050);
  assert.equal(r.rating, 1180);
  assert.deepEqual(r.history, [{ date: '2026-09-01', rating: 1160 }]);
  // Every time control played, for the tiles on Today.
  assert.deepEqual(r.all, { 'Lichess blitz': 1050, 'Lichess rapid': 1180 });
  await assert.rejects(
    lichessRatings('nobody', async () => json({}, 404)),
    /No Lichess account/,
  );
});

test('ratings: Chess.com reads the newest rating from stats or games, with history from the games', async () => {
  const at = (d, h = 12) => Date.parse(`${day(d)}T${String(h).padStart(2, '0')}:00:00Z`) / 1000;
  const game = (d, h, colour, rating, extra = {}) => ({
    rules: 'chess',
    rated: true,
    time_class: 'blitz',
    end_time: at(d, h),
    white: colour === 'w' ? { username: 'Me', rating } : { username: 'rival', rating: 1000 },
    black: colour === 'b' ? { username: 'Me', rating } : { username: 'rival', rating: 1000 },
    ...extra,
  });
  const months = {
    'https://api.chess.com/m/09': [game(-20, 10, 'w', 940), game(-20, 18, 'b', 950)],
    'https://api.chess.com/m/10': [
      game(-1, 12, 'w', 990),
      game(0, 9, 'b', 1005),
      game(0, 10, 'w', 1200, { time_class: 'rapid' }), // another time control
      game(0, 11, 'w', 1300, { rated: false }), // unrated
    ],
  };
  const server = statsLast => async url => {
    if (url.endsWith('/stats'))
      return json({
        chess_blitz: { last: statsLast, record: { win: 20, loss: 20, draw: 2 } },
        chess_rapid: { last: { rating: 1200, date: at(0) }, record: { win: 1 } },
      });
    if (url.endsWith('/games/archives')) return json({ archives: Object.keys(months) });
    return json({ games: months[url] });
  };
  // Stats last updated three days ago: the games played since are newer.
  const fromGames = await chessComRatings('Me', server({ rating: 980, date: at(-3) }), 'auto', NOW.getTime());
  assert.equal(fromGames.perf, 'Chess.com blitz');
  assert.equal(fromGames.rating, 1005);
  assert.deepEqual(fromGames.history, [
    { date: day(-20), rating: 950 },
    { date: day(-1), rating: 990 },
    { date: day(0), rating: 1005 },
  ]);
  // Stats newer than every game win.
  const fromStats = await chessComRatings('Me', server({ rating: 1010, date: at(0, 23) }), 'auto', NOW.getTime());
  assert.equal(fromStats.rating, 1010);
  // The games list failing still gives the stats rating.
  const noGames = await chessComRatings(
    'Me',
    async url => (url.endsWith('/stats') ? server({ rating: 980, date: at(-3) })(url) : json({}, 500)),
    'auto',
    NOW.getTime(),
  );
  assert.deepEqual(noGames, {
    perf: 'Chess.com blitz',
    rating: 980,
    history: [],
    all: { 'Chess.com blitz': 980, 'Chess.com rapid': 1200 },
  });
  await assert.rejects(
    chessComRatings('ghost', async () => json({}, 404)),
    /No Chess.com account/,
  );
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
});

test('planner: a session fits the time and always holds a Nemesis game with the gate', () => {
  const s = fresh();
  s.puzzle.rating = 1180;
  s.skills = seedSkills(1180);
  s.minutes = 20;
  const plan = planSession(s, { now: NOW.getTime(), goalStatus: 'on-track', target: 1400 });
  const ids = plan.blocks.map(b => b.id);
  assert.ok(ids.includes('nemesis'), ids.join());
  assert.ok(ids.includes('game'), 'a game when none was played recently');
  const nemesis = plan.blocks.find(b => b.id === 'nemesis');
  assert.equal(nemesis.type, 'nemesis');
  assert.equal(nemesis.params.nemesis, 1);
  assert.ok(nemesis.params.objective, 'the habit rides along as the objective');
  assert.equal(nemesis.optional, undefined, 'never optional');
  assert.ok(!ids.includes('unit') && !ids.includes('lesson') && !ids.includes('drill'), 'no curriculum');
  assert.ok(plan.blocks.every(b => b.status === 'todo'));
  assert.equal(plan.unit, undefined);

  // More time adds the optional blocks; behind adds volume to the weak-skill puzzles.
  s.minutes = 60;
  const long = planSession(s, { now: NOW.getTime(), goalStatus: 'behind', target: 1400 });
  assert.ok(long.blocks.length > plan.blocks.length);
  const weak = long.blocks.find(b => b.id === 'weak');
  assert.equal(weak.count, 8);
  assert.equal(weak.params.strict, 1);
  assert.ok(weak.params.tags.length, 'tags come from the skill, not a unit');

  // A recent game makes the game optional; with ten minutes it drops out, Nemesis stays.
  s.minutes = 10;
  s.games.push({ d: day(0) });
  const short = planSession(s, { now: NOW.getTime(), goalStatus: 'on-track', target: 1400 });
  assert.ok(!short.blocks.some(b => b.id === 'game'));
  assert.ok(short.blocks.some(b => b.id === 'nemesis'));
});

test('planner: a fresh game review comes first and blocks know when they are done', () => {
  const s = fresh();
  s.puzzle.rating = 1180;
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
      marks: [{ ply: 0, mistakeId: 'm1', cls: 'mistake', loss: 20, bestSan: 'e4' }],
    },
  ];
  // A fresh game is debriefed first: its decisive moments and why they went wrong.
  const first = planSession(s, { now: NOW.getTime(), target: 1400 });
  const debrief = first.blocks.find(b => b.id === 'debrief');
  assert.ok(debrief, first.blocks.map(b => b.id).join());
  assert.match(debrief.title, /Debrief: your game against Rival/);
  assert.deepEqual(debrief.params, { review: 'r1', debrief: 1 });
  assert.equal(first.blocks[0].id === 'debrief' || first.blocks[1].id === 'debrief', true);
  const started = { ...debrief, base: baseline(s) };
  assert.equal(blockDone(s, started), false);
  s.reviews[0].marks[0].reason = 'chance';
  s.reviews[0].debriefed = true;
  assert.equal(blockDone(s, started), true);
  // Once debriefed, its saved positions are drilled instead.
  const plan = planSession(s, { now: NOW.getTime(), target: 1400 });
  assert.ok(!plan.blocks.some(b => b.id === 'debrief'));
  const review = plan.blocks.find(b => b.id === 'review');
  assert.ok(review, plan.blocks.map(b => b.id).join());
  assert.match(review.title, /Rival/);
  assert.ok(plan.blocks.indexOf(review) < plan.blocks.findIndex(b => b.id === 'nemesis'));

  const block = { ...review, base: baseline(s) };
  assert.equal(blockDone(s, block), false);
  s.log.push({ k: 'm' });
  assert.equal(blockDone(s, block), true);
  const game = { type: 'game', base: baseline(s) };
  const nemesis = { type: 'nemesis', base: baseline(s) };
  s.games.push({ d: day(0) });
  assert.equal(blockDone(s, game), true);
  assert.equal(blockDone(s, nemesis), true);
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

test('goal model: choosing another time control moves the goal to it', () => {
  const s = fresh();
  s.ratings.push({ platform: 'Lichess rapid', rating: 1180, date: day(0) });
  s.sync.followed = ['Lichess rapid'];
  updateGoal(s, NOW);
  assert.equal(s.target.perf, 'Lichess rapid');
  // The next sync fetched blitz because blitz was chosen.
  s.ratings.push({ platform: 'Lichess blitz', rating: 1050, date: day(0) });
  s.sync.followed = ['Lichess blitz'];
  updateGoal(s, NOW);
  assert.equal(s.target.perf, 'Lichess blitz');
  assert.equal(s.target.start.rating, 1050);
  assert.equal(s.target.target, 1200);
  assert.equal(goalStatus(s, NOW).current, 1050);
  // Back to rapid.
  s.sync.followed = ['Lichess rapid'];
  updateGoal(s, NOW);
  assert.equal(s.target.perf, 'Lichess rapid');
});

test('state v6: new fields default, migrate and validate', () => {
  assert.ok(CURRENT_VERSION >= 6);
  const d = fresh();
  assert.equal(d.onboarded, false);
  assert.equal(d.curriculum, undefined, 'the curriculum went in 6.0');
  assert.deepEqual(d.gate, { stage: 3, set: 'default', since: null });
  assert.deepEqual(d.experiments, []);
  assert.equal(d.settings.nemesis, false);
  assert.ok(d.skills.tactics);
  const old = { ...fresh(), version: 5 };
  delete old.skills;
  delete old.curriculum;
  delete old.target;
  delete old.milestones;
  const m = migrate(old);
  assert.equal(m.version, CURRENT_VERSION);
  assert.ok(m.skills.safety);
  assert.ok(Array.isArray(m.milestones));
  assert.doesNotThrow(() => validate(m));
  // A 5.x state with its curriculum: 6.0 drops it and adds the gate, Proof and the Nemesis setting.
  const v10 = {
    ...fresh(),
    version: 10,
    curriculum: { units: { 'f-scan': { tries: 0, clean: 0, recent: [], done: true } }, current: null, placed: true },
  };
  delete v10.gate;
  delete v10.experiments;
  delete v10.settings.nemesis;
  const m11 = migrate(v10);
  assert.equal(m11.version, CURRENT_VERSION);
  assert.equal(m11.curriculum, undefined);
  assert.deepEqual(m11.gate, { stage: 3, set: 'default', since: null });
  assert.deepEqual(m11.experiments, []);
  assert.equal(m11.settings.nemesis, false);
  assert.equal(validate(m11), null);
});
