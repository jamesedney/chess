// Re-check published puzzles with a deeper search: the first solver move must
// still be Stockfish's choice and still be winning.
//
//   node tools/verify-puzzles.mjs [--sample 50] [--depth 22] [--source generated]
import { Chess } from '../vendor/chess.js';
import { puzzles } from '../data/puzzles.js';
import { UciEngine } from './uci.mjs';
import { playUci } from '../src/chess-utils.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const depth = Number(arg('depth', 22));
const source = arg('source', 'generated');
const pool = puzzles.filter(p => source === 'all' || p.source === source);
const sample = pool.sort(() => Math.random() - 0.5).slice(0, Number(arg('sample', 50)));

const engine = await new UciEngine().init({ hash: 64 });
const problems = [];
for (const p of sample) {
  const g = new Chess(p.fen);
  if (p.setup) playUci(g, p.setup);
  const { top } = await engine.search(g.fen(), { depth });
  const winning = (top.mate ?? 0) > 0 || top.score >= 150;
  const mateAlternative = p.tags.includes('mate') && top.mate > 0;
  if (!winning || (top.pv[0] !== p.line[0] && !mateAlternative))
    problems.push({ id: p.id, expected: p.line[0], engine: top.pv[0], score: top.score, mate: top.mate });
}
engine.quit();
console.log(`${sample.length - problems.length}/${sample.length} confirmed at depth ${depth}.`);
if (problems.length) {
  console.table(problems);
  process.exitCode = 1;
}
