// Play: a game against Nemesis, an opponent that plays like a person of your
// level and steers for positions where your likely move is a blunder. Nothing
// is said about your play during the game, as in a real one. When it ends you
// are shown the one move that cost you most, and it joins the positions you
// train.
import { Chess } from '../../vendor/chess.js';
import { app } from '../app-context.js';
import { engine, BUDGET } from '../engine.js';
import { BoardView } from '../board.js';
import { $, esc, choosePromotion, confirmDialog, toast, settle } from '../ui.js';
import { moveToUci, playUci } from '../chess-utils.js';
import { humanMoves } from '../maia.js';
import { nemesisMove, likelyYours, maiaFor, trapWhat } from '../nemesis.js';
import { isTrainableMistake, winPercentLoss } from '../evaluation.js';
import { createMistake } from '../mistakes.js';
import { mainRating } from '../ratings.js';

const SAVE_KEY = 'rankup-practice';
let root = null;
let board = null;

const play = {
  game: new Chess(),
  color: 'w',
  token: 0, // bumped whenever the game changes under a search, so its answer is dropped
  thinking: false,
  lastMove: [],
  note: '', // what the last trap came to, said once
  trap: null, // the trap in the position you are in, if Nemesis set one: { uci, san, p, loss, best }
  traps: [], // this game's traps: [{ san, loss, taken }]
  worst: null, // your costliest move so far: { id, ply, san, best, loss }
  resigned: false,
  prepared: null, // the engine's view of the position you are thinking about: { fen, promise }
  ahead: new Map(), // Nemesis's replies worked out while you think: fen -> { fen, dropped, promise }
};

(function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    // Games saved by earlier versions had other rules (clocks, challenges): start afresh.
    if (!saved || saved.v !== 7) {
      play.color = Math.random() < 0.5 ? 'w' : 'b';
      return;
    }
    const g = new Chess();
    if (saved.pgn) g.loadPgn(saved.pgn);
    play.game = g;
    play.color = saved.color === 'b' ? 'b' : 'w';
    play.trap = saved.trap || null;
    play.traps = Array.isArray(saved.traps) ? saved.traps : [];
    play.worst = saved.worst || null;
    play.resigned = !!saved.resigned;
    const last = g.history({ verbose: true }).at(-1);
    play.lastMove = last ? [last.from, last.to] : [];
  } catch {}
})();

function persist() {
  try {
    localStorage.setItem(
      SAVE_KEY,
      JSON.stringify({
        v: 7,
        pgn: play.game.history().length ? play.game.pgn() : '',
        color: play.color,
        trap: play.trap,
        traps: play.traps,
        worst: play.worst,
        resigned: play.resigned,
      }),
    );
  } catch {}
}

/** The Maia network Nemesis plays from: the one nearest your real rating, else your puzzle rating. */
function level() {
  return maiaFor(mainRating(app.state)?.rating || app.state.puzzle.rating);
}

const over = () => play.resigned || play.game.isGameOver();

/** "You won by checkmate." and the like, from your side. */
function resultText() {
  const g = play.game;
  if (play.resigned) return 'You resigned.';
  if (g.isCheckmate()) return g.turn() === play.color ? 'Checkmate. Nemesis won.' : 'Checkmate. You won.';
  if (g.isStalemate()) return 'Stalemate. A draw.';
  if (g.isDraw()) return 'A draw.';
  return '';
}

function newGame() {
  play.token++;
  dropAhead();
  // Colours alternate, so you get both.
  play.color = play.game.history().length || play.resigned ? (play.color === 'w' ? 'b' : 'w') : play.color;
  play.game = new Chess();
  play.thinking = false;
  play.lastMove = [];
  play.note = '';
  play.trap = null;
  play.traps = [];
  play.worst = null;
  play.resigned = false;
  play.prepared = null;
  engine.newGame();
  persist();
}

export function render(main) {
  root = main;
  draw();
  if (over()) return;
  if (play.game.turn() !== play.color) {
    if (!play.thinking) engineTurn();
  } else prepareAhead();
}

/** Leaving the screen frees the engine for the rest of the app. */
export function leave() {
  dropAhead();
}

function draw() {
  if (app.page !== 'play' || !root) return;
  root.innerHTML = `<section class="screen play">
    <div class="stage"><div class="board-frame"><div id="board"></div></div></div>
    <div class="side">
      <div class="context"><span>Nemesis · plays like a ${level()}</span><span id="p-tally" class="num"></span></div>
      <div class="prompt" id="p-status" aria-live="polite"></div>
      <div id="p-result"></div>
      <div class="bar" id="p-bar"></div>
    </div>
  </section>`;
  board = new BoardView($('#board', root), { onMove, askPromotion: choosePromotion, label: 'Game board' });
  board.set({ orientation: play.color });
  paint();
}

/** The words under the board while the game is on. */
function statusText() {
  if (over()) return [resultText(), ''];
  if (play.thinking) return ['Nemesis is thinking…', play.note];
  if (!play.game.history().length && play.game.turn() === play.color)
    return ['Your move', `You play ${play.color === 'w' ? 'White' : 'Black'}.`];
  return [play.game.isCheck() ? 'Check. Your move' : 'Your move', play.note];
}

function paint() {
  if (app.page !== 'play' || !board) return;
  const g = play.game;
  board.set({
    game: g,
    interactive: !play.thinking && !over() && g.turn() === play.color,
    movable: play.color,
    lastMove: play.lastMove,
  });
  const status = $('#p-status', root);
  const [head, sub] = statusText();
  const html = `<div class="prompt-head">${over() ? '' : `<span class="turn ${g.turn()}"></span>`}<strong>${esc(head)}</strong></div>${sub ? `<p>${esc(sub)}</p>` : ''}`;
  if (status && status.innerHTML !== html) {
    status.innerHTML = html;
    settle(status);
  }
  const tally = $('#p-tally', root);
  if (tally) {
    const set = play.traps.length;
    tally.textContent = set ? `${set - play.traps.filter(t => t.taken).length} of ${set} traps avoided` : '';
  }
  const result = $('#p-result', root);
  const bar = $('#p-bar', root);
  const mode = over() ? 'over' : g.history().length ? 'on' : 'start';
  if (bar.dataset.mode === mode) return;
  bar.dataset.mode = mode;
  if (mode === 'over') {
    const w = play.worst;
    const known = w && app.state.mistakes.some(m => m.id === w.id);
    result.innerHTML = w
      ? `<div class="lesson"><span class="label">Your costliest move</span><strong>${esc(moveLabel(w.ply, w.san))}</strong><p>${w.best ? `${esc(w.best)} was better.` : 'A better move was there.'} It is now among the positions you train.</p></div>`
      : g.history().length > 9
        ? `<div class="lesson"><span class="label">Your play</span><strong>No serious mistakes</strong><p>Nothing from this game needs training.</p></div>`
        : '';
    bar.innerHTML = `${known ? `<button type="button" id="p-train" class="btn">Train it</button>` : ''}<button type="button" id="p-new" class="btn primary${known ? '' : ' wide'}">New game</button>`;
    if (known) $('#p-train', bar).onclick = () => app.navigate('train', { id: w.id });
    $('#p-new', bar).onclick = () => {
      newGame();
      render(root);
    };
  } else {
    result.innerHTML = '';
    bar.innerHTML = mode === 'on' ? `<button type="button" id="p-resign" class="btn quiet wide">Resign</button>` : '';
    if (mode === 'on') $('#p-resign', bar).onclick = resign;
  }
}

/** "14. Re8" or "14… Re8" from a ply index. */
function moveLabel(ply, san) {
  return `${Math.floor(ply / 2) + 1}${ply % 2 ? '…' : '.'} ${san}`;
}

async function resign() {
  if (over()) return;
  if (!(await confirmDialog({ title: 'Resign this game?', confirm: 'Resign', cancel: 'Keep playing' }))) return;
  play.token++;
  dropAhead();
  play.thinking = false;
  play.resigned = true;
  persist();
  paint();
}

// ---------- Thinking ahead ----------

/** The engine's view of the position you are thinking about, started as soon as it is your move. */
function prepareCoach() {
  if (over() || play.game.turn() !== play.color) return;
  const fen = play.game.fen();
  const promise = engine.analyse(fen, { nodes: BUDGET.coach });
  promise.catch(() => {});
  play.prepared = { fen, promise };
}

/** Your turn: the engine reads the position, then Nemesis works out its replies to your likely moves. */
function prepareAhead() {
  prepareCoach();
  prepareNemesis().catch(() => {});
}

/** Forget the replies worked out ahead, and cut short the search for one of them if it is running. */
function dropAhead(keep = null) {
  for (const s of play.ahead.values()) {
    if (s === keep) continue;
    s.dropped = true;
    engine.stop(s.fen);
  }
  play.ahead.clear();
}

/**
 * While you think, Nemesis thinks too: for each of your likeliest moves it
 * works out the engine's view of the position and its own reply, one at a
 * time, so that when you play one of them the reply is ready. A move you were
 * not expected to play is answered after it is made; the search for the move
 * you did not play is stopped.
 */
async function prepareNemesis() {
  if (over() || play.game.turn() !== play.color) return;
  const token = play.token;
  const base = new Chess();
  if (play.game.history().length) base.loadPgn(play.game.pgn());
  const maia = level();
  const yours = await humanMoves({ level: maia, game: base });
  if (token !== play.token || play.game.fen() !== base.fen() || play.ahead.size) return;
  const specs = [];
  for (const y of likelyYours(yours)) {
    const after = new Chess(base.fen());
    try {
      after.move({ from: y.uci.slice(0, 2), to: y.uci.slice(2, 4), promotion: y.uci[4] });
    } catch {
      continue;
    }
    if (after.isGameOver()) continue;
    specs.push({ fen: after.fen(), dropped: false, promise: null, settle: null });
  }
  // Register every reply first, so a move played while an earlier one is being worked out waits for its own.
  for (const spec of specs) {
    spec.promise = new Promise(resolve => (spec.settle = resolve));
    play.ahead.set(spec.fen, spec);
  }
  for (const spec of specs) {
    let result = null;
    try {
      if (!spec.dropped && token === play.token) result = await replyAhead(spec, base, maia, token);
    } catch {}
    spec.settle(result);
  }
}

/** Work out Nemesis's reply in the position `spec.fen`, reached from `base` by your move: { after, reply } or null. */
async function replyAhead(spec, base, maia, token) {
  const live = () => token === play.token && !spec.dropped;
  const after = await engine.analyse(spec.fen, { nodes: BUDGET.coach, tag: spec.fen });
  if (!live()) return null;
  const candidates = await humanMoves({ level: maia, game: base, fen: spec.fen });
  if (!live()) return null;
  const reply = await nemesisMove(
    spec.fen,
    candidates,
    (f, o) => engine.analyse(f, { multipv: o.multipv, nodes: o.nodes, tag: spec.fen }),
    f => humanMoves({ level: maia, game: base, fen: [spec.fen, f] }),
    { alive: live },
  );
  if (!live() || !reply) return null;
  return { after, reply };
}

// ---------- Moves ----------

async function onMove(move) {
  const g = play.game;
  if (play.thinking || over() || g.turn() !== play.color) return;
  const token = play.token;
  const fen = g.fen();
  const prepared = play.prepared?.fen === fen ? play.prepared.promise : null;
  const m = g.move(move);
  const ply = g.history().length - 1;
  play.thinking = true;
  play.lastMove = [m.from, m.to];
  play.note = '';
  // The trap in the position just left: walked into, or avoided.
  if (play.trap) {
    const trap = play.trap;
    const taken = moveToUci(m) === trap.uci;
    play.traps.push({ san: trap.san, loss: trap.loss, taken });
    play.trap = null;
    play.note = taken
      ? `That was the trap: ${trap.san} loses ${trapWhat(trap.loss)}.`
      : `Trap avoided: ${trap.san} would have lost ${trapWhat(trap.loss)}.`;
  }
  // Nemesis may have its reply ready; replies prepared for moves you did not play are dropped.
  const ahead = play.ahead.get(g.fen()) || null;
  dropAhead(ahead);
  persist();
  paint();
  board.announce(`You played ${m.san}.`);
  try {
    if (g.isGameOver()) return;
    const before = await (prepared || engine.analyse(fen, { nodes: BUDGET.coach }));
    if (token !== play.token) return;
    const ready = ahead ? await ahead.promise : null;
    if (token !== play.token) return;
    const after = ready?.after || (await engine.analyse(g.fen(), { nodes: BUDGET.coach }));
    if (token !== play.token) return;
    judge({ fen, m, ply, before, after });
    await engineMove(token, ready?.reply || null);
  } catch (e) {
    if (token === play.token) toast(e.message || 'The engine stopped. Try the move again.');
  } finally {
    if (token === play.token) {
      play.thinking = false;
      paint();
      if (!over() && app.page === 'play') prepareAhead();
    }
  }
}

/** A move of yours that threw away a clearly better one is saved to train; the costliest of the game is remembered. */
function judge({ fen, m, ply, before, after }) {
  if (!before?.best || moveToUci(m) === before.best || !isTrainableMistake(before.score, after.score)) return;
  const loss = winPercentLoss(before.score, after.score);
  const saved = createMistake({ fen, played: m.san, before, after, loss });
  if (!saved || (play.worst && play.worst.loss >= loss)) return;
  let best = null;
  try {
    best = playUci(new Chess(fen), saved.mistake.line[0]).san;
  } catch {}
  play.worst = { id: saved.mistake.id, ply, san: m.san, best, loss: Math.round(loss) };
  persist();
}

/** Nemesis's move; `ready` is its reply worked out while you thought, when there is one. */
async function engineMove(token, ready = null) {
  const g = play.game;
  const fen = g.fen();
  const maia = level();
  let r = ready;
  if (!r) {
    try {
      r = await nemesisMove(
        fen,
        await humanMoves({ level: maia, game: g }),
        (f, o) => engine.analyse(f, { multipv: o.multipv, nodes: o.nodes }),
        f => humanMoves({ level: maia, game: g, fen: f }),
      );
    } catch {
      // The network could not load (offline before its first use): Stockfish at a modest strength, with no trap.
      r = { uci: (await engine.analyse(fen, { elo: Math.max(1320, maia), movetime: 500 })).best, trap: null };
    }
  }
  if (token !== play.token || !r?.uci) return;
  const m = playUci(g, r.uci);
  play.trap = r.trap || null;
  play.lastMove = [m.from, m.to];
  persist();
  board?.announce(`Nemesis played ${m.san}.`);
}

async function engineTurn() {
  const token = play.token;
  play.thinking = true;
  paint();
  try {
    await engineMove(token);
  } catch (e) {
    if (token === play.token) toast(e.message || 'The engine stopped.');
  } finally {
    if (token === play.token) {
      play.thinking = false;
      paint();
      if (!over() && app.page === 'play') prepareAhead();
    }
  }
}
