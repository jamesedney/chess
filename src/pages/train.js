// Today's training: adaptive puzzle sessions, personal mistakes and vision sprints.
import { Chess } from '../../vendor/chess.js';
import { app } from '../app-context.js';
import { engine, BUDGET } from '../engine.js';
import { BoardView, turnLabel } from '../board.js';
import { $, $$, esc, choosePromotion, plural, showModal, closeModal, settle } from '../ui.js';
import { schedule, choosePuzzle, dueCount, isMistake } from '../srs.js';
import { updateRating, pushHistory, weakestTheme } from '../rating.js';
import { judgeAlternative, rejectionMessage } from '../verify.js';
import { moveToUci, playUci, uciLineToSan, opposite, NAMES } from '../chess-utils.js';
import { hintForTags, displayTags } from '../themes.js';
import { dateKey, streaks, logAttempt } from '../state.js';
import { makeVisionDrill, isVisionAnswer } from '../vision.js';
import { archiveMistake } from '../mistakes.js';
import { cue } from '../sound.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
const SPRINT_MS = 60000;
const PENALTY_MS = 3000;

let root = null;
let session = null;
let current = null;
let board = null;
let vision = null;
let seeds = null;

function newSession(mode = 'daily', theme = null) {
  session = { mode, theme, done: 0, clean: 0, seen: [], finished: false, ratingStart: app.state.puzzle.rating };
  current = null;
}

function loadNext() {
  const target = app.state.puzzle.rating + app.state.difficulty;
  const p = choosePuzzle({
    puzzles: app.allPuzzles(),
    records: app.state.records,
    mode: session.mode,
    theme: session.theme,
    seen: session.seen,
    target,
    weakTheme: weakestTheme(app.state.themes),
    now: Date.now(),
  });
  loadPuzzle(p);
}

function loadPuzzle(p) {
  if (!p) {
    current = null;
    return;
  }
  session.seen.push(p.id);
  const game = new Chess(p.fen);
  const solver = p.setup ? opposite(game.turn()) : game.turn();
  current = {
    puzzle: p,
    game,
    solver,
    ply: 0,
    solverMade: 0,
    solverMoves: Math.ceil(p.line.length / 2),
    failed: false,
    hint: 0,
    complete: false,
    offBook: false,
    busy: false,
    setupPending: !!p.setup,
    lastMove: [],
    marks: {},
    arrows: [],
    message: p.setup ? 'Watch the opponent’s move, then find the reply.' : 'Your move. Scan checks, captures and threats first.',
    tone: '',
  };
}

export function render(main, params = {}) {
  root = main;
  if (params.puzzle) {
    const p = app.findPuzzle(params.puzzle);
    newSession(p && isMistake(p) ? 'mistakes' : 'daily');
    if (p) loadPuzzle(p);
  } else if (params.mode) {
    startSession(params.mode, params.theme || null, false);
  }
  if (!session) startSession('daily', null, false);
  draw();
}

export function leave() {
  // A sprint cannot pause: leaving the page abandons it.
  if (vision?.phase === 'running') vision = { phase: 'ready', score: 0, misses: 0 };
  stopVisionTimer();
}

function startSession(mode, theme, redraw = true) {
  stopVisionTimer();
  newSession(mode, theme);
  if (mode === 'vision') vision = { phase: 'ready', score: 0, misses: 0 };
  else {
    vision = null;
    loadNext();
  }
  if (redraw) draw();
}

/** The thin line above the board: where you are in the session, and the menu. */
function topLine() {
  const s = app.state;
  const goal = s.goal;
  let progress;
  if (session.mode === 'vision') progress = `Vision sprint · best ${s.vision.best}`;
  else {
    const n = Math.min(session.done + (current && !current.complete ? 1 : 0), goal) || Math.min(session.done, goal);
    progress = `${Math.max(1, n)} of ${goal} · rating ${s.puzzle.rating}`;
  }
  const chip = session.theme
    ? `<span class="chip">${esc(session.theme)} <button type="button" class="chip-close" id="clear-theme" aria-label="Clear theme filter">×</button></span>`
    : session.mode === 'mistakes'
      ? '<span class="chip">My mistakes</span>'
      : '';
  return `<div class="focus-top">
    <span id="focus-progress" class="focus-progress">${esc(progress)}</span>
    ${chip}
    <button type="button" id="train-menu" class="secondary focus-menu" aria-haspopup="dialog" aria-label="Training menu: modes and today’s numbers">☰ Mode</button>
  </div>`;
}

/** Stats and modes, shown on request rather than above the board. */
function openMenu() {
  const s = app.state;
  const today = s.days[dateKey()];
  const streak = streaks(s.days);
  const due = dueCount(app.allPuzzles(), s.records, Date.now());
  const active = app.activeMistakes().length;
  showModal(`<h2>Training</h2>
    <div class="stat-row four compact">
      <div class="stat"><small>Today’s reps</small><strong>${today?.attempts || 0}<span class="small"> / ${s.goal}</span></strong></div>
      <div class="stat"><small>Streak</small><strong>${plural(streak.current, 'day')}</strong></div>
      <div class="stat"><small>Ready to revisit</small><strong>${due}</strong></div>
      <div class="stat"><small>Puzzle rating</small><strong>${s.puzzle.rating}</strong></div>
    </div>
    <h3>Mode</h3>
    <div class="pill-row" role="group" aria-label="Training mode">
      <button type="button" data-mode="daily" class="${session.mode === 'daily' && !session.theme ? 'active' : ''}">Adaptive session</button>
      <button type="button" data-mode="mistakes" class="${session.mode === 'mistakes' ? 'active' : ''}">My mistakes · ${active}</button>
      <button type="button" data-mode="vision" class="${session.mode === 'vision' ? 'active' : ''}">Vision sprint</button>
    </div>
    <h3>Drills</h3>
    <div class="pill-row" role="group" aria-label="Drills">
      <button type="button" data-drill="endgames">Endgames vs Stockfish</button>
      <button type="button" data-drill="visualise">Visualisation</button>
      <button type="button" data-drill="checks">Find every check</button>
    </div>
    ${session.theme ? `<p class="small">Theme filter: ${esc(session.theme)}. Choosing a mode clears it.</p>` : ''}
    <div class="actions"><button type="button" id="menu-flip">⇅ Flip board</button><button type="button" id="menu-progress">See progress</button></div>`);
  $$('#modal [data-mode]').forEach(
    b =>
      (b.onclick = () => {
        closeModal();
        startSession(b.dataset.mode);
      }),
  );
  $$('#modal [data-drill]').forEach(
    b =>
      (b.onclick = () => {
        closeModal();
        app.navigate('drills', { drill: b.dataset.drill });
      }),
  );
  $('#menu-progress').onclick = () => {
    closeModal();
    app.navigate('progress');
  };
  $('#menu-flip').onclick = () => {
    closeModal();
    if (board) board.set({ orientation: opposite(board.orientation) });
  };
}

function draw() {
  if (!root || app.page !== 'train') return;
  root.innerHTML = '<div class="focus">' + topLine() + '<div id="train-body"></div></div>';
  $('#train-menu', root).onclick = openMenu;
  $('#clear-theme', root)?.addEventListener('click', () => startSession('daily'));
  const body = $('#train-body', root);
  if (session.mode === 'vision') return drawVision(body);
  if (session.finished) return drawFinished(body);
  if (!current) return drawEmpty(body);
  drawPuzzle(body);
}

function drawEmpty(body) {
  const mistakes = session.mode === 'mistakes';
  body.innerHTML = `<div class="empty">
    <strong>${mistakes ? 'Your mistake bank is empty.' : session.theme ? 'No positions for this theme yet.' : 'Nothing to train right now.'}</strong>
    <p class="muted">${mistakes ? 'Play a practice game or review one of your games. Missed opportunities become personal exercises here.' : 'Try an adaptive session or review one of your games.'}</p>
    <div class="actions center"><button type="button" class="primary" id="go-review">Review a game</button><button type="button" id="go-play">Play a practice game</button></div>
  </div>`;
  $('#go-review', body).onclick = () => app.navigate('review');
  $('#go-play', body).onclick = () => app.navigate('play');
}

function drawFinished(body) {
  const change = app.state.puzzle.rating - session.ratingStart;
  body.innerHTML = `<div class="panel dark-panel"><div class="eyebrow">SESSION COMPLETE</div><h2>Good work. Let it settle.</h2>
    <p>${session.clean} of ${session.done} positions solved without help.${change ? ` Puzzle rating ${change > 0 ? '+' : '−'}${Math.abs(change)} this session.` : ''} Missed and hinted positions return sooner.</p>
    <div class="actions"><button type="button" id="again" class="lime">Train another session</button><button type="button" id="to-progress">See progress</button></div></div>`;
  $('#again', body).onclick = () => startSession(session.mode, session.theme);
  $('#to-progress', body).onclick = () => app.navigate('progress');
}

function drawPuzzle(body) {
  const c = current;
  const p = c.puzzle;
  const tags = c.complete ? displayTags(p.tags || []) : [];
  const ratingText = isMistake(p) ? 'your game' : p.rating ? `rated ${p.rating}` : '';
  body.innerHTML = `
    <div class="focus-prompt">
      <strong id="board-title">${esc(c.complete ? 'Position complete' : p.goal)}</strong>
      <span class="chip" id="board-chip"></span>
    </div>
    <div class="focus-board"><div id="board"></div></div>
    <div class="focus-meta small">${esc(p.theme)}${ratingText ? ' · ' + ratingText : ''}${isMistake(p) ? ` · you played ${esc(p.played || 'a weaker move')}` : ''}</div>
    <div id="feedback" class="status ${c.tone}" role="status" aria-live="polite">${esc(c.message)}</div>
    ${tags.length ? `<div class="tag-row">${tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
    <div class="focus-actions">
      ${
        c.complete
          ? `${c.game.isGameOver() ? '' : '<button type="button" id="play-out">Play it out</button>'}
             ${isMistake(p) ? '<button type="button" id="archive" class="secondary" aria-label="Remove from my mistakes">Remove</button>' : ''}
             <button type="button" class="primary" id="next">Next position</button>`
          : `<button type="button" id="hint">${c.hint ? 'More help' : 'Hint'}</button>
             <button type="button" id="solution">Solution</button>
             <button type="button" class="secondary" id="skip" aria-label="Skip to the next position">Skip</button>`
      }
    </div>`;
  board = new BoardView($('#board', body), { onMove: handleMove, askPromotion: choosePromotion, label: 'Puzzle board' });
  refreshBoard();
  if (c.complete) {
    $('#next', body).onclick = next;
    $('#play-out', body)?.addEventListener('click', () => app.navigate('play', { fen: c.game.fen(), from: p.title, colour: c.solver }));
    $('#archive', body)?.addEventListener('click', () => {
      archiveMistake(p.id);
      next();
    });
    $('#next', body).focus({ preventScroll: true });
  } else {
    $('#hint', body).onclick = hint;
    $('#solution', body).onclick = showSolution;
    $('#skip', body).onclick = skip;
  }
  if (c.setupPending) playSetup(c);
}

/** Give up on this position without recording an attempt; it stays in the pool. */
function skip() {
  const c = current;
  if (!c || c.complete) return;
  if (session.done >= app.state.goal) session.finished = true;
  else loadNext();
  draw();
}

function refreshBoard() {
  const c = current;
  if (!board || !c || app.page !== 'train') return;
  board.set({
    game: c.game,
    orientation: board.game ? board.orientation : c.solver,
    interactive: !c.complete && !c.setupPending && !c.busy,
    movable: c.solver,
    lastMove: c.lastMove,
    marks: c.marks,
    arrows: c.arrows,
  });
  const chip = $('#board-chip');
  if (chip) chip.textContent = turnLabel(c.game);
  const prog = $('#focus-progress');
  if (prog)
    prog.textContent = `${Math.max(1, Math.min(session.done + (c.complete ? 0 : 1), app.state.goal))} of ${app.state.goal} · rating ${app.state.puzzle.rating}`;
}

function feedback(message, tone = '') {
  current.message = message;
  current.tone = tone;
  if (app.page !== 'train') return;
  const el = $('#feedback');
  if (el) {
    el.textContent = message;
    el.className = 'status ' + tone;
    settle(el);
  }
}

async function playSetup(c) {
  await wait(700);
  if (c !== current || !c.setupPending) return;
  const m = playUci(c.game, c.puzzle.setup);
  c.lastMove = [m.from, m.to];
  c.setupPending = false;
  refreshBoard();
  feedback(`${c.solver === 'w' ? 'Black' : 'White'} played ${m.san}. Your move.`);
  board.announce(`Opponent played ${m.san}. Your move.`);
}

async function handleMove(move) {
  const c = current;
  if (!c || c.complete || c.busy || c.setupPending) return;
  const beforeFen = c.game.fen();
  let m;
  try {
    m = c.game.move(move);
  } catch {
    return;
  }
  c.marks = {};
  c.arrows = [];
  const expected = c.offBook ? null : c.puzzle.line[c.ply];
  if (c.game.isCheckmate() || (expected && moveToUci(m) === expected)) return acceptMove(c, m, null, false);
  if (!engine.available) return rejectMove(c, m, null);
  c.busy = true;
  c.lastMove = [m.from, m.to];
  refreshBoard();
  feedback('Checking your move with Stockfish…');
  try {
    const before = await engine.analyse(beforeFen, { nodes: BUDGET.verify });
    const after = c.game.isGameOver() ? null : await engine.analyse(c.game.fen(), { nodes: BUDGET.verify });
    if (c !== current) return;
    c.busy = false;
    const verdict = judgeAlternative({
      before,
      after,
      mateExpected: (c.puzzle.tags || []).includes('mate'),
      remainingMoves: c.solverMoves - c.solverMade - 1,
    });
    if (verdict.accepted) {
      c.offBook = true;
      return acceptMove(c, m, after?.best || null, true);
    }
    rejectMove(c, m, verdict.reason);
  } catch {
    if (c !== current) return;
    c.busy = false;
    rejectMove(c, m, null);
  }
}

function rejectMove(c, m, reason) {
  c.game.undo();
  c.failed = true;
  c.lastMove = [];
  refreshBoard();
  board.flash(m.to);
  cue('error');
  feedback(rejectionMessage(reason), 'error');
  board.announce('Not the solution. Try again.');
}

async function acceptMove(c, m, engineReply, alternative) {
  c.solverMade++;
  if (!c.offBook) c.ply++;
  c.lastMove = [m.from, m.to];
  refreshBoard();
  if (c.game.isGameOver() || c.solverMade >= c.solverMoves) return finish(c, false);
  c.busy = true;
  refreshBoard();
  feedback(alternative ? 'That works too. Now the opponent replies…' : 'Good. Now the opponent replies…', 'success');
  await wait(500);
  if (c !== current) return;
  let reply = c.offBook ? engineReply : c.puzzle.line[c.ply];
  if (c.offBook && !reply) {
    try {
      reply = (await engine.analyse(c.game.fen(), { nodes: BUDGET.verify })).best;
    } catch {}
  }
  if (c !== current) return;
  c.busy = false;
  if (!reply) return finish(c, false);
  const r = playUci(c.game, reply);
  if (!c.offBook) c.ply++;
  c.lastMove = [r.from, r.to];
  refreshBoard();
  board.announce(`Opponent played ${r.san}. Your move.`);
  if (c.game.isGameOver()) return finish(c, false);
  feedback(`Opponent played ${r.san}. Find your next move.`);
}

function finish(c, revealed) {
  if (c.complete) return;
  c.complete = true;
  c.busy = false;
  const clean = !c.failed && !c.hint && !revealed;
  const p = c.puzzle;
  const s = app.state;
  const prev = s.records[p.id];
  s.records[p.id] = schedule(prev, clean, Date.now());
  let ratingNote = '';
  if (!prev?.tries && !isMistake(p) && p.rating) {
    const t = s.themes[p.theme] || { rating: s.puzzle.rating, count: 0 };
    const u = updateRating(s.puzzle.rating, s.puzzle.count, p.rating, clean ? 1 : 0);
    s.puzzle = { rating: u.rating, count: s.puzzle.count + 1, history: pushHistory(s.puzzle.history, dateKey(), u.rating) };
    const tu = updateRating(t.rating, t.count, p.rating, clean ? 1 : 0);
    s.themes[p.theme] = { rating: tu.rating, count: t.count + 1 };
    ratingNote = ` Puzzle rating ${u.rating} (${u.delta >= 0 ? '+' : '−'}${Math.abs(u.delta)}).`;
  }
  const today = app.today();
  today.attempts++;
  if (clean) today.clean++;
  logAttempt(s, { kind: isMistake(p) ? 'm' : 'p', theme: isMistake(p) ? p.kind || 'positional' : p.theme, clean });
  session.done++;
  if (clean) session.clean++;
  app.save();
  const lead = clean
    ? 'Solved without help.'
    : revealed
      ? 'Study this line, then try it again later.'
      : 'Good recovery. This position will return soon.';
  let mainLine = '';
  if (c.offBook) {
    const start = new Chess(p.fen);
    if (p.setup) playUci(start, p.setup);
    mainLine = ` The stored line was ${uciLineToSan(Chess, start.fen(), p.line).join(' ')}.`;
  }
  c.message = `${lead}${ratingNote} ${p.explanation || ''}${mainLine}`.replace(/\s+/g, ' ').trim();
  c.tone = 'success';
  if (clean) cue('success');
  draw();
}

async function hint() {
  const c = current;
  if (!c || c.complete || c.busy || c.setupPending) return;
  c.hint++;
  let move = c.offBook ? null : c.puzzle.line[c.ply];
  if (!move && c.hint > 1) {
    try {
      c.busy = true;
      move = (await engine.analyse(c.game.fen(), { nodes: BUDGET.hint })).best;
    } catch {}
    c.busy = false;
    if (c !== current) return;
  }
  if (c.hint === 1) {
    feedback(hintForTags(c.puzzle.tags || []) + (isMistake(c.puzzle) ? ' Compare it with the move you played.' : ''));
  } else if (c.hint === 2 && move) {
    c.marks = { [move.slice(0, 2)]: 'hint' };
    const piece = c.game.get(move.slice(0, 2));
    feedback(`Move the ${NAMES[piece?.type] || 'piece'} on ${move.slice(0, 2)}.`);
  } else if (move) {
    c.arrows = [{ from: move.slice(0, 2), to: move.slice(2, 4), kind: 'hint' }];
    feedback(`Play the arrow: ${move.slice(0, 2)} to ${move.slice(2, 4)}.`);
  }
  refreshBoard();
  const h = $('#hint');
  if (h) h.textContent = 'More help';
}

async function showSolution() {
  const c = current;
  if (!c || c.complete || c.busy) return;
  c.busy = true;
  c.failed = true;
  c.marks = {};
  c.arrows = [];
  const p = c.puzzle;
  c.game = new Chess(p.fen);
  if (p.setup) {
    const s = playUci(c.game, p.setup);
    c.lastMove = [s.from, s.to];
  }
  c.setupPending = false;
  const sans = [];
  refreshBoard();
  for (const u of p.line) {
    await wait(650);
    if (c !== current) return;
    const m = playUci(c.game, u);
    sans.push(m.san);
    c.lastMove = [m.from, m.to];
    refreshBoard();
    feedback('Solution: ' + sans.join(' '));
  }
  finish(c, true);
}

function next() {
  if (session.done >= app.state.goal) session.finished = true;
  else loadNext();
  draw();
}

// ---------- Vision sprint ----------

function visionSeeds() {
  if (!seeds) {
    seeds = app.builtIn.map(p => {
      if (!p.setup) return p.fen;
      const g = new Chess(p.fen);
      playUci(g, p.setup);
      return g.fen();
    });
  }
  return seeds;
}

function stopVisionTimer() {
  if (vision?.timer) clearInterval(vision.timer);
  if (vision) vision.timer = null;
}

function drawVision(body) {
  const v = vision;
  const best = app.state.vision.best;
  body.innerHTML = `
    <div class="focus-prompt"><strong id="board-title">Find the free piece</strong><span class="chip" id="board-chip"></span></div>
    <div class="focus-board"><div id="board"></div></div>
    ${
      v.phase === 'running'
        ? `<div class="sprint"><div><small>Time</small><strong id="sprint-time">60</strong></div><div><small>Found</small><strong id="sprint-score">${v.score}</strong></div></div>
           <div id="feedback" class="status" role="status" aria-live="polite">Capture the one enemy piece that is free to take.</div>`
        : `<div class="status" role="status">${
            v.phase === 'done'
              ? `${plural(v.score, 'piece')} found. ${v.score >= best && v.score > 0 ? 'A new best score.' : `Your best is ${best}.`}`
              : 'One minute. Each position has exactly one enemy piece you can take for free. Find it and capture it. A wrong move costs three seconds.'
          }</div>
           <div class="focus-actions"><span class="small">Best ${best} · ${plural(app.state.vision.runs, 'sprint')}</span><button type="button" class="primary" id="sprint-start">${v.phase === 'done' ? 'Go again' : 'Start sprint'}</button></div>`
    }`;
  board = new BoardView($('#board', body), { onMove: visionMove, askPromotion: async () => 'q', label: 'Vision sprint board' });
  $('#sprint-start', body)?.addEventListener('click', startSprint);
  if (v.phase === 'running' && v.drill) showDrill();
  else board.set({ game: new Chess(), interactive: false });
}

function startSprint() {
  vision = { phase: 'running', score: 0, misses: 0, endsAt: Date.now() + SPRINT_MS, drill: null, timer: null, locked: false };
  vision.drill = makeVisionDrill(visionSeeds());
  draw();
  vision.timer = setInterval(tickSprint, 200);
  tickSprint();
}

function showDrill(marks = {}) {
  const g = new Chess(vision.drill.fen);
  board.set({ game: g, orientation: g.turn(), interactive: !vision.locked, movable: g.turn(), marks, lastMove: [] });
  const chip = $('#board-chip');
  if (chip) chip.textContent = turnLabel(g);
}

function tickSprint() {
  const left = Math.max(0, vision.endsAt - Date.now());
  const t = $('#sprint-time');
  if (t) t.textContent = Math.ceil(left / 1000);
  if (left <= 0) endSprint();
}

async function visionMove(move) {
  const v = vision;
  if (!v || v.phase !== 'running' || v.locked) return;
  const g = new Chess(v.drill.fen);
  let m;
  try {
    m = g.move(move);
  } catch {
    return;
  }
  v.locked = true;
  if (isVisionAnswer(v.drill, m)) {
    v.score++;
    $('#sprint-score').textContent = v.score;
    feedbackVision(`Yes: ${m.san} wins the ${NAMES[v.drill.piece]}.`, 'success');
    showDrill({ [v.drill.target]: 'good' });
    await wait(350);
  } else {
    v.misses++;
    v.endsAt -= PENALTY_MS;
    feedbackVision(`Not that one. The free piece was the ${NAMES[v.drill.piece]} on ${v.drill.target} (${v.drill.answer}).`, 'error');
    showDrill({ [v.drill.target]: 'answer' });
    await wait(1100);
  }
  if (vision !== v || v.phase !== 'running') return;
  v.drill = makeVisionDrill(visionSeeds());
  v.locked = false;
  showDrill();
}

function feedbackVision(text, tone) {
  const el = $('#feedback');
  if (el) {
    el.textContent = text;
    el.className = 'status ' + tone;
  }
}

function endSprint() {
  const v = vision;
  if (!v || v.phase !== 'running') return;
  stopVisionTimer();
  v.phase = 'done';
  const s = app.state;
  s.vision = {
    best: Math.max(s.vision.best, v.score),
    runs: s.vision.runs + 1,
    last: [...(s.vision.last || []), { date: dateKey(), score: v.score }].slice(-60),
  };
  const today = app.today();
  today.vision = (today.vision || 0) + 1;
  logAttempt(s, { kind: 'v', theme: 'sprint', clean: v.score > 0 });
  app.save();
  if (app.page === 'train') draw();
}
