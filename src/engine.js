// Stockfish in a Web Worker, with a queue so searches never overlap.
import { parseInfo, parseBestMove } from './uci-parse.js';

/** Search budgets in nodes. Nodes, unlike time, give the same result on any device. */
export const BUDGET = { coach: 150000, review: 250000, verify: 120000, hint: 100000, opponent: 90000 };

export class Engine {
  constructor(url) {
    this.url = url;
    this.queue = Promise.resolve();
    this.worker = null;
    this.ready = null;
    this.listener = null;
    this.status = 'idle';
    this.searching = false;
    this.abort = null; // rejects the search in flight if the worker dies
  }

  init() {
    if (this.ready) return this.ready;
    this.status = 'loading';
    this.ready = new Promise((resolve, reject) => {
      const fail = message => {
        clearTimeout(timer);
        this.status = 'failed';
        this.ready = null;
        try {
          this.worker?.terminate();
        } catch {}
        this.worker = null;
        this.queue = Promise.resolve();
        this.abort?.(new Error('The chess engine stopped. Refresh to restart it.'));
        reject(new Error(message));
      };
      const timer = setTimeout(() => fail('The chess engine did not load. Refresh while online.'), 30000);
      try {
        this.worker = new Worker(this.url);
      } catch {
        fail('This browser cannot start the chess engine.');
        return;
      }
      this.worker.onerror = () => fail('The chess engine could not load. Refresh while online.');
      this.worker.onmessage = e => {
        const line = String(e.data);
        if (line === 'uciok') {
          this.worker.postMessage('setoption name Hash value 16');
          this.worker.postMessage('isready');
        } else if (line === 'readyok' && this.status === 'loading') {
          clearTimeout(timer);
          this.status = 'ready';
          resolve();
        }
        this.listener?.(line);
      };
      this.worker.postMessage('uci');
    });
    return this.ready;
  }

  get available() {
    return this.status !== 'failed';
  }

  /**
   * Analyse a position. Options: nodes | movetime | depth, multipv, elo.
   * Scores are for the side to move. Resolves with the top line flattened
   * plus every MultiPV line in `lines`.
   */
  analyse(fen, { nodes = null, movetime = null, depth = null, multipv = 1, elo = null } = {}) {
    const job = async () => {
      await this.init();
      return new Promise((resolve, reject) => {
        const lines = {};
        let timedOut = false;
        const timer = setTimeout(() => {
          // Stop and wait for bestmove so the next search starts clean.
          timedOut = true;
          if (this.worker) this.worker.postMessage('stop');
          else this.abort?.(new Error('Analysis timed out. Try again.'));
        }, 45000);
        this.searching = true;
        this.abort = error => {
          clearTimeout(timer);
          this.listener = null;
          this.searching = false;
          this.abort = null;
          reject(error);
        };
        this.listener = line => {
          const info = parseInfo(line);
          if (info) lines[info.multipv] = info;
          const best = parseBestMove(line);
          if (best === null) return;
          clearTimeout(timer);
          this.listener = null;
          this.searching = false;
          this.abort = null;
          if (timedOut && !lines[1]) return reject(new Error('Analysis timed out. Try again.'));
          const ordered = Object.keys(lines)
            .map(Number)
            .sort((a, b) => a - b)
            .map(k => lines[k]);
          const top = ordered[0] || { score: 0, mate: null, pv: [], depth: 0 };
          resolve({
            best: best === '(none)' ? null : best,
            score: top.score,
            mate: top.mate,
            pv: top.pv,
            depth: top.depth,
            lines: ordered,
          });
        };
        const post = cmd => this.worker.postMessage(cmd);
        post('setoption name UCI_LimitStrength value ' + (elo ? 'true' : 'false'));
        if (elo) post('setoption name UCI_Elo value ' + Math.max(1320, Math.min(3190, elo)));
        post('setoption name MultiPV value ' + multipv);
        post('position fen ' + fen);
        post('go ' + (depth ? `depth ${depth}` : nodes ? `nodes ${nodes}` : `movetime ${movetime || 300}`));
      });
    };
    const promise = this.queue.then(job);
    this.queue = promise.catch(() => {});
    return promise;
  }

  /** Ask a running search to finish now; its promise resolves with what it has. */
  stop() {
    if (this.searching) this.worker?.postMessage('stop');
  }

  newGame() {
    // Clearing the hash mid-search is unsafe; the next search simply reuses it.
    if (this.status === 'ready' && !this.searching) this.worker.postMessage('ucinewgame');
  }
}

export const engine = new Engine(new URL('../vendor/stockfish-17.1-lite-single-03e3232.js', import.meta.url));
