// Drills: endgames played out against Stockfish, and calculation training
// (follow a line in your head; find every check).
import { Chess } from '../../vendor/chess.js';
import { app } from '../app-context.js';
import { engine } from '../engine.js';
import { BoardView, turnLabel } from '../board.js';
import { $, esc, choosePromotion, plural, settle } from '../ui.js';
import { playUci, moveToUci } from '../chess-utils.js';
import { ENDGAME_DRILLS, drillById, judge, baseline, recordResult } from '../endgames.js';
import {
  makeVisualisation,
  visualisationQuestion,
  nextPlies,
  makeCheckDrill,
  scoreChecks,
  MIN_PLIES,
  VISUAL_ROUNDS,
  CHECK_ROUNDS,
} from '../calc.js';
import { logAttempt, dateKey } from '../state.js';
import { cue } from '../sound.js';

const ENDGAME_NODES = 400000;
const wait = ms => new Promise(r => setTimeout(r, ms));

let root = null;
let board = null;
let view = null; // the drill on screen
let seeds = null;

export const navAs = 'train';

export function render(main, params = {}) {
  root = main;
  const kind = params.drill || 'endgames';
  if (kind === 'endgames' && params.id && drillById(params.id)) startEndgame(drillById(params.id));
  else if (kind === 'visualise') view = { kind: 'visualise', phase: 'intro' };
  else if (kind === 'checks') view = { kind: 'checks', phase: 'intro' };
  else view = { kind: 'endgames', phase: 'list' };
  draw();
}

export function leave() {
  if (view) view.token = (view.token || 0) + 1;
  view = null;
}

function seedFens() {
  if (!seeds) {
    seeds = app.builtIn
      .filter(p => !p.tags?.includes('endgame'))
      .map(p => {
        if (!p.setup) return p.fen;
        const g = new Chess(p.fen);
        playUci(g, p.setup);
        return g.fen();
      });
  }
  return seeds;
}

function top(title, right = '') {
  return `<div class="focus-top">
    <button type="button" id="drill-exit" class="secondary focus-menu" style="margin-left:0" aria-label="Back to training">‹ Training</button>
    <span class="focus-progress" id="drill-progress">${esc(title)}</span>${right}
  </div>`;
}

function draw() {
  if (!root || app.page !== 'drills' || !view) return;
  if (view.kind === 'endgames') view.phase === 'list' ? drawEndgameList() : drawEndgame();
  else if (view.kind === 'visualise') drawVisualise();
  else drawChecks();
  $('#drill-exit', root)?.addEventListener('click', () =>
    view?.kind === 'endgames' && view.phase !== 'list' ? app.navigate('drills', { drill: 'endgames' }) : app.navigate('train'),
  );
}

function say(text, tone = '') {
  if (view) Object.assign(view, { message: text, tone });
  const el = $('#feedback', root);
  if (!el) return;
  el.textContent = text;
  el.className = 'status ' + tone;
  settle(el);
}

// ---------- Endgames ----------

function drawEndgameList() {
  const progress = app.state.endgames;
  root.innerHTML = `<div class="focus">${top('Endgame drills')}
    <p class="muted">Play each ending against Stockfish at full strength. Win the won ones within the move limit, and hold the draws.</p>
    <div class="drill-list">${ENDGAME_DRILLS.map(d => {
      const p = progress[d.id];
      const status = p?.wins
        ? `Won ${p.wins} of ${plural(p.tries, 'try', 'tries')}${d.goal === 'mate' && p.best ? ` · best ${plural(p.best, 'move')}` : ''}`
        : p?.tries
          ? `${plural(p.tries, 'try', 'tries')} so far`
          : 'Not tried yet';
      const goal =
        d.goal === 'mate'
          ? `Mate in ${d.limit} moves or fewer`
          : d.goal === 'promote'
            ? `Promote within ${d.limit} moves`
            : `Hold for ${d.limit} moves`;
      return `<article class="drill ${p?.wins ? 'done' : ''}">
        <div><h3>${esc(d.title)}</h3><p class="small">${esc(goal)} · you play ${d.side === 'b' ? 'Black' : 'White'}</p><p class="small muted">${esc(status)}</p></div>
        <button type="button" class="${p?.wins ? '' : 'primary'}" data-endgame="${d.id}">${p?.tries ? 'Play again' : 'Start'}</button>
      </article>`;
    }).join('')}</div>
  </div>`;
  root
    .querySelectorAll('[data-endgame]')
    .forEach(b => (b.onclick = () => app.navigate('drills', { drill: 'endgames', id: b.dataset.endgame })));
}

function startEndgame(drill) {
  const game = new Chess(drill.fen);
  view = {
    kind: 'endgames',
    phase: 'play',
    drill,
    game,
    you: drill.side || 'w',
    base: baseline(game),
    moves: 0,
    assisted: false,
    busy: false,
    result: null,
    lastMove: [],
    arrows: [],
    token: 0,
    message: drill.intro,
    tone: '',
  };
}

function endgameGoal(v) {
  const d = v.drill;
  if (d.goal === 'draw') return `Hold the draw · move ${Math.min(v.moves + 1, d.limit)} of ${d.limit}`;
  return `${d.goal === 'mate' ? 'Checkmate' : 'Promote'} · move ${Math.min(v.moves + 1, d.limit)} of ${d.limit}`;
}

function drawEndgame() {
  const v = view;
  root.innerHTML = `<div class="focus">${top(v.drill.title)}
    <div class="focus-prompt"><strong id="board-title">${esc(v.result ? (v.result.state === 'won' ? 'Drill complete' : 'Not this time') : endgameGoal(v))}</strong><span class="chip" id="board-chip">${esc(turnLabel(v.game))}</span></div>
    <div class="focus-board"><div id="board"></div></div>
    <div id="feedback" class="status ${v.tone}" role="status" aria-live="polite">${esc(v.message)}</div>
    <div class="focus-actions">
      ${
        v.result
          ? `<button type="button" id="eg-retry">Try again</button><button type="button" class="primary" id="eg-next">${nextDrill(v.drill) ? 'Next drill' : 'All drills'}</button>`
          : `<button type="button" id="eg-hint">Hint</button><button type="button" class="secondary" id="eg-tip">Tip</button><button type="button" class="secondary" id="eg-restart">Restart</button>`
      }
    </div>
  </div>`;
  board = new BoardView($('#board', root), { onMove: endgameMove, askPromotion: choosePromotion, label: 'Endgame drill board' });
  refreshEndgame();
  if (v.result) {
    $('#eg-retry', root).onclick = () => {
      startEndgame(v.drill);
      draw();
    };
    $('#eg-next', root).onclick = () => {
      const n = nextDrill(v.drill);
      app.navigate('drills', n ? { drill: 'endgames', id: n.id } : { drill: 'endgames' });
    };
    $('#eg-next', root).focus({ preventScroll: true });
  } else {
    $('#eg-hint', root).onclick = endgameHint;
    $('#eg-tip', root).onclick = () => say(v.drill.tip);
    $('#eg-restart', root).onclick = () => {
      startEndgame(v.drill);
      draw();
    };
  }
}

function nextDrill(drill) {
  const i = ENDGAME_DRILLS.indexOf(drill);
  return ENDGAME_DRILLS.slice(i + 1).find(d => !app.state.endgames[d.id]?.wins) || ENDGAME_DRILLS[i + 1] || null;
}

function refreshEndgame() {
  const v = view;
  if (!board || v?.kind !== 'endgames') return;
  board.set({
    game: v.game,
    orientation: v.you,
    interactive: !v.result && !v.busy && v.game.turn() === v.you,
    movable: v.you,
    lastMove: v.lastMove,
    arrows: v.arrows,
  });
  const chip = $('#board-chip', root);
  if (chip) chip.textContent = turnLabel(v.game);
  const title = $('#board-title', root);
  if (title && !v.result) title.textContent = endgameGoal(v);
}

async function endgameMove(move) {
  const v = view;
  if (!v || v.result || v.busy || v.game.turn() !== v.you) return;
  let m;
  try {
    m = v.game.move(move);
  } catch {
    return;
  }
  v.moves++;
  v.lastMove = [m.from, m.to];
  v.arrows = [];
  if (checkEnd(v)) return;
  v.busy = true;
  refreshEndgame();
  say('Stockfish is defending…');
  const token = v.token;
  let reply = null;
  try {
    reply = (await engine.analyse(v.game.fen(), { nodes: ENDGAME_NODES })).best;
  } catch (e) {
    v.busy = false;
    refreshEndgame();
    return say(e.message || 'The engine is unavailable. Refresh while online.', 'error');
  }
  if (view !== v || v.token !== token) return;
  v.busy = false;
  if (reply) {
    const r = playUci(v.game, reply);
    v.lastMove = [r.from, r.to];
    board.announce(`Stockfish played ${r.san}.`);
  }
  if (checkEnd(v)) return;
  refreshEndgame();
  say(v.drill.goal === 'draw' ? 'Your move. Keep the defence together.' : 'Your move.');
}

/** Judge the position; finish the drill when it is decided. Returns true when finished. */
function checkEnd(v) {
  const verdict = judge(v.drill, v.game, v.you, v.moves, v.base);
  if (verdict.state === 'playing') return false;
  v.result = verdict;
  const won = verdict.state === 'won';
  app.state.endgames[v.drill.id] = recordResult(app.state.endgames[v.drill.id], { won, moves: v.moves, assisted: v.assisted });
  logAttempt(app.state, { kind: 'e', theme: v.drill.id, clean: won && !v.assisted });
  const today = app.today();
  today.attempts++;
  if (won && !v.assisted) today.clean++;
  app.save();
  v.message = `${verdict.reason}${won && v.drill.goal === 'mate' ? ` ${plural(v.moves, 'move')}.` : ''}${won && v.assisted ? ' You used a hint, so try it once more unaided.' : ''}${won ? '' : ` ${v.drill.tip}`}`;
  v.tone = won ? 'success' : 'error';
  cue(won ? 'success' : 'error');
  draw();
  return true;
}

async function endgameHint() {
  const v = view;
  if (!v || v.result || v.busy) return;
  v.busy = true;
  say('Asking Stockfish…');
  try {
    const best = (await engine.analyse(v.game.fen(), { nodes: ENDGAME_NODES })).best;
    if (view !== v) return;
    v.assisted = true;
    if (best) v.arrows = [{ from: best.slice(0, 2), to: best.slice(2, 4), kind: 'hint' }];
    say(best ? 'Stockfish suggests the arrow. Hints mean this attempt does not count as a clean win.' : 'No suggestion available.');
  } catch (e) {
    say(e.message, 'error');
  }
  v.busy = false;
  refreshEndgame();
}

// ---------- Visualisation ----------

function lineText(fen, sans) {
  const [, turn, , , , full] = fen.split(' ');
  let no = Number(full) || 1;
  let white = turn === 'w';
  const parts = [];
  sans.forEach((san, i) => {
    if (white) parts.push(`${no}. ${san}`);
    else parts.push(i === 0 ? `${no}… ${san}` : san);
    if (!white) no++;
    white = !white;
  });
  return parts.join(' ');
}

function drawVisualise() {
  const v = view;
  const stats = app.state.calc.visual;
  if (v.phase === 'intro' || v.phase === 'done') {
    root.innerHTML = `<div class="focus">${top('Visualisation')}
      <div class="panel">
        <h2>${v.phase === 'done' ? `${v.score} points` : 'See the board in your head'}</h2>
        <p>${
          v.phase === 'done'
            ? `${v.correct} of ${VISUAL_ROUNDS} correct, up to ${plural(v.longest, 'half-move')} deep. ${v.score >= stats.best && v.score > 0 ? 'A new best.' : `Your best is ${stats.best}.`}`
            : `You see a position and a line of moves that is not played on the board. Follow it in your head, then tap the square where the named piece ends up. Lines grow longer as you get them right. ${VISUAL_ROUNDS} rounds; each correct answer scores its length.`
        }</p>
        <div class="actions"><button type="button" class="primary" id="vis-start">${v.phase === 'done' ? 'Go again' : 'Start'}</button></div>
        <p class="small muted">Best ${stats.best} · ${plural(stats.runs, 'run')}</p>
      </div></div>`;
    $('#vis-start', root).onclick = () => {
      view = {
        kind: 'visualise',
        phase: 'play',
        round: 0,
        plies: MIN_PLIES + 1,
        score: 0,
        correct: 0,
        longest: 0,
        q: null,
        answered: null,
      };
      nextVisual();
    };
    return;
  }
  const q = v.q;
  root.innerHTML = `<div class="focus">${top(`Round ${v.round} of ${VISUAL_ROUNDS} · ${v.score} points`)}
    <div class="focus-prompt"><strong id="board-title">${plural(q.sans.length, 'half-move')}</strong><span class="chip" id="board-chip">${q.fen.split(' ')[1] === 'w' ? 'White' : 'Black'} starts</span></div>
    <div class="focus-board"><div id="board"></div></div>
    <p class="calc-line" id="calc-line">${esc(lineText(q.fen, q.sans))}</p>
    <div id="feedback" class="status ${v.tone || ''}" role="status" aria-live="polite">${esc(v.message || visualisationQuestion(q) + ' Tap the square.')}</div>
    <div class="focus-actions">${v.answered !== null ? '<button type="button" class="primary" id="vis-next">Next</button>' : ''}</div>
  </div>`;
  const shown = v.answered !== null ? q.finalFen : q.fen;
  board = new BoardView($('#board', root), { label: 'Visualisation board', onSquare: v.answered === null ? visualAnswer : null });
  const marks = v.answered === null ? {} : { [q.answer]: 'good', ...(v.answered !== q.answer ? { [v.answered]: 'answer' } : {}) };
  board.set({ game: new Chess(shown), orientation: q.fen.split(' ')[1], interactive: false, marks });
  $('#vis-next', root)?.addEventListener('click', nextVisual);
  $('#vis-next', root)?.focus({ preventScroll: true });
}

function nextVisual() {
  const v = view;
  if (v.round >= VISUAL_ROUNDS) return finishVisual();
  v.round++;
  v.q = makeVisualisation(seedFens(), v.plies);
  v.answered = null;
  v.message = '';
  v.tone = '';
  if (!v.q) return finishVisual();
  draw();
}

function visualAnswer(sq) {
  const v = view;
  if (!v || v.answered !== null) return;
  v.answered = sq;
  const correct = sq === v.q.answer;
  const len = v.q.sans.length;
  if (correct) {
    v.score += len;
    v.correct++;
    v.longest = Math.max(v.longest, len);
    v.message = `Yes, ${v.q.answer}. The board now shows the final position.`;
    v.tone = 'success';
  } else {
    v.message = `It ended on ${v.q.answer}. The board now shows the final position: replay the line from there to see where it went.`;
    v.tone = 'error';
  }
  cue(correct ? 'success' : 'error');
  v.plies = nextPlies(v.plies, correct);
  draw();
}

function finishVisual() {
  const v = view;
  const s = app.state.calc.visual;
  app.state.calc.visual = {
    best: Math.max(s.best, v.score),
    runs: s.runs + 1,
    last: [...s.last, { date: dateKey(), score: v.score }].slice(-60),
  };
  logAttempt(app.state, { kind: 'c', theme: 'visual', clean: v.correct >= VISUAL_ROUNDS / 2 });
  app.save();
  v.phase = 'done';
  draw();
}

// ---------- Find every check ----------

function drawChecks() {
  const v = view;
  const stats = app.state.calc.checks;
  if (v.phase === 'intro' || v.phase === 'done') {
    root.innerHTML = `<div class="focus">${top('Find every check')}
      <div class="panel">
        <h2>${v.phase === 'done' ? `${v.score} of ${v.total} checks found` : 'Checks first, every time'}</h2>
        <p>${
          v.phase === 'done'
            ? `${v.wrong ? `${plural(v.wrong, 'false alarm')}. ` : ''}${v.points >= stats.best && v.points > 0 ? 'A new best.' : `Your best is ${stats.best}.`}`
            : `Strong players look at every check before anything else. Each position has several. Play each checking move on the board: it is noted, and the board resets. Press Done when you think you have them all. ${CHECK_ROUNDS} positions.`
        }</p>
        <div class="actions"><button type="button" class="primary" id="chk-start">${v.phase === 'done' ? 'Go again' : 'Start'}</button></div>
        <p class="small muted">Best ${stats.best} · ${plural(stats.runs, 'run')}</p>
      </div></div>`;
    $('#chk-start', root).onclick = () => {
      view = {
        kind: 'checks',
        phase: 'play',
        round: 0,
        score: 0,
        total: 0,
        wrong: 0,
        points: 0,
        drill: null,
        found: [],
        misses: 0,
        revealed: false,
      };
      nextChecks();
    };
    return;
  }
  const d = v.drill;
  root.innerHTML = `<div class="focus">${top(`Position ${v.round} of ${CHECK_ROUNDS}`)}
    <div class="focus-prompt"><strong id="board-title">${v.revealed ? `${v.found.length} of ${d.checks.length} found` : `Checks found: ${v.found.length}`}</strong><span class="chip" id="board-chip">${d.fen.split(' ')[1] === 'w' ? 'White' : 'Black'} to move</span></div>
    <div class="focus-board"><div id="board"></div></div>
    <div id="feedback" class="status ${v.tone || ''}" role="status" aria-live="polite">${esc(v.message || 'Play every move that gives check.')}</div>
    <div class="focus-actions">${v.revealed ? '<button type="button" class="primary" id="chk-next">Next</button>' : '<button type="button" class="primary" id="chk-done">Done</button>'}</div>
  </div>`;
  board = new BoardView($('#board', root), { onMove: checkMove, askPromotion: choosePromotion, label: 'Find every check board' });
  const game = new Chess(d.fen);
  const arrows = v.found.map(u => ({ from: u.slice(0, 2), to: u.slice(2, 4), kind: 'best' }));
  if (v.revealed)
    for (const u of d.checks) if (!v.found.includes(u)) arrows.push({ from: u.slice(0, 2), to: u.slice(2, 4), kind: 'played' });
  board.set({ game, orientation: game.turn(), interactive: !v.revealed, movable: game.turn(), arrows });
  $('#chk-done', root)?.addEventListener('click', revealChecks);
  $('#chk-next', root)?.addEventListener('click', nextChecks);
}

function nextChecks() {
  const v = view;
  if (v.round >= CHECK_ROUNDS) return finishChecks();
  v.round++;
  v.drill = makeCheckDrill(seedFens());
  v.found = [];
  v.revealed = false;
  v.message = '';
  v.tone = '';
  if (!v.drill) return finishChecks();
  draw();
}

function checkMove(move) {
  const v = view;
  if (!v || v.revealed) return;
  const g = new Chess(v.drill.fen);
  let m;
  try {
    m = g.move(move);
  } catch {
    return;
  }
  const uci = moveToUci(m);
  if (v.drill.checks.includes(uci)) {
    if (!v.found.includes(uci)) v.found.push(uci);
    v.message = `${m.san} gives check.`;
    v.tone = 'success';
    cue('check');
    if (v.found.length === v.drill.checks.length) return revealChecks();
  } else {
    v.wrong++;
    v.message = `${m.san} is not a check.`;
    v.tone = 'error';
    cue('error');
  }
  draw();
}

function revealChecks() {
  const v = view;
  const d = v.drill;
  v.revealed = true;
  v.score += v.found.length;
  v.total += d.checks.length;
  const missed = d.checks.length - v.found.length;
  v.message = missed
    ? `You missed ${plural(missed, 'check')}, shown in red: ${sans(
        d.fen,
        d.checks.filter(u => !v.found.includes(u)),
      ).join(', ')}.`
    : `All ${d.checks.length} found.`;
  v.tone = missed ? 'warning' : 'success';
  draw();
}

function sans(fen, ucis) {
  return ucis.map(u => playUci(new Chess(fen), u).san);
}

function finishChecks() {
  const v = view;
  v.points = scoreChecks(v.score, v.wrong);
  const s = app.state.calc.checks;
  app.state.calc.checks = {
    best: Math.max(s.best, v.points),
    runs: s.runs + 1,
    last: [...s.last, { date: dateKey(), score: v.points, total: v.total }].slice(-60),
  };
  logAttempt(app.state, { kind: 'c', theme: 'checks', clean: v.total > 0 && v.score === v.total && !v.wrong });
  app.save();
  v.phase = 'done';
  draw();
}
