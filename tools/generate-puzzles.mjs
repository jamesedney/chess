// Generate tactics puzzles by mining self-play games, following the same idea
// as the Lichess puzzle generator: find a blunder, then keep the winning reply
// only while every move for the solver is the single clearly-best move.
//
// Usage: node tools/generate-puzzles.mjs --minutes 60 --workers 4
// Output is appended to tools/data/generated-raw.jsonl; run
// tools/build-puzzles.mjs afterwards to tag, rate and publish them.
import fs from 'node:fs';
import { Chess } from '../vendor/chess.js';
import { UciEngine } from './uci.mjs';
import { OPENINGS } from './openings.mjs';
import { winPercent } from '../src/evaluation.js';
import { moveToUci, playUci, VALUES } from '../src/chess-utils.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const OUT = args.out || 'tools/data/generated-raw.jsonl';
const WORKERS = Number(args.workers || 4);
const MINUTES = Number(args.minutes || 30);
const TARGET = Number(args.target || 100000);
const deadline = Date.now() + MINUTES * 60000;

const seen = new Set();
if (fs.existsSync(OUT)) {
  for (const line of fs.readFileSync(OUT, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      seen.add(key(JSON.parse(line).fen));
    } catch {}
  }
}
let produced = 0;
let games = 0;

function key(fen) {
  return fen.split(' ').slice(0, 4).join(' ');
}
const rand = n => Math.floor(Math.random() * n);

async function selfPlay(engine) {
  const game = new Chess();
  const book = OPENINGS[rand(OPENINGS.length)].split(' ');
  const bookLength = 2 + rand(Math.max(1, book.length - 1));
  for (const san of book.slice(0, bookLength)) game.move(san);
  const skill = { w: rand(10), b: rand(10) };
  const evals = [];
  await engine.newGame();
  while (!game.isGameOver() && game.history().length < 220) {
    const fen = game.fen();
    await engine.setOptions({ 'Skill Level': 20 });
    const quick = await engine.search(fen, { depth: 9 });
    if (!quick.top) break;
    evals.push({ fen, score: quick.top.score, mate: quick.top.mate });
    await engine.setOptions({ 'Skill Level': skill[game.turn()] });
    // Stockfish picks its handicapped move at depth 1 + skill, so search no deeper.
    const pick = await engine.search(fen, { depth: skill[game.turn()] + 2 });
    if (!pick.best || pick.best === '(none)') break;
    playUci(game, pick.best);
  }
  evals.push({ fen: game.fen(), score: null, mate: null });
  return { moves: game.history({ verbose: true }).slice(bookLength), evals };
}

function findCandidates({ moves, evals }) {
  const out = [];
  for (let i = 0; i < moves.length && i + 1 < evals.length; i++) {
    const before = evals[i];
    const after = evals[i + 1];
    if (before.score === null || after.score === null) continue;
    const loss = winPercent(before.score) - winPercent(-after.score);
    const blunder = loss >= 30 && winPercent(after.score) >= 70;
    // Allowing a short mate counts too; the build step caps how many mates are kept.
    const allowedMate = after.mate !== null && after.mate > 0 && after.mate <= 4 && before.mate === null;
    if (blunder || allowedMate)
      out.push({ fen: before.fen, setup: moveToUci(moves[i]), setupMove: moves[i], puzzleFen: after.fen, ply: i });
  }
  return out;
}

function isUnique(b1, b2, game) {
  if (game.moves().length < 2) return false;
  if (!b2) return true;
  if (b1.mate !== null && b1.mate > 0) {
    if (b2.mate === null || b2.mate <= 0) return true;
    return b1.mate === 1 || b2.mate >= b1.mate + 2;
  }
  return winPercent(b1.score) - winPercent(b2.score) >= 22;
}

function discoveryDepth(history, best) {
  let depth = null;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].move !== best) break;
    depth = history[i].depth;
  }
  return depth;
}

async function buildPuzzle(engine, cand) {
  await engine.setOptions({ 'Skill Level': 20 });
  const game = new Chess(cand.puzzleFen);
  const line = [];
  let first = null;
  let matePuzzle = false;
  for (let step = 0; step < 4; step++) {
    const r = await engine.search(game.fen(), { depth: 18, multipv: 2 });
    const [b1, b2] = r.lines;
    if (!b1) break;
    if (step === 0) {
      first = { score: b1.score, mate: b1.mate, discovery: discoveryDepth(r.history, b1.pv[0]), second: b2 ? b2.score : null };
      matePuzzle = b1.mate !== null && b1.mate > 0 && b1.mate <= 4;
    }
    // Mate puzzles always run to mate: the trainer accepts any equally fast mate.
    if (!(matePuzzle && step > 0 && b1.mate !== null && b1.mate > 0) && !isUnique(b1, b2, game)) break;
    if (b1.mate === null && b1.score < (step === 0 ? 200 : 150)) break;
    playUci(game, b1.pv[0]);
    line.push(b1.pv[0]);
    if (game.isGameOver() || step === 3) break;
    const d = await engine.search(game.fen(), { depth: 16 });
    if (!d.best || d.best === '(none)') break;
    playUci(game, d.best);
    line.push(d.best);
  }
  if (line.length % 2 === 0) line.pop();
  if (!line.length) return null;
  if (matePuzzle && !new Chess(cand.puzzleFen).isGameOver()) {
    const end = new Chess(cand.puzzleFen);
    for (const u of line) playUci(end, u);
    if (!end.isCheckmate()) return null;
  }
  // A one-move "puzzle" that just recaptures a traded piece is not a puzzle.
  if (line.length === 1 && cand.setupMove.captured) {
    const g = new Chess(cand.puzzleFen);
    const m = playUci(g, line[0]);
    if (m.to === cand.setupMove.to && (VALUES[m.captured] || 0) <= VALUES[cand.setupMove.captured] + 1) return null;
  }
  return { fen: cand.fen, setup: cand.setup, line, ply: cand.ply, ...first, source: 'generated' };
}

async function worker(id) {
  const engine = await new UciEngine().init({ hash: 64 });
  while (Date.now() < deadline && produced < TARGET) {
    const played = await selfPlay(engine);
    games++;
    const candidates = findCandidates(played)
      .sort(() => Math.random() - 0.5)
      .slice(0, 6);
    for (const cand of candidates) {
      if (Date.now() > deadline) break;
      if (seen.has(key(cand.puzzleFen))) continue;
      seen.add(key(cand.puzzleFen));
      const puzzle = await buildPuzzle(engine, cand);
      if (!puzzle) continue;
      fs.appendFileSync(OUT, JSON.stringify(puzzle) + '\n');
      produced++;
    }
    if (games % 5 === 0) console.log(`[${new Date().toISOString().slice(11, 19)}] games ${games} · puzzles ${produced}`);
  }
  engine.quit();
}

await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(i)));
console.log(`Done. ${games} games, ${produced} new puzzles in ${OUT}.`);
process.exit(0);
