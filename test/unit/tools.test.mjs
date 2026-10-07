import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseRow, goodQuality, BandSampler, importLichess } from '../../tools/import-lichess.mjs';
import { finalize, balance, serialise, stableId, goalFor } from '../../tools/build-puzzles.mjs';
import { Chess } from '../../vendor/chess.js';
import { playUci } from '../../src/chess-utils.js';

// The first row of the public Lichess puzzle database, in its CSV format.
const REAL =
  '00008,r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24,f2g3 e6e7 b2b1 b3c1 b1c1 h6c1,1913,75,94,6302,crushing hangingPiece long middlegame,https://lichess.org/787zsVup/black#47,';
const HEADER = 'PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags';

function row(id, rating, extra = {}) {
  return [
    id,
    '6k1/5ppp/8/8/8/3q4/3R1PPP/6K1 b - - 0 1',
    'd3d4 d2d4',
    rating,
    extra.dev ?? 75,
    extra.pop ?? 95,
    extra.plays ?? 1000,
    'hangingPiece oneMove middlegame',
    'https://lichess.org/x',
    '',
  ].join(',');
}

test('Lichess rows parse into setup move and solution', () => {
  const r = parseRow(REAL);
  assert.equal(r.lichessId, '00008');
  assert.equal(r.setup, 'f2g3');
  assert.deepEqual(r.line, ['e6e7', 'b2b1', 'b3c1', 'b1c1', 'h6c1']);
  assert.equal(r.rating, 1913);
  assert.ok(r.tags.includes('hangingPiece'));
  const g = new Chess(r.fen);
  playUci(g, r.setup);
  for (const u of r.line) playUci(g, u);
  assert.equal(parseRow(HEADER), null);
  assert.equal(goodQuality(r), true);
  assert.equal(goodQuality({ ...r, deviation: 200 }), false);
});

test('band sampling spreads puzzles across ratings', () => {
  const s = new BandSampler({ count: 4, min: 600, max: 1000, rng: () => 0.5 });
  for (let i = 0; i < 100; i++) s.add({ rating: 600 + (i % 4) * 100 + 5, id: i });
  s.add({ rating: 1500 });
  const out = s.result();
  assert.equal(out.length, 4);
  assert.deepEqual(out.map(r => Math.floor(r.rating / 100)).sort(), [6, 7, 8, 9]);
});

test('import reads plain and zstd-compressed CSV', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rankup-'));
  const csv = [HEADER, REAL, row('a1', 700), row('a2', 820), row('a3', 950, { dev: 300 }), row('a4', 1210)].join('\n');
  const plain = path.join(dir, 'p.csv');
  fs.writeFileSync(plain, csv);
  const zst = path.join(dir, 'p.csv.zst');
  fs.writeFileSync(zst, zlib.zstdCompressSync(Buffer.from(csv)));
  for (const input of [plain, zst]) {
    const { rows } = await importLichess({ input, count: 20, min: 500, max: 2000 });
    assert.deepEqual(rows.map(r => r.lichessId).sort(), ['00008', 'a1', 'a2', 'a4']);
  }
});

test('build step tags, rates and serialises puzzles', async () => {
  const lichess = parseRow(REAL);
  const p = finalize({ ...lichess, id: 'l' + lichess.lichessId, source: 'lichess' });
  assert.equal(p.rating, 1913, 'Lichess ratings are kept');
  assert.equal(p.theme, 'Board vision');
  assert.equal(p.setup, 'f2g3');
  assert.ok(p.explanation.length > 10);
  const generated = finalize({
    fen: '6k1/5ppp/8/8/8/3q4/3R1PPP/6K1 b - - 0 1',
    setup: 'd3d4',
    line: ['d2d4'],
    score: 900,
    discovery: 1,
    id: 'gx',
    source: 'generated',
  });
  assert.ok(generated.rating >= 500 && generated.rating < 1000, 'free queen is easy: ' + generated.rating);
  assert.equal(goalFor(['mate', 'mateIn2'], ['a', 'b', 'c']), 'Deliver checkmate in 2.');
  assert.match(stableId('g', { fen: 'x', setup: 'y' }), /^g[0-9a-f]{8}$/);
  const mates = Array.from({ length: 10 }, (_, i) => ({ id: 'm' + i, tags: ['mate', 'mateIn1'] }));
  const others = Array.from({ length: 13 }, (_, i) => ({ id: 'o' + i, tags: ['fork'] }));
  assert.equal(balance([...mates, ...others]).filter(x => x.tags.includes('mate')).length, 7);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rankup-'));
  const file = path.join(dir, 'puzzles.mjs');
  fs.writeFileSync(file, serialise([p, generated]));
  const mod = await import(file);
  assert.equal(mod.puzzles.length, 2);
});
