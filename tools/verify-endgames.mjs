// Check every endgame drill with Stockfish: wins must be winning, draws drawn.
// Usage: node tools/verify-endgames.mjs [--depth 26]
import { Chess } from 'chess.js';
import { UciEngine } from './uci.mjs';
import { ENDGAME_DRILLS } from '../data/endgames.js';

const depth = Number(process.argv[process.argv.indexOf('--depth') + 1]) || 26;
const engine = new UciEngine();
await engine.init();
let failed = 0;
for (const d of ENDGAME_DRILLS) {
  const g = new Chess(d.fen);
  const you = d.side || 'w';
  if (g.turn() !== you) throw new Error(`${d.id}: the user must move first`);
  const { top } = await engine.search(d.fen, { depth });
  const winning = top.mate > 0 || top.score > 500;
  const drawn = top.mate === null && Math.abs(top.score) < 80;
  const ok = d.goal === 'draw' ? drawn : winning;
  if (d.goal === 'mate' && top.mate > d.limit) failed++;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${d.id.padEnd(9)} ${top.mate !== null ? 'mate ' + top.mate : top.score}`);
}
engine.quit();
process.exit(failed ? 1 : 0);
