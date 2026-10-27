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
import { pickPositions, BUCKETS, ROUNDS as ASSESS_ROUNDS, scoreGuess, evalText, playerBias, calibration } from '../assess.js';
import { explainPosition } from '../structure.js';
import { cue } from '../sound.js';
import { dueCards, repertoireCards, lineText as repLine } from '../repertoire.js';
import { strugglingLines, recordText, MIN_GAMES } from '../opening-practice.js';
import { schedule } from '../srs.js';

const ENDGAME_NODES = 400000;
const wait = ms => new Promise(r => setTimeout(r, ms));

let root = null;
let board = null;
let view = null; // the drill on screen
let seeds = null;

export function render(main, params = {}) {
  root = main;
  const kind = params.drill || 'endgames';
  if (kind === 'endgames' && params.id && drillById(params.id)) startEndgame(drillById(params.id));
  else if (kind === 'visualise') view = { kind: 'visualise', phase: 'intro' };
  else if (kind === 'checks') view = { kind: 'checks', phase: 'intro' };
  else if (kind === 'assess') view = { kind: 'assess', phase: 'intro' };
  else if (kind === 'openings') view = { kind: 'openings', phase: 'list' };
  else if (kind === 'repertoire') {
    view = { kind: 'repertoire', phase: 'intro' };
    // From today's plan: start straight away on the positions due.
    if (params.limit) startRepertoire(Number(params.limit));
  } else view = { kind: 'endgames', phase: 'list' };
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
  else if (view.kind === 'assess') drawAssess();
  else if (view.kind === 'openings') drawOpenings();
  else if (view.kind === 'repertoire') drawRepertoire();
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

/** "1. Kd1 Kf5 2. Nd5": the line numbered from 1, not from the game's move number. */
function lineText(fen, sans) {
  const [, turn] = fen.split(' ');
  let no = 1;
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
    <div class="focus-prompt"><strong id="board-title">Play these moves in your head</strong><span class="chip" id="board-chip">${plural(q.sans.length, 'move')}</span></div>
    <p class="calc-line" id="calc-line">${esc(lineText(q.fen, q.sans))}</p>
    <div class="focus-board"><div id="board"></div></div>
    <div id="feedback" class="status ${v.tone || ''}" role="status" aria-live="polite">${esc(
      v.message || `The board stays still. ${visualisationQuestion(q)} Tap the square.`,
    )}</div>
    <div class="focus-actions">${v.answered !== null ? '<button type="button" class="primary" id="vis-next">Next</button>' : ''}</div>
  </div>`;
  // Always White at the bottom: the board does not flip between rounds.
  const orientation = 'w';
  // A new draw cancels any replay still running from the round before.
  v.replay = (v.replay || 0) + 1;
  board = new BoardView($('#board', root), { label: 'Visualisation board', onSquare: v.answered === null ? visualAnswer : null });
  $('#vis-next', root)?.addEventListener('click', nextVisual);
  $('#vis-next', root)?.focus({ preventScroll: true });
  if (v.answered === null) {
    // The piece to follow is ringed where it starts.
    board.set({ game: new Chess(q.fen), orientation, interactive: false, marks: { [q.piece.from]: 'hint' } });
    return;
  }
  // After the answer the line plays out on the board, one move at a time, so you see where it went.
  const marks = { [q.answer]: 'good', ...(v.answered !== q.answer ? { [v.answered]: 'answer' } : {}) };
  const token = v.replay;
  const g = new Chess(q.fen);
  board.set({ game: new Chess(q.fen), orientation, interactive: false, marks: { [q.piece.from]: 'hint' } });
  (async () => {
    for (const san of q.sans) {
      await wait(650);
      if (view !== v || v.q !== q || v.replay !== token) return;
      const m = g.move(san);
      board.set({ game: new Chess(g.fen()), orientation, interactive: false, lastMove: [m.from, m.to], marks: {} });
    }
    await wait(350);
    if (view !== v || v.q !== q || v.replay !== token) return;
    board.set({ game: new Chess(q.finalFen), orientation, interactive: false, marks });
  })();
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
    v.message = `Yes, ${v.q.answer}.`;
    v.tone = 'success';
  } else {
    v.message = `It ends on ${v.q.answer}. Watch the line play out.`;
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

// ---------- Assess the position ----------

function drawAssess() {
  const v = view;
  const stats = app.state.calc.assess;
  if (v.phase === 'intro' || v.phase === 'done') {
    const cal = calibration(stats.last);
    const available = pickPositions(app.state.reviews, { count: 1, Chess }).length > 0;
    root.innerHTML = `<div class="focus">${top('Assess the position')}
      <div class="panel">
        <h2>${v.phase === 'done' ? `${v.score} of ${v.total * 2} points` : 'Who is better, and by how much?'}</h2>
        <p>${
          v.phase === 'done'
            ? `${v.exact} of ${v.total} exactly right. ${v.bias >= 0.4 ? 'In this run you rated your own side too highly.' : v.bias <= -0.4 ? 'In this run you rated your own side too low.' : 'Your judgement in this run was balanced.'} ${v.score >= stats.best && v.score > 0 ? 'A new best.' : `Your best is ${stats.best}.`}`
            : `Positions from your own games, at your move. Say who stands better; the engine’s verdict is the answer. Two points for the right call, one for the next bucket. ${ASSESS_ROUNDS} positions.`
        }</p>
        <p class="small">${esc(cal.text)}</p>
        ${
          available
            ? `<div class="actions"><button type="button" class="primary" id="assess-start">${v.phase === 'done' ? 'Go again' : 'Start'}</button></div>`
            : '<p class="status">This drill uses your reviewed games, and there are none yet. Review a game or link an account in Settings.</p><div class="actions"><button type="button" class="primary" id="assess-review">Review a game</button></div>'
        }
        <p class="small muted">Best ${stats.best} · ${plural(stats.runs, 'run')}</p>
      </div></div>`;
    $('#assess-start', root)?.addEventListener('click', () => {
      const positions = pickPositions(app.state.reviews, { Chess });
      view = { kind: 'assess', phase: 'play', positions, round: 0, score: 0, exact: 0, biases: [], q: null, answered: null };
      nextAssess();
    });
    $('#assess-review', root)?.addEventListener('click', () => app.navigate('review'));
    return;
  }
  const q = v.q;
  const game = new Chess(q.fen);
  const truth = v.answered !== null ? evalText(q.evalWhite) : '';
  root.innerHTML = `<div class="focus">${top(`Position ${v.round} of ${v.positions.length} · ${v.score} points`)}
    <div class="focus-prompt"><strong id="board-title">${v.answered === null ? 'Who is better?' : 'Engine: ' + esc(truth)}</strong><span class="chip" id="board-chip">${esc(turnLabel(game))}</span></div>
    <div class="focus-board"><div id="board"></div></div>
    <div class="focus-meta small">${esc(q.label)} · you were ${q.colour === 'w' ? 'White' : 'Black'}</div>
    ${
      v.answered === null
        ? `<div class="choices assess-choices" role="group" aria-label="Your assessment">${BUCKETS.map((b, i) => `<button type="button" class="choice" data-bucket="${i}">${esc(b.label)}</button>`).join('')}</div>`
        : `<div id="feedback" class="status ${v.tone}" role="status" aria-live="polite">${esc(v.message)}</div>
           <div class="focus-actions"><button type="button" class="primary" id="assess-next">Next</button></div>`
    }
  </div>`;
  board = new BoardView($('#board', root), { label: 'Assessment board' });
  board.set({ game, orientation: q.colour, interactive: false });
  root.querySelectorAll('[data-bucket]').forEach(b => (b.onclick = () => answerAssess(Number(b.dataset.bucket))));
  $('#assess-next', root)?.addEventListener('click', nextAssess);
  $('#assess-next', root)?.focus({ preventScroll: true });
}

function nextAssess() {
  const v = view;
  if (v.round >= v.positions.length) return finishAssess();
  v.q = v.positions[v.round];
  v.round++;
  v.answered = null;
  v.message = '';
  v.tone = '';
  draw();
}

function answerAssess(i) {
  const v = view;
  if (!v || v.answered !== null) return;
  v.answered = i;
  const pts = scoreGuess(i, v.q.evalWhite);
  v.score += pts;
  if (pts === 2) v.exact++;
  v.biases.push(playerBias(i, v.q.evalWhite, v.q.colour));
  const facts = explainPosition(new Chess(v.q.fen), v.q.evalWhite);
  const verdict = BUCKETS[bucketIndex(v.q.evalWhite)].label.toLowerCase();
  v.message = `${pts === 2 ? 'Right' : pts === 1 ? 'Close' : 'No'}: ${verdict} (${evalText(v.q.evalWhite)}). ${facts.slice(0, 3).join(' ')}`;
  v.tone = pts === 2 ? 'success' : pts === 1 ? 'warning' : 'error';
  cue(pts ? 'success' : 'error');
  draw();
}

function bucketIndex(evalWhite) {
  return BUCKETS.findIndex(b => evalWhite >= b.min);
}

function finishAssess() {
  const v = view;
  const total = v.positions.length;
  const bias = v.biases.length ? v.biases.reduce((a, b) => a + b, 0) / v.biases.length : 0;
  const s = app.state.calc.assess;
  app.state.calc.assess = {
    best: Math.max(s.best, v.score),
    runs: s.runs + 1,
    last: [...s.last, { date: dateKey(), score: v.score, total, bias: Math.round(bias * 100) / 100 }].slice(-60),
  };
  logAttempt(app.state, { kind: 'c', theme: 'assess', clean: total > 0 && v.score >= total * 1.2 });
  app.save();
  Object.assign(v, { phase: 'done', total, bias });
  draw();
}

// ---------- Repertoire ----------

/** Practise the positions due (or, when none are, the first few), at most `limit`. */
function startRepertoire(limit = 10) {
  const due = dueCards(app.state);
  const cards = (due.length ? due : repertoireCards(app.state.reviews)).slice(0, limit);
  view = {
    kind: 'repertoire',
    phase: cards.length ? 'play' : 'intro',
    cards,
    i: 0,
    tries: 0,
    answered: false,
    clean: 0,
    message: '',
    resultHtml: '',
    tone: '',
  };
}

function drawRepertoire() {
  const v = view;
  if (v.phase !== 'play') {
    const all = repertoireCards(app.state.reviews);
    const due = dueCards(app.state).length;
    const weak = strugglingLines(app.state.reviews, 3);
    root.innerHTML = `<div class="focus">${top('Your repertoire')}
      <div class="panel">
        <h2>${v.phase === 'done' ? `${v.clean} of ${v.cards.length} from memory` : 'Your openings, from your games'}</h2>
        <p>${
          all.length
            ? `${plural(all.length, 'position')} you reach in your games, with your move there, or the engine’s better move where you lost ground. ${due ? `${due} due now.` : 'All caught up.'}`
            : 'Review a few of your games and the positions you keep reaching appear here, with the moves to play.'
        }</p>
        ${weak.length ? `<h3>Openings you struggle with</h3>${openingList(weak)}` : ''}
        ${all.length ? `<div class="actions"><button type="button" class="primary" id="rep-start">${due ? `Practise ${Math.min(due, 10)} positions` : 'Practise anyway'}</button></div>` : '<div class="actions"><button type="button" class="primary" id="rep-review">Your games</button></div>'}
      </div></div>`;
    $('#rep-start', root)?.addEventListener('click', () => {
      startRepertoire(10);
      draw();
    });
    $('#rep-review', root)?.addEventListener('click', () => app.navigate('review'));
    bindOpenings(weak);
    return;
  }
  const c = v.cards[v.i];
  const game = new Chess(c.fen);
  const side = c.colour === 'w' ? 'White' : 'Black';
  // Once answered, the board shows the move played: framed, and with an arrow.
  let lastMove = [];
  const arrows = [];
  if (v.answered) {
    const m = game.move(c.answer);
    lastMove = [m.from, m.to];
    arrows.push({ from: m.from, to: m.to, kind: 'best' });
  }
  const record =
    c.games === 1
      ? c.score === 1
        ? '1 game, won'
        : c.score === 0
          ? '1 game, lost'
          : '1 game, drawn'
      : `${c.games} games, you scored ${Math.round(c.score * 100)}%`;
  const question = c.fix ? `You played ${numbered(c, c.played)} here. Find a better move.` : `What do you play here as ${side}?`;
  root.innerHTML = `<div class="focus">${top(`Position ${v.i + 1} of ${v.cards.length}`)}
    <div class="rep-line">
      <span class="small">${c.line.length ? 'Your opening' : 'The first move'} · ${esc(record)}</span>
      ${c.line.length ? `<p class="focus-meta">${lineHTML(c.line)}</p>` : ''}
    </div>
    <div class="focus-prompt"><strong id="board-title">${esc(v.answered ? numbered(c, c.answer) : question)}</strong><span class="chip" id="board-chip">${v.answered ? '' : esc(`${side} to move`)}</span></div>
    <div class="focus-board"><div id="board"></div></div>
    <div id="feedback" class="status ${v.tone}" role="status" aria-live="polite" ${v.resultHtml || v.message ? '' : 'hidden'}>${v.resultHtml || esc(v.message)}</div>
    <div class="focus-actions">${
      v.answered
        ? '<button type="button" class="primary" id="rep-next">Next</button>'
        : '<button type="button" id="rep-show">Show the move</button>'
    }</div>
  </div>`;
  board = new BoardView($('#board', root), {
    label: 'Repertoire board',
    askPromotion: choosePromotion,
    onMove: v.answered ? null : repertoireMove,
  });
  board.set({ game, orientation: c.colour, interactive: !v.answered, movable: c.colour, lastMove, arrows });
  $('#rep-show', root)?.addEventListener('click', () => answerRepertoire(false, true));
  $('#rep-next', root)?.addEventListener('click', () => {
    v.i++;
    Object.assign(v, { tries: 0, answered: false, message: '', resultHtml: '', tone: '' });
    if (v.i >= v.cards.length) v.phase = 'done';
    draw();
  });
  $('#rep-next', root)?.focus({ preventScroll: true });
}

/** A move with its number in the line: "5… Qd4" or "6. Nc3". */
function numbered(c, san) {
  const n = Math.floor(c.ply / 2) + 1;
  return c.colour === 'w' ? `${n}.\u00a0${san}` : `${n}…\u00a0${san}`;
}

/** The opening so far, with the move just played in bold. */
function lineHTML(line) {
  const parts = repLine(line).split(' ');
  const last = parts.pop();
  return `${esc(parts.join(' '))} <strong>${esc(last)}</strong>`;
}

/** "tomorrow", "in 3 days". */
function whenNext(due, now = Date.now()) {
  const days = Math.max(1, Math.round((due - now) / 86400000));
  return days === 1 ? 'tomorrow' : `in ${days} days`;
}

function repertoireMove(move) {
  const v = view;
  const c = v.cards[v.i];
  let m;
  try {
    m = new Chess(c.fen).move(move);
  } catch {
    return;
  }
  if (m.san === c.answer) return answerRepertoire(v.tries === 0, false);
  v.tries++;
  cue('error');
  board.flash(m.to);
  if (v.tries >= 2) return answerRepertoire(false, true);
  say(
    c.fix && m.san === c.played
      ? `That is what you played in your game, and it cost you. One more try.`
      : c.fix
        ? 'Not the better move. One more try.'
        : 'Not your usual move here. One more try.',
    'error',
  );
}

function answerRepertoire(clean, shown) {
  const v = view;
  const c = v.cards[v.i];
  const record = schedule(app.state.rep[c.id], clean, Date.now());
  app.state.rep[c.id] = record;
  logAttempt(app.state, { kind: 'o', theme: c.colour, clean });
  if (clean) v.clean++;
  app.save();
  v.answered = true;
  cue(clean ? 'success' : 'error');
  const move = numbered(c, c.answer);
  const head = clean ? `Correct: ${move}.` : shown ? `The move is ${move}.` : `Yes: ${move}, on your second try.`;
  const why = c.fix
    ? `In your game you played ${numbered(c, c.played)}, which cost you ${c.loss}% winning chances.`
    : `You played it here in ${c.count} of ${plural(c.games, 'game')}.`;
  const next = clean ? `Next review ${whenNext(record.due)}.` : 'You will see it again later today.';
  Object.assign(v, {
    message: '',
    resultHtml: `<strong>${esc(head)}</strong> ${esc(why)} <span class="small">${esc(next)}</span>`,
    tone: clean ? 'success' : '',
  });
  draw();
}

/** Your weak lines, each with a button to play a practice game from there. */
function openingList(lines) {
  return `<ul class="weak-lines">${lines
    .map(
      (l, i) => `<li><div><span class="small">As ${l.colour === 'w' ? 'White' : 'Black'} · ${esc(recordText(l))}</span>
        <strong>${esc(l.text)}</strong></div><button type="button" data-line="${i}">Play</button></li>`,
    )
    .join('')}</ul>`;
}

/** A practice game from the line, where your opponents' moves from your games come first. */
function bindOpenings(lines) {
  root.querySelectorAll('[data-line]').forEach(b =>
    b.addEventListener('click', () => {
      const l = lines[Number(b.dataset.line)];
      app.navigate('play', { fen: l.fen, from: l.text, colour: l.colour, book: 1 });
    }),
  );
}

function drawOpenings() {
  const lines = strugglingLines(app.state.reviews);
  root.innerHTML = `<div class="focus">${top('Openings')}
    <div class="panel">
      <h2>Openings you struggle with</h2>
      <p>${
        lines.length
          ? 'Play on from where these lines go wrong. Your opponent answers with the moves your real opponents played, then plays on at your level.'
          : `None yet. A line shows here once you have scored under 40% in at least ${MIN_GAMES} reviewed games through it.`
      }</p>
      ${lines.length ? openingList(lines) : '<div class="actions"><button type="button" class="primary" id="rep-review">Your games</button></div>'}
    </div></div>`;
  $('#rep-review', root)?.addEventListener('click', () => app.navigate('review'));
  bindOpenings(lines);
}
