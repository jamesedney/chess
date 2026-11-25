// Train: one position at a time. Positions from your own games come first,
// puzzles at your level fill in. You move a piece; the board says whether it
// was right. There is nothing else on the screen to learn.
import { Chess } from '../../vendor/chess.js';
import { app } from '../app-context.js';
import { engine, BUDGET } from '../engine.js';
import { BoardView } from '../board.js';
import { $, esc, choosePromotion, settle } from '../ui.js';
import { moveToUci, playUci, opposite, NAMES } from '../chess-utils.js';
import { schedule, nextPosition, ownCounts } from '../srs.js';
import { updateRating, pushHistory } from '../rating.js';
import { judgeAlternative } from '../verify.js';
import { dateKey } from '../state.js';
import { cue } from '../sound.js';

/** A puzzle solved cleanly moves on by itself after this long. */
export const AUTO_NEXT_MS = 1100;

let root = null;
let board = null;
let cur = null; // the position on the board and how the attempt is going
let turn = 0; // positions served this sitting
let seen = []; // their ids, so one missed a moment ago is not asked again at once
let autoTimer = null;

const wait = ms => new Promise(r => setTimeout(r, ms));
const side = c => (c === 'w' ? 'White' : 'Black');

/** Start a position: `p` is one of your saved positions or a puzzle. */
function load(p, own) {
  clearTimeout(autoTimer);
  if (!p) {
    cur = null;
    return;
  }
  seen.push(p.id);
  if (seen.length > 40) seen.shift();
  turn++;
  const game = new Chess(p.fen);
  const solver = p.setup ? opposite(game.turn()) : game.turn();
  let playedArrow = null;
  if (own && p.played) {
    try {
      const m = new Chess(p.fen).move(p.played);
      playedArrow = { from: m.from, to: m.to, kind: 'played' };
    } catch {}
  }
  cur = {
    p,
    own,
    game,
    solver,
    ply: 0,
    made: 0,
    total: Math.ceil(p.line.length / 2),
    failed: false,
    hint: 0,
    shown: false,
    complete: false,
    offBook: false,
    busy: false,
    setupPending: !!p.setup,
    lastMove: [],
    marks: {},
    arrows: playedArrow ? [playedArrow] : [],
    playedArrow,
    head: '',
    sub: '',
    tone: '',
    delta: null,
  };
  say(...opening(cur));
}

function loadNext() {
  const s = app.state;
  const next = nextPosition({
    mistakes: s.mistakes,
    puzzles: app.puzzles,
    records: s.records,
    rating: s.puzzle.rating,
    turn,
    seen,
  });
  load(next?.position || null, !!next?.own);
}

/** The first words under the board: whose move, and what is asked. */
function opening(c) {
  const head = `${side(c.solver)} to move`;
  if (c.setupPending) return [head, 'Watch their move first.'];
  if (c.own) return [head, c.p.played ? `You played ${c.p.played}. Find the better move.` : 'Find the better move.'];
  const mate = c.p.mate || ((c.p.tags || []).includes('mate') ? c.total : 0);
  return [head, mate ? `Mate in ${mate}.` : 'Find the best move.'];
}

/** Where the position came from, for the line above the board. */
function sourceText(c) {
  if (!c.own) return `Puzzle · ${c.p.rating || '?'}`;
  const g = c.p.game;
  if (!g) return 'Your game against Nemesis';
  const d = g.date ? new Date(g.date + 'T12:00:00') : null;
  const when = d && !isNaN(d.getTime()) ? ` · ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : '';
  return `Your game${g.opp ? ` against ${g.opp}` : ''}${when}`;
}

export function render(main, params = {}) {
  root = main;
  if (params.id) {
    const p = app.state.mistakes.find(m => m.id === params.id) || app.puzzles.find(x => x.id === params.id);
    if (p) load(p, p.id.startsWith('m'));
  }
  if (!cur || (cur.complete && !params.id)) loadNext();
  draw();
}

export function leave() {
  clearTimeout(autoTimer);
}

function draw() {
  if (app.page !== 'train' || !root) return;
  const c = cur;
  if (!c) {
    root.innerHTML = `<section class="screen"><div class="empty"><h1>Nothing to train</h1><p>No positions could be loaded. Reload the app while online.</p></div></section>`;
    board = null;
    return;
  }
  const s = app.state;
  const linked = !!(s.profiles.lichess || s.profiles.chesscom);
  root.innerHTML = `<section class="screen train">
    <div class="stage"><div class="board-frame"><div id="board"></div></div></div>
    <div class="side">
      <div class="context"><span id="t-source">${esc(sourceText(c))}</span><span id="t-count" class="num"></span></div>
      <div class="prompt" id="t-prompt" aria-live="polite"></div>
      <div class="bar" id="t-bar"></div>
      ${linked ? '' : `<a class="nudge" href="#you">Add your Chess.com or Lichess name to train on your own games</a>`}
    </div>
  </section>`;
  board = new BoardView($('#board', root), { onMove, askPromotion: choosePromotion, label: 'Training board' });
  paint();
  if (c.setupPending) playSetup(c);
}

/** Refresh the board, the words under it and the buttons from the attempt's state. */
function paint() {
  if (app.page !== 'train' || !board || !cur) return;
  const c = cur;
  board.set({
    game: c.game,
    orientation: c.solver,
    interactive: !c.complete && !c.setupPending && !c.busy,
    movable: c.solver,
    lastMove: c.lastMove,
    marks: c.marks,
    arrows: c.arrows,
  });
  const frame = $('.board-frame', root);
  if (frame) frame.dataset.tone = c.complete ? c.tone : '';
  const prompt = $('#t-prompt', root);
  if (prompt) {
    const dot = c.complete ? '' : `<span class="turn ${c.solver}"></span>`;
    const delta =
      c.delta === null ? '' : `<span class="delta ${c.delta < 0 ? 'down' : 'up'}">${c.delta < 0 ? '−' : '+'}${Math.abs(c.delta)}</span>`;
    const html = `<div class="prompt-head">${dot}<strong>${esc(c.head)}</strong>${delta}</div>${c.sub ? `<p>${esc(c.sub)}</p>` : ''}`;
    if (prompt.innerHTML !== html) {
      prompt.innerHTML = html;
      settle(prompt);
    }
    prompt.dataset.tone = c.tone;
  }
  const count = $('#t-count', root);
  if (count) {
    const own = ownCounts(app.state.mistakes, app.state.records).waiting;
    count.textContent = c.own ? (own ? `${own} to fix` : 'All fixed') : `You · ${app.state.puzzle.rating}`;
    count.title = c.own ? 'Positions from your games still to fix' : 'Your puzzle rating';
  }
  const bar = $('#t-bar', root);
  if (!bar) return;
  const want = c.complete ? 'done' : 'solving';
  if (bar.dataset.mode !== want) {
    bar.dataset.mode = want;
    bar.innerHTML = c.complete
      ? `<button type="button" id="t-next" class="btn primary wide">Next</button>`
      : `<button type="button" id="t-hint" class="btn">Hint</button><button type="button" id="t-show" class="btn">Show me</button>`;
    if (c.complete) {
      $('#t-next', bar).onclick = next;
      $('#t-next', bar).focus({ preventScroll: true });
    } else {
      $('#t-hint', bar).onclick = hint;
      $('#t-show', bar).onclick = showSolution;
    }
  }
  if (!c.complete) for (const b of bar.querySelectorAll('button')) b.disabled = c.busy || c.setupPending;
  $('#t-next', bar)?.classList.toggle('auto', !!c.auto);
}

function say(head, sub = '', tone = '') {
  if (!cur) return;
  cur.head = head;
  cur.sub = sub;
  cur.tone = tone;
  paint();
}

async function playSetup(c) {
  await wait(650);
  if (c !== cur || !c.setupPending) return;
  const m = playUci(c.game, c.p.setup);
  c.lastMove = [m.from, m.to];
  c.setupPending = false;
  say(...opening(c));
  board?.announce(`${side(opposite(c.solver))} played ${m.san}. Your move.`);
}

async function onMove(move) {
  const c = cur;
  if (!c || c.complete || c.busy || c.setupPending) return;
  const beforeFen = c.game.fen();
  let m;
  try {
    m = c.game.move(move);
  } catch {
    return;
  }
  c.marks = {};
  c.arrows = c.playedArrow ? [c.playedArrow] : [];
  const expected = c.offBook ? null : c.p.line[c.ply];
  if (c.game.isCheckmate() || (expected && moveToUci(m) === expected)) return accept(c, m, null);
  if (!engine.available) return reject(c, m, '');
  // Not the stored answer: it may still be as good. The engine decides.
  c.busy = true;
  c.lastMove = [m.from, m.to];
  say('Checking…');
  try {
    const before = await engine.analyse(beforeFen, { nodes: BUDGET.verify });
    const after = c.game.isGameOver() ? null : await engine.analyse(c.game.fen(), { nodes: BUDGET.verify });
    if (c !== cur) return;
    c.busy = false;
    const mate = c.p.mate || (c.p.tags || []).includes('mate');
    const verdict = judgeAlternative({
      before,
      after,
      mateExpected: !!mate,
      remainingMoves: c.total - c.made - 1,
      // Positions from real games are often level: a move about as good as the best counts.
      minWin: c.own ? 0 : 60,
    });
    if (verdict.accepted) {
      c.offBook = true;
      return accept(c, m, after?.best || null);
    }
    reject(
      c,
      m,
      verdict.reason === 'weaker' ? 'A fair move, but there is better.' : verdict.reason === 'slower-mate' ? 'That mates more slowly.' : '',
    );
  } catch {
    if (c !== cur) return;
    c.busy = false;
    reject(c, m, '');
  }
}

function reject(c, m, why) {
  c.game.undo();
  c.failed = true;
  c.lastMove = [];
  say(`${side(c.solver)} to move`, why || 'Not that one. Look again.', 'bad');
  board?.flash(m.to);
  cue('error');
  board?.announce('Not the move. Try again.');
}

async function accept(c, m, engineReply) {
  c.made++;
  if (!c.offBook) c.ply++;
  c.lastMove = [m.from, m.to];
  c.marks = { [m.to]: 'good' };
  if (c.game.isGameOver() || c.made >= c.total) return finish(c);
  c.busy = true;
  say('Right. Keep going.', '', 'good');
  await wait(450);
  if (c !== cur) return;
  let reply = c.offBook ? engineReply : c.p.line[c.ply];
  if (c.offBook && !reply) {
    try {
      reply = (await engine.analyse(c.game.fen(), { nodes: BUDGET.verify })).best;
    } catch {}
  }
  if (c !== cur) return;
  c.busy = false;
  if (!reply) return finish(c);
  const r = playUci(c.game, reply);
  if (!c.offBook) c.ply++;
  c.lastMove = [r.from, r.to];
  c.marks = {};
  if (c.game.isGameOver()) return finish(c);
  say(`${side(c.solver)} to move`, `They played ${r.san}.`);
  board?.announce(`They played ${r.san}. Your move.`);
}

function finish(c) {
  if (c.complete) return;
  c.complete = true;
  c.busy = false;
  const clean = !c.failed && !c.hint && !c.shown;
  const p = c.p;
  const s = app.state;
  const prev = s.records[p.id];
  // A position dropped while it was on the board (a deeper check cleared it) keeps no record.
  if (!c.own || s.mistakes.includes(p)) s.records[p.id] = schedule(prev, clean, Date.now());
  if (!c.own && !prev?.tries && p.rating) {
    const u = updateRating(s.puzzle.rating, s.puzzle.count, p.rating, clean ? 1 : 0);
    s.puzzle = { rating: u.rating, count: s.puzzle.count + 1, history: pushHistory(s.puzzle.history, dateKey(), u.rating) };
    c.delta = u.delta;
  }
  app.save();
  c.arrows = [];
  const answer = !c.offBook && p.line[0] ? sanOf(p, 0) : null;
  const why = c.own || !clean ? p.explanation || '' : '';
  if (clean) {
    cue('success');
    // A puzzle solved cleanly needs no reading: move on. Your own games get a moment.
    c.auto = !c.own;
    say('Solved', why, 'good');
    if (c.auto) autoTimer = setTimeout(() => c === cur && app.page === 'train' && next(), AUTO_NEXT_MS);
  } else if (c.shown) say(answer ? `The move was ${answer}` : 'That was the line', why, 'bad');
  else say('Solved, with help', why || 'It will come back so you can get it clean.', 'good');
}

/** The SAN of the i-th move of a position's line. */
function sanOf(p, i) {
  try {
    const g = new Chess(p.fen);
    if (p.setup) playUci(g, p.setup);
    let san = '';
    for (let k = 0; k <= i; k++) san = playUci(g, p.line[k]).san;
    return san;
  } catch {
    return null;
  }
}

/** First tap: the piece to move. Second: the move itself. Either way the solve is no longer clean. */
async function hint() {
  const c = cur;
  if (!c || c.complete || c.busy || c.setupPending) return;
  c.hint++;
  let move = c.offBook ? null : c.p.line[c.ply];
  if (!move) {
    c.busy = true;
    paint();
    try {
      move = (await engine.analyse(c.game.fen(), { nodes: BUDGET.hint })).best;
    } catch {}
    if (c !== cur) return;
    c.busy = false;
  }
  if (!move) return paint();
  const from = move.slice(0, 2);
  if (c.hint === 1) {
    c.marks = { [from]: 'hint' };
    say(`${side(c.solver)} to move`, `Look at your ${NAMES[c.game.get(from)?.type] || 'piece'} on ${from}.`);
  } else {
    c.marks = {};
    c.arrows = [...(c.playedArrow ? [c.playedArrow] : []), { from, to: move.slice(2, 4), kind: 'hint' }];
    say(`${side(c.solver)} to move`, 'Play the arrow.');
  }
}

/** Play the answer out on the board. */
async function showSolution() {
  const c = cur;
  if (!c || c.complete || c.busy) return;
  c.busy = true;
  c.shown = true;
  c.marks = {};
  c.arrows = [];
  const p = c.p;
  c.game = new Chess(p.fen);
  c.lastMove = [];
  if (p.setup) {
    const s = playUci(c.game, p.setup);
    c.lastMove = [s.from, s.to];
  }
  c.setupPending = false;
  c.offBook = false;
  say('Watch');
  for (const u of p.line) {
    await wait(600);
    if (c !== cur) return;
    const m = playUci(c.game, u);
    c.lastMove = [m.from, m.to];
    paint();
  }
  finish(c);
}

function next() {
  clearTimeout(autoTimer);
  loadNext();
  draw();
}

// On a keyboard, Enter or the space bar moves on once a position is done.
if (typeof document !== 'undefined')
  document.addEventListener('keydown', e => {
    if (app.page !== 'train' || !cur?.complete || document.querySelector('dialog[open]')) return;
    if ((e.key === 'Enter' || e.key === ' ') && !(/** @type {Element} */ (e.target).closest('button, a, input, select'))) {
      e.preventDefault();
      next();
    }
  });
