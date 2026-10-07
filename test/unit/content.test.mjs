import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Chess } from '../../vendor/chess.js';
import { puzzles } from '../../data/puzzles.js';
import { lessons } from '../../data/lessons.js';
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

test('every practical lesson has puzzles and valid worked examples', () => {
  for (const l of lessons) {
    if (l.theme !== PERSONAL)
      assert.ok(
        puzzles.some(p => p.theme === l.theme),
        'No exercise for ' + l.theme,
      );
    for (const ex of l.examples) {
      const g = new Chess(ex.fen);
      assert.ok(ex.prompt && ex.explain, l.title);
      if (ex.kind === 'answers') {
        for (const u of ex.answers) playUci(new Chess(ex.fen), u);
      } else if (ex.kind === 'mate') {
        const mates = g.moves({ verbose: true }).filter(m => {
          const c = new Chess(ex.fen);
          c.move(m);
          return c.isCheckmate();
        });
        assert.ok(mates.length >= 1, `${l.title}: no mate in ${ex.fen}`);
      } else if (ex.kind === 'line') {
        assert.equal(ex.line.length % 2, 1);
        for (const u of ex.line) playUci(g, u);
      } else assert.fail('unknown example kind ' + ex.kind);
    }
  }
});
