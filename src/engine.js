// Stockfish in a Web Worker, with a queue so searches never overlap.
import { parseInfo, parseBestMove } from './uci-parse.js';

/** Search budgets in nodes. Nodes, unlike time, give the same result on any device. */
export const BUDGET = { coach: 150000, review: 250000, verify: 120000, hint: 100000, opponent: 90000, deep: 1500000 };

export class Engine {
  constructor(url, { searchMs = 45000, deadMs = 4000 } = {}) {
    this.url = url;
    this.searchMs = searchMs;
    this.deadMs = deadMs;
    this.queue = Promise.resolve();
    this.worker = null;
    this.ready = null;
    this.listener = null;
    this.status = 'idle';
    this.searching = false;
    this.abort = null; // rejects the search in flight if the worker dies
    this.waiting = 0; // foreground searches queued or running
    this.background = false; // the search in flight is a background one
    this.preempted = false;
  }

  /** True when nothing the user is waiting for is queued or running. */
  get idle() {
    return this.waiting === 0 && !this.searching;
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
      this.worker.onerror = () => {
        if (this.status === 'ready') this.crash();
        else fail('The chess engine could not load. Refresh while online.');
      };
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
   * The engine died mid-search (WebAssembly can trap on some browsers).
   * Throw the worker away; the next request starts a fresh one.
   */
  crash(message = 'The chess engine stopped and was restarted. Try that again.') {
    try {
      this.worker?.terminate();
    } catch {}
    this.worker = null;
    this.ready = null;
    this.status = 'idle';
    this.queue = Promise.resolve();
    this.abort?.(new Error(message));
  }

  /**
   * Analyse a position. Options: nodes | movetime | depth, multipv, elo.
   * Scores are for the side to move. Resolves with the top line flattened
   * plus every MultiPV line in `lines`.
   * Background searches give way: a foreground request stops them, and they
   * resolve with `interrupted: true` so the caller can retry later.
   */
  analyse(fen, { nodes = null, movetime = null, depth = null, multipv = 1, elo = null, background = false } = {}) {
    if (!background) {
      this.waiting++;
      if (this.searching && this.background) {
        this.preempted = true;
        this.worker?.postMessage('stop');
      }
    }
    const job = async () => {
      if (background && this.waiting > 0) return { interrupted: true, best: null, score: 0, mate: null, pv: [], depth: 0, lines: [] };
      await this.init();
      return new Promise((resolve, reject) => {
        const lines = {};
        let timedOut = false;
        let deadTimer = null;
        const timer = setTimeout(() => {
          // Stop and wait for bestmove so the next search starts clean. An
          // engine that does not even answer "stop" has crashed: restart it.
          timedOut = true;
          if (!this.worker) return this.abort?.(new Error('Analysis timed out. Try again.'));
          this.worker.postMessage('stop');
          deadTimer = setTimeout(() => this.crash(), this.deadMs);
        }, this.searchMs);
        this.searching = true;
        this.background = background;
        this.preempted = false;
        this.abort = error => {
          clearTimeout(timer);
          clearTimeout(deadTimer);
          this.listener = null;
          this.searching = false;
          this.background = false;
          this.abort = null;
          reject(error);
        };
        this.listener = line => {
          const info = parseInfo(line);
          if (info) lines[info.multipv] = info;
          const best = parseBestMove(line);
          if (best === null) return;
          clearTimeout(timer);
          clearTimeout(deadTimer);
          this.listener = null;
          this.searching = false;
          this.abort = null;
          if (timedOut && !lines[1]) return reject(new Error('Analysis timed out. Try again.'));
          const ordered = Object.keys(lines)
            .map(Number)
            .sort((a, b) => a - b)
            .map(k => lines[k]);
          const top = ordered[0] || { score: 0, mate: null, pv: [], depth: 0 };
          const interrupted = background && this.preempted;
          this.background = false;
          resolve({
            interrupted,
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
    const run = background
      ? job
      : () =>
          job().finally(() => {
            this.waiting--;
          });
    const promise = this.queue.then(run);
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
