import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, logAttempt, validate } from '../../src/state.js';
import { diagnose, weekStart, buildPlan, planProgress, ensurePlan, trends } from '../../src/coach.js';
import { personalLessons } from '../../src/personal-lessons.js';

const NOW = new Date(2026, 9, 7, 12); // Wednesday 7 October 2026
const FEN = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';
let n = 0;
const mistake = (kind, extra = {}) => ({
  id: 'm' + (++n).toString(36),
  title: 'Instead of Qh4',
  fen: FEN,
  line: ['b8c6'],
  theme: 'Personal mistakes',
  tags: [],
  goal: 'Find the improvement.',
  explanation: 'x',
  played: 'Qh4',
  loss: 30,
  created: NOW.getTime() - 86400000,
  kind,
  ...extra,
});
const review = (marks, extra = {}) => ({
  id: 'r' + (++n).toString(36),
  complete: true,
  created: NOW.getTime() - 86400000,
  colour: 'w',
  result: '0-1',
  startFen: FEN,
  moves: [],
  evals: [],
  marks,
  ...extra,
});

test('no data means no diagnosis rather than a guess', () => {
  const d = diagnose(defaults(), NOW.getTime());
  assert.equal(d.confidence, 'none');
  assert.equal(d.focus, null);
  assert.deepEqual(d.findings, []);
});

test('the most common mistake kind becomes the focus', () => {
  const s = defaults();
  s.mistakes = [
    mistake('hung-piece'),
    mistake('hung-piece'),
    mistake('missed-tactic'),
    mistake('hung-piece', { created: NOW.getTime() - 200 * 86400000 }),
  ];
  s.reviews = [
    review([
      { ply: 1, cls: 'blunder' },
      { ply: 3, cls: 'blunder', cleared: true },
    ]),
    review([{ ply: 1, cls: 'mistake' }]),
  ];
  const d = diagnose(s, NOW.getTime());
  assert.equal(d.confidence, 'early');
  assert.equal(d.mistakes, 3, 'mistakes older than 90 days are left out');
  assert.equal(d.focus, 'hung-piece');
  assert.equal(d.blundersPerGame, 0.5, 'cleared marks do not count');
  assert.match(d.findings[0], /en prise \(2 of 3/);
});

test('rushed mistakes are reported when clock data shows them', () => {
  const s = defaults();
  const clocked = review(
    [
      { ply: 0, cls: 'blunder' },
      { ply: 2, cls: 'mistake' },
      { ply: 4, cls: 'blunder' },
    ],
    { tc: { base: 300, inc: 0 }, clocks: [299, 298, 297, 290, 296, 280] },
  );
  s.reviews = [clocked, review([]), review([])];
  s.mistakes = [mistake('positional'), mistake('positional'), mistake('positional')];
  const d = diagnose(s, NOW.getTime());
  assert.equal(d.timeIssue, 'rushed');
  assert.ok(d.findings.some(f => /in a hurry/.test(f)));
});

test('weeks start on Monday', () => {
  assert.equal(weekStart(NOW), '2026-10-05');
  assert.equal(weekStart(new Date(2026, 9, 5)), '2026-10-05');
  assert.equal(weekStart(new Date(2026, 9, 4)), '2026-09-28', 'Sunday belongs to the week before');
});

test('the plan targets the diagnosed weakness and tracks progress from the log', () => {
  const s = defaults();
  s.mistakes = [mistake('hung-piece'), mistake('hung-piece'), mistake('hung-piece')];
  const plan = buildPlan(s, diagnose(s, NOW.getTime()), '2026-10-05');
  const focus = plan.items.find(i => i.id === 'focus');
  assert.equal(focus.theme, 'Board vision');
  assert.equal(plan.items.find(i => i.id === 'drill').metric, 'vision');
  logAttempt(s, { kind: 'p', theme: 'Board vision', clean: true, date: '2026-10-06' });
  logAttempt(s, { kind: 'p', theme: 'Board vision', clean: false, date: '2026-10-06' });
  logAttempt(s, { kind: 'p', theme: 'Board vision', clean: true, date: '2026-10-01' });
  logAttempt(s, { kind: 'v', theme: 'sprint', clean: true, date: '2026-10-07' });
  const p = planProgress(s, plan);
  assert.equal(p.items.find(i => i.id === 'focus').done, 1, 'only clean solves this week count');
  assert.equal(p.items.find(i => i.id === 'days').done, 2);
  assert.equal(p.items.find(i => i.id === 'drill').done, 1);
  assert.ok(p.ratio > 0 && p.ratio < 1);
});

test('a new week adapts the targets to how the last one went', () => {
  const s = defaults();
  assert.equal(ensurePlan(s, NOW), true);
  assert.equal(ensurePlan(s, NOW), false, 'the same week keeps its plan');
  assert.equal(validate(s), null);
  const before = s.plan.items.find(i => i.id === 'focus').target;
  // Nothing done last week: the next plan is lighter.
  ensurePlan(s, new Date(2026, 9, 13));
  assert.equal(s.plan.history.at(-1).ratio, 0);
  assert.ok(s.plan.items.find(i => i.id === 'focus').target < before);
  assert.equal(s.plan.level, 0.8);
});

test('trends only call a change when the data supports it', () => {
  const s = defaults();
  let rows = trends(s, NOW);
  assert.ok(rows.every(r => r.verdict === 'unknown'));
  // 40 attempts each month at 50% and 52%: within noise.
  s.days['2026-10-01'] = { attempts: 40, clean: 21 };
  s.days['2026-08-20'] = { attempts: 40, clean: 20 };
  assert.equal(trends(s, NOW).find(r => r.id === 'accuracy').verdict, 'flat');
  // 90% against 50% is a real change.
  s.days['2026-10-01'] = { attempts: 40, clean: 36 };
  assert.equal(trends(s, NOW).find(r => r.id === 'accuracy').verdict, 'better');
  s.puzzle.history = [
    { date: '2026-08-01', rating: 900 },
    { date: '2026-09-01', rating: 1000 },
    { date: '2026-10-06', rating: 1100 },
  ];
  const puzzle = trends(s, NOW).find(r => r.id === 'puzzle');
  assert.equal(puzzle.verdict, 'better');
  assert.match(puzzle.text, /not playing strength/);
  s.ratings = [
    { rating: 1200, platform: 'Lichess rapid', date: '2026-08-15' },
    { rating: 1210, platform: 'Lichess rapid', date: '2026-10-01' },
  ];
  assert.equal(trends(s, NOW).find(r => r.id === 'real').verdict, 'flat');
});

test('personal lessons need three positions of one kind and play the user’s own positions', () => {
  const s = defaults();
  s.mistakes = [mistake('hung-piece'), mistake('hung-piece')];
  assert.deepEqual(personalLessons(s, NOW.getTime()), []);
  s.mistakes.push(mistake('hung-piece', { explanation: 'Qh4 left your queen on h4 exposed: Nxh4 wins material.' }));
  const [lesson] = personalLessons(s, NOW.getTime());
  assert.equal(lesson.id, 'my-hung-piece');
  assert.equal(lesson.steps.filter(st => st.kind === 'move').length, 3);
  const choice = lesson.steps.find(st => st.kind === 'choice');
  assert.equal(choice.options.filter(o => o.correct).length, 1);
  assert.ok(lesson.steps.filter(st => st.kind === 'move').every(st => st.engine && st.answers[0] === 'b8c6'));
  // Lesson progress ids must pass state validation.
  s.lessons[lesson.id] = { step: 2, done: false };
  assert.equal(validate(s), null);
});
