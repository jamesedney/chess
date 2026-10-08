import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../../src/engine.js';

/** A fake Stockfish worker: answers the handshake, then either replies to searches or dies. */
class FakeWorker {
  static instances = 0;
  constructor() {
    FakeWorker.instances++;
    this.alive = true;
    this.dead = FakeWorker.deadOnStart || false; // when true, searches never answer
    FakeWorker.last = this;
  }
  postMessage(cmd) {
    if (!this.alive) return;
    const say = line => setTimeout(() => this.onmessage?.({ data: line }), 0);
    if (cmd === 'uci') say('uciok');
    else if (cmd === 'isready') say('readyok');
    else if (cmd.startsWith('go') && !this.dead) {
      say('info depth 10 multipv 1 score cp 25 pv e2e4 e7e5');
      say('bestmove e2e4');
    }
  }
  terminate() {
    this.alive = false;
  }
}

test('a crashed engine is restarted and the search retried once, silently', async () => {
  globalThis.Worker = FakeWorker;
  try {
    FakeWorker.instances = 0;
    const engine = new Engine('fake.js', { searchMs: 30, deadMs: 10, silenceMs: 20 });
    const first = await engine.analyse('fen1', { nodes: 10 });
    assert.equal(first.best, 'e2e4');
    assert.equal(FakeWorker.instances, 1);
    // The worker dies: the retry runs on a fresh one and the caller never notices.
    FakeWorker.last.dead = true;
    const second = await engine.analyse('fen2', { nodes: 10 });
    assert.equal(second.best, 'e2e4');
    assert.equal(FakeWorker.instances, 2, 'a fresh worker was started');
    assert.equal(engine.available, true, 'a crash is not a permanent failure');
    // Two crashes in a row are reported.
    FakeWorker.last.dead = true;
    FakeWorker.deadOnStart = true;
    await assert.rejects(engine.analyse('fen3', { nodes: 10 }), /restarted/);
    FakeWorker.deadOnStart = false;
  } finally {
    delete globalThis.Worker;
  }
});

test('a background search gives way to a foreground one', async () => {
  globalThis.Worker = FakeWorker;
  try {
    const engine = new Engine('fake.js');
    const fg = engine.analyse('fen', { nodes: 10 });
    const bg = engine.analyse('fen', { nodes: 10, background: true });
    assert.equal((await fg).best, 'e2e4');
    assert.equal((await bg).best, 'e2e4', 'queued behind the foreground search, then runs');
    assert.equal(engine.idle, true);
  } finally {
    delete globalThis.Worker;
  }
});
