import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Chess } from '../../vendor/chess.js';
import {
  trapIn,
  nemesisMove,
  likelyYours,
  maiaFor,
  trapText,
  trapTally,
  TRAP_LOSS,
  TRAP_COST,
  REPLY_LINES,
  AHEAD,
} from '../../src/nemesis.js';
import { UciEngine } from '../../tools/uci.mjs';
import { loadWeights, forward, encode, moveProbabilities } from '../../src/maia-core.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
/** Engine lines: [uci, score] pairs from the side to move. */
const lines = pairs => pairs.map(([uci, score]) => ({ pv: [uci], score, mate: null }));

test('a trap is your likeliest reply that loses 150 or more against the best; quieter replies are read too', () => {
  // After 1. e4, Black's likely replies with made-up scores: e5 fine, d5 fine, the knight to a6 loses.
  const fen = new Chess(START);
  fen.move('e4');
  const after = fen.fen();
  const l = lines([
    ['e7e5', 0],
    ['d7d5', -20],
    ['b8c6', -40],
    ['g8f6', -60],
    ['c7c5', -70],
    ['b8a6', -200],
  ]);
  assert.equal(trapIn(after, l, [{ uci: 'e7e5', p: 0.5 }]), null, 'the likely reply is fine');
  const trap = trapIn(after, l, [
    { uci: 'b8a6', p: 0.3 },
    { uci: 'e7e5', p: 0.2 },
  ]);
  assert.deepEqual(trap, { uci: 'b8a6', san: 'Na6', p: 0.3, loss: 200, best: 'e5' });
  // A likely reply missing from a full set of lines counts as below the last line shown.
  const missing = trapIn(after, l, [{ uci: 'a7a5', p: 0.4 }]);
  assert.equal(missing.loss, 200);
  // With fewer lines than asked, a missing reply is unknown and is not a trap.
  assert.equal(trapIn(after, l.slice(0, 2), [{ uci: 'a7a5', p: 0.4 }]), null);
  // Replies under the probability floor, or beyond the top three, are not "likely".
  assert.equal(trapIn(after, l, [{ uci: 'b8a6', p: 0.05 }]), null);
  assert.equal(
    trapIn(after, l, [
      { uci: 'e7e5', p: 0.3 },
      { uci: 'd7d5', p: 0.2 },
      { uci: 'c7c5', p: 0.1 },
      { uci: 'b8a6', p: 0.1 },
    ]),
    null,
  );
});

/** The position after `uci` from `fen`. */
const afterMove = (fen, uci) => {
  const g = new Chess(fen);
  g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  return g.fen();
};

test('Nemesis plays the candidate whose trap is worth most within its cost, else its likeliest move', async () => {
  // White to move after 1. e4 e5. Candidates: Nf3 (best, no trap), Qh5 (costs 40, sets a trap), Ba6?? (costs 300, sets a trap).
  const g = new Chess(START);
  g.move('e4');
  g.move('e5');
  const fen = g.fen();
  const nf3 = afterMove(fen, 'g1f3');
  const qh5 = afterMove(fen, 'd1h5');
  const ba6 = afterMove(fen, 'f1a6');
  // Scores from Black's side: after Nf3 Black stands -30; after Qh5 +10 (White gave up 40); after Ba6 +270.
  const LINES = {
    [nf3]: lines([
      ['b8c6', -30],
      ['g8f6', -35],
      ['d7d6', -40],
      ['f8c5', -45],
      ['c7c6', -50],
      ['a7a6', -60],
    ]),
    [qh5]: lines([
      ['g8f6', 10],
      ['b8c6', 0],
      ['d7d6', -10],
      ['g7g6', -20],
      ['c7c6', -30],
      ['d8f6', -170],
    ]),
    [ba6]: lines([
      ['b7a6', 270],
      ['b8c6', 260],
      ['d7d6', 250],
      ['g8f6', 240],
      ['c7c6', 230],
      ['d8h4', -100],
    ]),
  };
  const REPLIES = {
    [nf3]: [{ uci: 'b8c6', p: 0.5 }],
    [qh5]: [
      { uci: 'd8f6', p: 0.3 },
      { uci: 'g8f6', p: 0.2 },
    ],
    [ba6]: [{ uci: 'd8h4', p: 0.4 }],
  };
  const seen = [];
  const analyse = async (f, o) => {
    seen.push(f);
    assert.equal(o.multipv, REPLY_LINES);
    return { lines: LINES[f] };
  };
  const predict = async f => REPLIES[f];
  const r = await nemesisMove(
    fen,
    [
      { uci: 'g1f3', p: 0.5 },
      { uci: 'd1h5', p: 0.1 },
      { uci: 'f1a6', p: 0.05 },
    ],
    analyse,
    predict,
  );
  assert.equal(r.uci, 'd1h5', 'the trap within cost wins; the bigger trap costs too much');
  assert.equal(r.trap.san, 'Qf6');
  assert.equal(r.trap.loss, 180);
  assert.equal(r.cost, 40);
  assert.equal(r.considered, 3);
  assert.deepEqual(seen, [nf3, qh5, ba6], 'one analysis per candidate');
  // Without a trap in reach it plays the likeliest candidate.
  const plain = await nemesisMove(fen, [{ uci: 'g1f3', p: 0.5 }], analyse, predict);
  assert.equal(plain.uci, 'g1f3');
  assert.equal(plain.trap, null);
  assert.equal(plain.cost, 0);
  // Candidates below the probability floor are not judged once one has been.
  const few = await nemesisMove(
    fen,
    [
      { uci: 'g1f3', p: 0.5 },
      { uci: 'd1h5', p: 0.01 },
    ],
    analyse,
    predict,
  );
  assert.equal(few.considered, 1);
  // Once the answer is no longer wanted, Nemesis stops judging and says nothing.
  let judged = 0;
  const counting = async (f, o) => {
    judged++;
    return analyse(f, o);
  };
  const stopped = await nemesisMove(
    fen,
    [
      { uci: 'g1f3', p: 0.5 },
      { uci: 'd1h5', p: 0.1 },
    ],
    counting,
    predict,
    { alive: () => judged < 1 },
  );
  assert.equal(stopped, null);
  assert.equal(judged, 1, 'the second candidate was never searched');
});

test('while you think, Nemesis prepares replies to your two likeliest moves, if they are likely enough', () => {
  assert.equal(AHEAD, 2);
  const yours = [
    { uci: 'g1f3', p: 0.4 },
    { uci: 'd2d4', p: 0.3 },
    { uci: 'b1c3', p: 0.2 },
  ];
  assert.deepEqual(
    likelyYours(yours).map(m => m.uci),
    ['g1f3', 'd2d4'],
  );
  assert.deepEqual(
    likelyYours([
      { uci: 'g1f3', p: 0.9 },
      { uci: 'a2a3', p: 0.05 },
    ]).map(m => m.uci),
    ['g1f3'],
  );
  assert.deepEqual(likelyYours([]), []);
});

test('Nemesis plays like the Maia level nearest your rating, and says what a trap would have cost', () => {
  assert.equal(maiaFor(1254), 1100);
  assert.equal(maiaFor(1300), 1500);
  assert.equal(maiaFor(1800), 1900);
  assert.equal(trapText({ san: 'Re8', loss: 429, best: 'Nxc4' }), 'Re8 would have lost a piece; Nxc4 was the move.');
  assert.equal(trapText({ san: 'Kf1', loss: 9999, best: null }), 'Kf1 would have lost the game.');
  assert.equal(trapTally([]), '');
  assert.equal(trapTally([{ taken: true }, { taken: false }, { taken: false }]), 'Traps 3, taken 1.');
  assert.equal(TRAP_LOSS, 150);
});

test('with the real engine and Maia, Nemesis sets a trap in a position from your games', async () => {
  // Your game: after 14... Nxb2 15. Bxe7 (Bishop's Opening), where you played 15... Re8?? and lost a piece.
  // One move earlier it is Nemesis (White) to move; it should find a move that makes a likely reply of yours lose.
  const moves = [
    'e4',
    'e5',
    'Bc4',
    'Nf6',
    'd3',
    'Nc6',
    'Nc3',
    'Bc5',
    'Nge2',
    'Ng4',
    'O-O',
    'O-O',
    'h3',
    'Nxf2',
    'Rxf2',
    'Bxf2+',
    'Kxf2',
    'Qh4+',
    'Kg1',
    'Qf6',
    'Bg5',
    'Qd4+',
    'Kh1',
    'Nb4',
    'Nd5',
    'Nxd5',
    'exd5',
    'd6',
    'Ne4',
    'Qxb2',
    'Rb1',
    'Qxa2',
    'Bxd6',
    'cxd6',
  ];
  // (A reconstruction in the same spirit; the test only needs a real middlegame with a hanging-piece trap in reach.)
  const g = new Chess();
  const fens = [g.fen()];
  for (const m of moves) {
    try {
      g.move(m);
    } catch {
      break;
    }
    fens.push(g.fen());
  }
  const tables = JSON.parse(fs.readFileSync(new URL('../../maia/tables.json', import.meta.url)));
  const b = fs.readFileSync(new URL('../../maia/maia-1100.bin', import.meta.url));
  const net = loadWeights(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  const probs = (fs2, pos) => {
    const legal = pos.moves({ verbose: true }).map(m => m.from + m.to + (m.promotion || ''));
    const { policy } = forward(net, encode(fs2));
    return moveProbabilities(policy, legal, pos.turn() === 'b', tables).sort((x, y) => y.p - x.p);
  };
  const engine = await new UciEngine().init();
  try {
    const analyse = async (f, o) => {
      const r = await engine.search(f, { nodes: o.nodes, multipv: o.multipv });
      return { ...r.top, lines: r.lines };
    };
    const r = await nemesisMove(g.fen(), probs(fens, g), analyse, async f => probs([...fens, f], new Chess(f)));
    assert.ok(r.uci, 'Nemesis has a move');
    assert.ok(new Chess(g.fen()).move({ from: r.uci.slice(0, 2), to: r.uci.slice(2, 4), promotion: r.uci[4] }), 'and it is legal');
    assert.ok(r.considered >= 1);
    if (r.trap) {
      assert.ok(r.trap.loss >= TRAP_LOSS);
      assert.ok(r.cost <= TRAP_COST);
    }
  } finally {
    engine.quit();
  }
});
