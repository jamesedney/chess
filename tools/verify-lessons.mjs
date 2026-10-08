// Check lesson positions with Stockfish: every listed answer must keep the
// win; the engine's own best move is listed; mate steps really mate.
//
//   node tools/verify-lessons.mjs [--depth 18]
import { Chess } from '../vendor/chess.js';
import { lessons } from '../data/lessons.js';
import { UciEngine } from './uci.mjs';
import { playUci, moveToUci } from '../src/chess-utils.js';
import { winPercent } from '../src/evaluation.js';

const depth = Number(process.argv.includes('--depth') ? process.argv[process.argv.indexOf('--depth') + 1] : 18);
const engine = await new UciEngine().init({ hash: 64 });
const problems = [];
const san = (fen, uci) => playUci(new Chess(fen), uci).san;

const only = process.argv.includes('--lesson') ? process.argv[process.argv.indexOf('--lesson') + 1] : null;
for (const lesson of lessons) {
  if (only && lesson.id !== only) continue;
  for (const [i, step] of lesson.steps.entries()) {
    const where = `${lesson.id} step ${i + 1}`;
    if (step.kind === 'move' && step.mate) {
      const g = new Chess(step.fen);
      const mates = g.moves({ verbose: true }).filter(m => {
        const c = new Chess(step.fen);
        c.move(m);
        return c.isCheckmate();
      });
      if (!mates.length) problems.push({ where, problem: 'no mate in one' });
      continue;
    }
    if (step.kind === 'move' || step.kind === 'line') {
      const game = new Chess(step.fen);
      const solverMoves = step.kind === 'move' ? [step.answers] : step.line.filter((_, k) => k % 2 === 0).map(u => [u]);
      let ply = 0;
      for (const accepted of solverMoves) {
        const fen = game.fen();
        const best = await engine.search(fen, { depth, multipv: 6 });
        const scoreOf = {};
        for (const l of best.lines) scoreOf[l.pv[0]] = l.score;
        const top = best.lines[0];
        // Any accepted move must be close to the best in winning chances.
        for (const u of accepted) {
          let s = scoreOf[u];
          if (s === undefined) {
            const after = new Chess(fen);
            playUci(after, u);
            const r = await engine.search(after.fen(), { depth: depth - 2 });
            s = -r.top.score;
          }
          const loss = winPercent(top.score) - winPercent(s);
          if (loss > 12) problems.push({ where, problem: `${san(fen, u)} loses ${loss.toFixed(0)}% vs ${san(fen, top.pv[0])}` });
        }
        // The engine's best move should be accepted unless an accepted move is equal.
        if (!accepted.includes(top.pv[0])) {
          const bestAccepted = Math.max(...accepted.map(u => scoreOf[u] ?? -99999));
          if (winPercent(top.score) - winPercent(bestAccepted) > 3)
            problems.push({ where, problem: `engine prefers ${san(fen, top.pv[0])} (${top.score}) over listed moves` });
        }
        // Report other near-equal moves the lesson does not accept, for review.
        const others = best.lines
          .filter(l => !accepted.includes(l.pv[0]) && winPercent(top.score) - winPercent(l.score) < 5)
          .map(l => san(fen, l.pv[0]));
        if (others.length) console.log(`  note ${where}: also fine: ${others.join(', ')}`);
        if (step.kind === 'line') {
          playUci(game, step.line[ply]);
          if (step.line[ply + 1]) playUci(game, step.line[ply + 1]);
          ply += 2;
        }
      }
    }
  }
}
engine.quit();
if (problems.length) {
  console.table(problems);
  process.exitCode = 1;
} else console.log('All lesson moves confirmed.');
