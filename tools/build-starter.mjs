// Rebuild the hand-picked starter set (tools/data/starter.json) from composed
// positions and classic miniatures, with Stockfish choosing the continuation.
//
//   node tools/build-starter.mjs
//
// Note: this renumbers the starter ids (p001…). Saved progress is keyed by id,
// so only run it when you intend to replace the starter set.
import fs from 'node:fs';
import { Chess } from '../vendor/chess.js';
import { UciEngine } from './uci.mjs';
import { playUci } from '../src/chess-utils.js';

const seeds = [
  [
    'Back-rank finish',
    '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1',
    'King safety',
    'A king trapped behind its pawns is vulnerable to a rook entering the back rank.',
  ],
  [
    'Queen and king',
    '7k/8/5KQ1/8/8/8/8/8 w - - 0 1',
    'Endgames',
    'Use your king to protect your queen. Give check while covering every escape square.',
  ],
  [
    'Knight fork',
    '3q3k/6pp/8/4N3/8/8/6PP/R5K1 w - - 0 1',
    'Tactics',
    'A check gains time. Look for a knight move that attacks the king and queen together.',
  ],
  [
    'Remove the queen',
    '6k1/5ppp/8/8/3q4/8/3R1PPP/6K1 w - - 0 1',
    'Board vision',
    'Before calculating anything complicated, scan for an undefended piece you can capture.',
  ],
  [
    'Promotion race',
    '7k/P7/6K1/8/8/8/8/8 w - - 0 1',
    'Endgames',
    'Passed pawns become stronger pieces. Check whether promotion comes with a forcing threat.',
  ],
  [
    'Rook on the seventh',
    '7k/5K2/8/8/8/8/R7/8 w - - 0 1',
    'Endgames',
    'The attacking king cuts off escape squares. Find the rook check that finishes the job.',
  ],
  [
    'Two-rook ladder',
    '7k/8/8/8/8/8/R7/1R4K1 w - - 0 1',
    'Endgames',
    'One rook takes away a rank while the other delivers check. Coordinate both rooks.',
  ],
  [
    'Long diagonal',
    '6k1/5ppp/8/8/8/2B5/8/6KQ w - - 0 1',
    'King safety',
    'Trace the queen’s diagonal towards the king and check which squares are defended.',
  ],
];
const games = [
  [
    'Opera game',
    '1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8#',
  ],
  ['Legal’s trap', '1. e4 e5 2. Nf3 d6 3. Bc4 Bg4 4. Nc3 g6 5. Nxe5 Bxd1 6. Bxf7+ Ke7 7. Nd5#'],
  ['Scholar’s attack', '1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#'],
  ['Blackburne’s trap', '1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 5. Nxf7 Qxg2 6. Rf1 Qxe4+ 7. Be2 Nf3#'],
  [
    'Opening punishment',
    '1. e4 e5 2. Nf3 f6 3. Nxe5 fxe5 4. Qh5+ Ke7 5. Qxe5+ Kf7 6. Bc4+ d5 7. Bxd5+ Kg6 8. h4 h5 9. Bxb7 Bxb7 10. Qf5+ Kh6 11. d4+ g5 12. Qf7',
  ],
  [
    'Greco’s attack',
    '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O Nf6 5. d4 exd4 6. e5 d5 7. exf6 dxc4 8. Re1+ Be6 9. Ng5 Qd5 10. Nc3 Qf5 11. g4 Qg6 12. Nce4 Bb6 13. fxg7 Rg8 14. Nxe6 fxe6 15. Ng5 Rxg7 16. Rxe6+',
  ],
];

const engine = await new UciEngine().init();
await engine.setOptions({ MultiPV: 2 });
const candidates = seeds.map(([title, fen, theme, explanation]) => ({ title, fen, theme, explanation }));
for (const [name, pgn] of games) {
  const g = new Chess();
  g.loadPgn(pgn);
  const moves = g.history();
  g.reset();
  moves.forEach((san, n) => {
    if (n >= 5)
      candidates.push({ title: `${name} · move ${Math.floor(n / 2) + 1}`, fen: g.fen(), theme: n < 14 ? 'Opening habits' : 'Calculation' });
    g.move(san);
  });
}

const starter = [];
for (const c of candidates) {
  if (new Chess(c.fen).isGameOver()) continue;
  const r = await engine.search(c.fen, { depth: 14, multipv: 2 });
  const [best, second] = r.lines;
  if (!best || !second) continue;
  const singleMate = best.mate === 1;
  const uniqueMate = best.mate > 0 && (!second.mate || second.mate > best.mate);
  if (!(singleMate || uniqueMate || (best.score >= 100 && best.score - second.score >= 160))) continue;
  let length = singleMate || c.theme === 'Board vision' ? 1 : Math.min(5, best.pv.length);
  if (length % 2 === 0) length--;
  const g = new Chess(c.fen);
  const line = [];
  for (const u of best.pv.slice(0, length)) {
    try {
      playUci(g, u);
      line.push(u);
    } catch {
      break;
    }
  }
  if (line.length % 2 === 0) line.pop();
  if (!line.length) continue;
  if (singleMate && c.theme !== 'Endgames') c.theme = 'King safety';
  starter.push({ id: 'p' + String(starter.length + 1).padStart(3, '0'), ...c, line, source: 'starter' });
}

// Colour-swapped reflections train both colours.
const mirrorSq = s => s[0] + (9 - Number(s[1]));
for (const p of [...starter]) {
  const g = new Chess(p.fen);
  const out = new Chess();
  out.clear();
  for (const row of g.board())
    for (const x of row) if (x) out.put({ type: x.type, color: x.color === 'w' ? 'b' : 'w' }, mirrorSq(x.square));
  const f = out.fen().split(' ');
  const src = p.fen.split(' ');
  f[1] = src[1] === 'w' ? 'b' : 'w';
  f[2] =
    src[2] === '-'
      ? '-'
      : src[2]
          .split('')
          .map(x => (x === x.toUpperCase() ? x.toLowerCase() : x.toUpperCase()))
          .sort((a, b) => 'KQkq'.indexOf(a) - 'KQkq'.indexOf(b))
          .join('');
  f[3] = src[3] === '-' ? '-' : mirrorSq(src[3]);
  starter.push({
    ...p,
    id: p.id + 'b',
    title: p.title + ' · reversed colours',
    fen: f.join(' '),
    line: p.line.map(u => mirrorSq(u.slice(0, 2)) + mirrorSq(u.slice(2, 4)) + (u[4] || '')),
  });
}

fs.writeFileSync(new URL('./data/starter.json', import.meta.url), JSON.stringify(starter, null, 1));
engine.quit();
console.log(`Wrote ${starter.length} starter puzzles. Now run: node tools/build-puzzles.mjs`);
process.exit(0);
