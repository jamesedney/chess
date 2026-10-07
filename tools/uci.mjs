// Minimal UCI client for running Stockfish.js under Node in the build tools.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { parseInfo, parseBestMove } from '../src/uci-parse.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CANDIDATES = ['node_modules/stockfish/src/stockfish-17.1-lite-single-03e3232.js', 'vendor/stockfish-17.1-lite-single-03e3232.js'];

export function stockfishPath() {
  for (const c of CANDIDATES) {
    const full = path.join(root, c);
    // The vendored copy needs its .wasm next to it, which the repo provides.
    if (fs.existsSync(full)) return full;
  }
  throw new Error('Stockfish not found. Run npm ci first.');
}

export class UciEngine {
  constructor(script = stockfishPath()) {
    this.proc = spawn(process.execPath, [script], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.buffer = '';
    this.listeners = new Set();
    this.options = {};
    this.proc.stdout.on('data', chunk => {
      this.buffer += chunk;
      let i;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, i).trim();
        this.buffer = this.buffer.slice(i + 1);
        for (const fn of [...this.listeners]) fn(line);
      }
    });
  }

  send(cmd) {
    this.proc.stdin.write(cmd + '\n');
  }

  waitFor(predicate) {
    return new Promise(resolve => {
      const fn = line => {
        if (predicate(line)) {
          this.listeners.delete(fn);
          resolve(line);
        }
      };
      this.listeners.add(fn);
    });
  }

  async init({ hash = 32 } = {}) {
    this.send('uci');
    await this.waitFor(l => l === 'uciok');
    await this.setOptions({ Hash: hash });
    await this.isReady();
    return this;
  }

  async isReady() {
    this.send('isready');
    await this.waitFor(l => l === 'readyok');
  }

  async setOptions(options) {
    for (const [name, value] of Object.entries(options)) {
      if (this.options[name] === value) continue;
      this.send(`setoption name ${name} value ${value}`);
      this.options[name] = value;
    }
  }

  async newGame() {
    this.send('ucinewgame');
    await this.isReady();
  }

  /**
   * Search a position. Returns the final line for each MultiPV slot, the best
   * move, and the history of first moves by depth for slot 1.
   */
  async search(fen, { depth, nodes, movetime, multipv = 1 } = {}) {
    await this.setOptions({ MultiPV: multipv });
    const lines = {};
    const history = [];
    const collector = line => {
      const info = parseInfo(line);
      if (!info) return;
      lines[info.multipv] = info;
      if (info.multipv === 1) history.push({ depth: info.depth, move: info.pv[0], score: info.score });
    };
    this.listeners.add(collector);
    this.send('position fen ' + fen);
    const limit = depth ? `depth ${depth}` : nodes ? `nodes ${nodes}` : `movetime ${movetime || 100}`;
    const done = this.waitFor(l => l.startsWith('bestmove'));
    this.send('go ' + limit);
    const best = parseBestMove(await done);
    this.listeners.delete(collector);
    const ordered = Object.keys(lines)
      .map(Number)
      .sort((a, b) => a - b)
      .map(k => lines[k]);
    return { best, lines: ordered, top: ordered[0] || null, history };
  }

  quit() {
    try {
      this.send('quit');
    } catch {}
    setTimeout(() => this.proc.kill(), 200);
  }
}
