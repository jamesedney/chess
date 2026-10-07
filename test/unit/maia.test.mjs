import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Chess } from '../../vendor/chess.js';
import { loadWeights, forward, encode, moveProbabilities, sample } from '../../src/maia-core.js';

const tables = JSON.parse(fs.readFileSync(new URL('../../maia/tables.json', import.meta.url)));
const read = level => {
  const b = fs.readFileSync(new URL(`../../maia/maia-${level}.bin`, import.meta.url));
  return loadWeights(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
};

function predict(net, moves) {
  const g = new Chess();
  const fens = [g.fen()];
  for (const m of moves) {
    g.move(m);
    fens.push(g.fen());
  }
  const { policy, wdl } = forward(net, encode(fens));
  const legal = g.moves({ verbose: true }).map(m => m.from + m.to + (m.promotion || ''));
  return { probs: moveProbabilities(policy, legal, g.turn() === 'b', tables), wdl };
}

test('the converted tables have Leela’s sizes', () => {
  assert.equal(tables.index.length, 1858);
  assert.equal(tables.map.length, 73 * 64);
  assert.equal(new Set(tables.map.filter(x => x >= 0)).size, 1858);
});

test('input planes are drawn from the side to move’s point of view', () => {
  const start = encode([new Chess().fen()]);
  const plane = (p, i) => start.slice(p * 64 + i * 0, p * 64 + 64);
  assert.equal(
    plane(0).reduce((a, b) => a + b, 0),
    8,
    'eight of our pawns',
  );
  assert.equal(start[0 * 64 + 8], 1, 'our pawn on a2');
  assert.equal(start[6 * 64 + 48], 1, 'their pawn on a7');
  assert.equal(start[104 * 64], 1, 'we can castle long');
  assert.equal(start[108 * 64], 0, 'white to move');
  assert.equal(start[13 * 64 + 8], 0, 'no history before the start position');
  const g = new Chess();
  g.move('e4');
  const black = encode([new Chess().fen(), g.fen()]);
  assert.equal(black[108 * 64], 1, 'black to move');
  assert.equal(black[0 * 64 + 8], 1, 'black pawn a7 seen from Black is on a2');
  assert.equal(black[6 * 64 + 4 * 8 + 4], 1, 'white e4 pawn seen from Black is on e5');
  assert.equal(black[(13 + 6) * 64 + 6 * 8 + 4], 1, 'history: white pawn still on e2, mirrored to e7');
});

test('Maia 1100 predicts the moves people actually play', () => {
  const net = read(1100);
  const start = predict(net, []).probs;
  assert.equal(start[0].uci, 'e2e4');
  assert.ok(start[0].p > 0.6 && start[0].p < 0.72, String(start[0].p));
  const recapture = predict(net, ['e4', 'd5', 'exd5']).probs;
  assert.equal(recapture[0].uci, 'd8d5');
  assert.ok(recapture[0].p > 0.8);
  const ruy = predict(net, ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']).probs;
  assert.deepEqual(
    ruy.slice(0, 2).map(m => m.uci),
    ['b5c6', 'b5a4'],
  );
  const total = ruy.reduce((a, m) => a + m.p, 0);
  assert.ok(Math.abs(total - 1) < 1e-5);
});

test('stronger levels prefer stronger moves', () => {
  // After 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6, 1100 players exchange on c6 more often than 1900 players.
  const p1100 = predict(read(1100), ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']).probs.find(m => m.uci === 'b5c6').p;
  const p1900 = predict(read(1900), ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']).probs.find(m => m.uci === 'b5c6').p;
  assert.ok(p1100 > p1900, `${p1100} vs ${p1900}`);
});

test('promotions map to Leela’s move encoding', () => {
  const fen = '8/P6k/8/8/8/8/8/K7 w - - 0 1';
  const g = new Chess(fen);
  const net = read(1500);
  const legal = g.moves({ verbose: true }).map(m => m.from + m.to + (m.promotion || ''));
  const probs = moveProbabilities(forward(net, encode([fen])).policy, legal, false, tables);
  assert.equal(probs.length, legal.length);
  assert.equal(probs[0].uci, 'a7a8q');
  assert.ok(probs.every(m => m.p > 0 || m.uci.endsWith('n') === false));
});

test('sampling follows the distribution', () => {
  const probs = [
    { uci: 'a', p: 0.7 },
    { uci: 'b', p: 0.3 },
  ];
  assert.equal(
    sample(probs, () => 0.1),
    'a',
  );
  assert.equal(
    sample(probs, () => 0.9),
    'b',
  );
});
