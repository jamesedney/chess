import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineChart, evalGraph, activityGrid, barList } from '../../src/charts.js';

test('line chart has a table view and an end label', () => {
  const points = [
    { date: '2026-10-01', value: 950 },
    { date: '2026-10-02', value: 1010 },
    { date: '2026-10-03', value: 1043 },
  ];
  const html = lineChart('c', points, { title: 'Puzzle rating' });
  assert.equal((html.match(/<tr><td>/g) || []).length, 3);
  assert.match(html, /class="end-label"[^>]*>1,043</);
  assert.match(lineChart('c', points.slice(0, 1), { title: 'X' }), /after two days/);
});

test('titles are escaped', () => {
  assert.doesNotMatch(
    lineChart(
      'c',
      [
        { date: '2026-10-01', value: 1 },
        { date: '2026-10-02', value: 2 },
      ],
      { title: '<img onerror=x>' },
    ),
    /<img/,
  );
});

test('activity grid covers whole weeks ending today', () => {
  const today = new Date(2026, 9, 7); // a Wednesday
  const html = activityGrid({ '2026-10-07': { attempts: 8, clean: 8 }, '2026-10-06': { attempts: 2, clean: 1 } }, 8, { weeks: 4, today });
  const cells = html.match(/class="day l\d"/g).length - 3; // minus the legend
  assert.equal(cells, 3 * 7 + 3, 'three full weeks plus Monday to Wednesday');
  assert.match(html, /l2" title="[^"]*8 positions/);
  assert.match(html, /l1" title="[^"]*2 positions/);
});

test('evaluation graph marks only mistakes and blunders, blunders larger', () => {
  const html = evalGraph(
    'e',
    [0, 20, -300, -900, null],
    [
      { ply: 1, cls: 'inaccuracy' },
      { ply: 2, cls: 'blunder' },
    ],
  );
  assert.equal((html.match(/eval-mark/g) || []).length, 1);
  assert.match(html, /eval-mark blunder[^>]*r="6.5"/);
});

test('bar list clamps widths', () => {
  assert.match(barList([{ label: 'A', value: 150, max: 100 }]), /width:100%/);
});
