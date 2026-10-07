import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../../src/engine.js';
import { plyLabel } from '../../src/pages/review.js';
import { defaults, validate } from '../../src/state.js';

/** A stand-in for the Stockfish worker that can be told to crash. */
class FakeWorker {
  static last = null;
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(cmd) {
    const say = line => setTimeout(() => this.onmessage?.({ data: line }), 0);
    if (cmd === 'uci') say('uciok');
    else if (cmd === 'isready') say('readyok');
    else if (cmd.startsWith('go') && !this.hang) {
      say('info depth 5 multipv 1 score cp 30 nodes 10 pv e2e4');
      say('bestmove e2e4');
    }
  }
  terminate() {}
}

test('a crashed engine rejects the search in flight and recovers on the next one', async () => {
  globalThis.Worker = FakeWorker;
  const engine = new Engine('fake.js');
  assert.equal((await engine.analyse('fen')).best, 'e2e4');
  FakeWorker.last.hang = true;
  const pending = engine.analyse('fen');
  await new Promise(r => setTimeout(r, 10));
  FakeWorker.last.onerror();
  await assert.rejects(pending, /stopped/);
  // The queue is not stuck: a fresh worker answers the next search.
  assert.equal((await engine.analyse('fen')).best, 'e2e4');
  delete globalThis.Worker;
});

test('move labels honour games that start from a position with Black to move', () => {
  const review = { startFen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 2 20', moves: ['Nf6', 'Nc3', 'Bc5'] };
  assert.equal(plyLabel(review, 0), '20… Nf6');
  assert.equal(plyLabel(review, 1), '21. Nc3');
  assert.equal(plyLabel({ startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', moves: ['e4'] }, 0), '1. e4');
});

test('backups with markup in ids are rejected', () => {
  const s = defaults();
  s.reviews.push({ id: 'r"><img src=x onerror=alert(1)>', moves: [], evals: [], marks: [], startFen: 'x' });
  assert.match(validate(s), /review/);
  const m = defaults();
  m.mistakes.push({ id: 'm"><b>', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', line: ['e2e4'] });
  assert.match(validate(m), /mistake/);
  const ply = defaults();
  ply.mistakes.push({
    id: 'mabc',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    line: ['e2e4'],
    source: { reviewId: 'rabc', ply: '1"><b>' },
  });
  assert.match(validate(ply), /source/);
});
