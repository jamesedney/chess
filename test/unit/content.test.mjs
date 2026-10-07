import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Chess } from '../../vendor/chess.js';
import { puzzles } from '../../data/puzzles.js';
import { lessons, SECTIONS } from '../../data/lessons.js';
import { THEMES, PERSONAL } from '../../src/themes.js';
import { playUci } from '../../src/chess-utils.js';

test('every puzzle is legal, tagged and rated', () => {
  const ids = new Set();
  for (const p of puzzles) {
    assert.ok(!ids.has(p.id), 'duplicate id ' + p.id);
    ids.add(p.id);
    const g = new Chess(p.fen);
    if (p.setup) playUci(g, p.setup);
    assert.equal(p.line.length % 2, 1, `${p.id} line must end on the solver's move`);
    for (const u of p.line) playUci(g, u);
    assert.ok(THEMES.includes(p.theme), `${p.id} theme ${p.theme}`);
    assert.ok(p.rating >= 300 && p.rating <= 2600, `${p.id} rating ${p.rating}`);
    assert.ok(Array.isArray(p.tags) && p.tags.length, `${p.id} tags`);
    assert.ok(p.goal && p.explanation && p.title, `${p.id} text`);
    if (p.tags.includes('mate') || /checkmate/.test(p.goal)) assert.ok(g.isCheckmate(), `${p.id} should end in mate`);
  }
});

test('the original starter positions keep their ids so saved progress still applies', () => {
  for (let i = 1; i <= 26; i++) {
    const id = 'p' + String(i).padStart(3, '0');
    assert.ok(
      puzzles.some(p => p.id === id),
      id,
    );
    assert.ok(
      puzzles.some(p => p.id === id + 'b'),
      id + 'b',
    );
  }
});

test('the puzzle set is large, varied and within budget', () => {
  assert.ok(puzzles.length >= 300, `only ${puzzles.length} puzzles`);
  for (const t of THEMES) assert.ok(puzzles.filter(p => p.theme === t).length >= 15, `too few ${t} puzzles`);
  const ratings = puzzles.map(p => p.rating);
  assert.ok(Math.min(...ratings) <= 800 && Math.max(...ratings) >= 1600, 'covers beginner to club level');
  assert.ok(fs.statSync(new URL('../../data/puzzles.js', import.meta.url)).size < 1.5e6);
});

test('every lesson is well formed and every position is legal', () => {
  const ids = new Set();
  for (const l of lessons) {
    assert.ok(!ids.has(l.id) && /^[a-z0-9-]+$/.test(l.id), 'lesson id ' + l.id);
    ids.add(l.id);
    assert.ok(SECTIONS.includes(l.section), `${l.id}: section ${l.section}`);
    if (l.theme !== PERSONAL)
      assert.ok(
        puzzles.some(p => p.theme === l.theme),
        'No exercise for ' + l.theme,
      );
    assert.ok(l.steps.length >= 3, `${l.id}: too few steps`);
    assert.ok(
      l.steps.some(s => ['move', 'line', 'tap', 'choice'].includes(s.kind)),
      `${l.id}: nothing to do`,
    );
    for (const [i, s] of l.steps.entries()) {
      const where = `${l.id} step ${i + 1}`;
      assert.ok(s.text, where + ': no text');
      if (s.fen) new Chess(s.fen);
      for (const sq of s.highlight || []) assert.match(sq, /^[a-h][1-8]$/, where);
      for (const a of s.arrows || []) assert.match(a.from + a.to, /^([a-h][1-8]){2}$/, where);
      if (s.kind === 'read') continue;
      if (s.kind === 'cta') {
        assert.ok(s.label && ['train', 'review', 'play', 'progress', 'path'].includes(s.page), where);
        continue;
      }
      assert.ok(s.explain || s.kind === 'choice', where + ': no explanation');
      if (s.kind === 'choice') {
        assert.equal(s.options.filter(o => o.correct).length, 1, where + ': exactly one correct option');
        assert.ok(
          s.options.every(o => o.label && o.why),
          where + ': options need text',
        );
        continue;
      }
      assert.ok(s.fen, where + ': needs a position');
      const g = new Chess(s.fen);
      if (s.kind === 'tap') {
        assert.ok(s.targets.length && s.targets.every(t => /^[a-h][1-8]$/.test(t)), where);
      } else if (s.kind === 'move') {
        if (s.mate) {
          const mates = g.moves({ verbose: true }).filter(m => {
            const c = new Chess(s.fen);
            c.move(m);
            return c.isCheckmate();
          });
          assert.ok(mates.length >= 1, `${where}: no mate in one`);
        } else {
          assert.ok(s.answers.length, where);
          for (const u of s.answers) playUci(new Chess(s.fen), u);
        }
      } else if (s.kind === 'line') {
        assert.equal(s.line.length % 2, 1, where + ': line must end on the solver');
        for (const u of s.line) playUci(g, u);
      } else assert.fail(where + ': unknown kind ' + s.kind);
    }
  }
  assert.ok(lessons.length >= 12);
});
