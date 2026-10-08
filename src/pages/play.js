// Practice games against Stockfish with an optional coach.
import { Chess } from '../../vendor/chess.js';
import { app } from '../app-context.js';
import { engine, BUDGET } from '../engine.js';
import { BoardView, turnLabel } from '../board.js';
import { $, esc, choosePromotion, confirmDialog, download, toast, settle, showModal, closeModal } from '../ui.js';
import { moveToUci, playUci, opposite } from '../chess-utils.js';
import { LEVELS, levelById, pickNoisyMove, adaptLevel } from '../strength.js';
import { humanMove } from '../maia.js';
import { isTrainableMistake, winPercentLoss } from '../evaluation.js';
import { createMistake, deleteMistake } from '../mistakes.js';
import { dateKey, logGame, logCandidates } from '../state.js';

const SAVE_KEY = 'rankup-practice';
let root = null;
let board = null;
const play = {
  game: new Chess(),
  color: 'w',
  token: 0,
  mistakes: {},
  from: null,
  thinking: false,
  prepared: null,
  note: '',
  lastMove: [],
  recorded: false,
  level: null,
  candidates: [], // squares named before the move, when the habit is on
  marking: false,
};

(function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!saved) return;
    const g = new Chess();
    g.loadPgn(saved.pgn);
    play.game = g;
    play.color = saved.color === 'b' ? 'b' : 'w';
    play.from = saved.from || null;
    play.mistakes = saved.mistakes || {};
    play.recorded = !!saved.recorded;
    play.level = saved.level || null;
  } catch {}
})();

function persist() {
  try {
    localStorage.setItem(
      SAVE_KEY,
      JSON.stringify({
        pgn: play.game.pgn(),
        color: play.color,
        from: play.from,
        mistakes: play.mistakes,
        recorded: play.recorded,
        level: play.level,
      }),
    );
  } catch {}
}

export function render(main, params = {}) {
  root = main;
  // The user keeps the side they solved the puzzle with; Stockfish replies first.
  if (params.fen) newGame({ fen: params.fen, from: params.from || 'a puzzle', color: params.colour || new Chess(params.fen).turn() });
  // A session game: a fresh game unless one is under way, with one thing to practise.
  if (params.objective) {
    play.objective = params.objective;
    if (play.game.isGameOver() || play.from || play.recorded) newGame({ color: play.color });
  }
  draw();
  if (play.game.turn() !== play.color && !play.game.isGameOver() && !play.thinking) engineTurn();
}

function gameStatus() {
  const g = play.game;
  if (g.isCheckmate()) return g.turn() === play.color ? 'Checkmate. Review what opened your king.' : 'Checkmate. Well played.';
  if (g.isStalemate()) return 'Draw by stalemate.';
  if (g.isThreefoldRepetition()) return 'Draw by repetition.';
  if (g.isInsufficientMaterial()) return 'Draw: not enough material to mate.';
  if (g.isDraw()) return 'The game is drawn.';
  if (play.thinking) return 'Stockfish is thinking…';
  return g.turn() === play.color ? 'Your move. Check the threat before choosing.' : 'Stockfish to move.';
}

function moveRecord() {
  const moves = play.game.history({ verbose: true });
  if (!moves.length) return 'Your first move awaits.';
  let out = '';
  moves.forEach((m, i) => {
    const n = Number(m.before.split(' ')[5]);
    if (m.color === 'w') out += `${n}. ${m.san} `;
    else out += (i === 0 ? `${n}… ` : '') + `${m.san} `;
  });
  return out.trim();
}

/** "Maia 1100", "Club 1400", "Full strength". */
function shortLevel(id) {
  return levelById(id)
    .label.replace(/^Plays like a (\d+) player \(Maia\)$/, 'Maia $1')
    .replace(' · about ', ' ');
}

function draw() {
  if (!root) return;
  const g = play.game;
  root.innerHTML = `<div class="focus">
    <div class="focus-top">
      <span class="focus-progress">${esc(shortLevel(app.state.strength))} · you play ${play.color === 'w' ? 'White' : 'Black'}</span>
      <button type="button" id="play-menu" class="secondary focus-menu" aria-haspopup="dialog" aria-label="Game options: opponent, colour, coach, export and review">☰ Options</button>
    </div>
    <div class="focus-prompt"><strong id="board-title">${esc(play.from ? `From: ${play.from}` : 'Practice game')}</strong><span class="chip" id="board-chip"></span></div>
    ${play.objective && !play.from ? `<p class="objective small"><strong>Objective:</strong> ${esc(play.objective)}</p>` : ''}
    <div class="focus-board"><div id="board"></div></div>
    <div id="history" class="history small">${esc(moveRecord())}</div>
    <div id="play-status" class="status" role="status" aria-live="polite">${esc((play.note ? play.note + ' ' : '') + gameStatus())}</div>
    <div class="focus-actions">
      ${
        play.marking
          ? '<button type="button" id="candidates-done" class="primary">Done</button>'
          : `<button type="button" id="new-game" class="primary">New game</button>
             ${app.state.settings.candidates ? `<button type="button" id="candidates" ${g.turn() === play.color && !g.isGameOver() && !play.thinking ? '' : 'disabled'}>Candidates</button>` : ''}
             <button type="button" id="undo-game" ${g.history().length && !play.thinking ? '' : 'disabled'}>Take back</button>`
      }
      <button type="button" id="board-flip" class="secondary" aria-label="Flip board">⇅</button>
    </div>
  </div>`;
  board = new BoardView($('#board', root), { onMove, askPromotion: choosePromotion, label: 'Practice board' });
  refreshBoard();
  $('#board-flip', root).onclick = () => board.set({ orientation: opposite(board.orientation) });
  $('#play-menu', root).onclick = openMenu;
  $('#new-game', root)?.addEventListener('click', () => startNewGame(play.color));
  $('#undo-game', root)?.addEventListener('click', takeBack);
  $('#candidates', root)?.addEventListener('click', () => setMarking(true));
  $('#candidates-done', root)?.addEventListener('click', () => setMarking(false));
}

/** Candidate moves: name up to three squares you are considering before you move. */
function setMarking(on) {
  play.marking = on;
  draw();
  status(
    on
      ? `Tap up to three squares you are thinking of moving to, then Done.${play.candidates.length ? ' Chosen: ' + play.candidates.join(', ') + '.' : ''}`
      : play.candidates.length
        ? `Candidates: ${play.candidates.join(', ')}. Now play your move.`
        : gameStatus(),
  );
}

function toggleCandidate(sq) {
  if (!play.marking) return;
  if (play.candidates.includes(sq)) play.candidates = play.candidates.filter(s => s !== sq);
  else if (play.candidates.length < 3) play.candidates.push(sq);
  else return status('Three candidates is enough. Tap one to remove it, or Done.');
  refreshBoard();
  status(`Candidates: ${play.candidates.join(', ') || 'none yet'}. Tap Done when ready.`);
}

async function startNewGame(colour) {
  if (play.game.history().length && !play.game.isGameOver()) {
    const ok = await confirmDialog({
      title: 'Start a new game?',
      body: 'The current game will be replaced. Export the PGN first if you want to keep it.',
      confirm: 'New game',
    });
    if (!ok) return;
  }
  const c = colour === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : colour;
  newGame({ color: c });
  draw();
  if (play.color === 'b') engineTurn();
}

/** Opponent, colour, coach, export and review live behind one button. */
function openMenu() {
  const level = app.state.strength;
  const g = play.game;
  const option = l => `<option value="${l.id}" ${l.id === level ? 'selected' : ''}>${esc(l.label)}</option>`;
  showModal(`<h2>Game options</h2>
    <div class="field"><label for="difficulty">Opponent</label><select id="difficulty">
      <optgroup label="Human-like (Maia)">${LEVELS.filter(l => l.mode === 'maia')
        .map(option)
        .join('')}</optgroup>
      <optgroup label="Stockfish">${LEVELS.filter(l => l.mode !== 'maia')
        .map(option)
        .join('')}</optgroup>
    </select><small>${app.state.settings.autoLevel ? 'Adjusts to your results after five games at a level. Turn that off in Settings to pin one.' : 'Maia plays like people of that rating; Stockfish levels play engine moves with a strength limit.'}</small></div>
    <div class="field"><label for="play-colour">Your colour</label><select id="play-colour"><option value="w">White</option><option value="b">Black</option><option value="r">Random</option></select></div>
    <div class="checks">
      <label><input type="checkbox" id="coach" ${app.state.coach ? 'checked' : ''}> Coach: save my missed opportunities as exercises</label>
      <label><input type="checkbox" id="candidates-on" ${app.state.settings.candidates ? 'checked' : ''}> Candidate moves: name the squares I am considering before I move</label>
    </div>
    <div class="actions">
      <button type="button" id="menu-new" class="primary">New game</button>
      <button type="button" id="export-game" ${g.history().length ? '' : 'disabled'}>Export PGN</button>
      <button type="button" id="review-game" ${g.history().length >= 6 ? '' : 'disabled'}>Review this game</button>
    </div>`);
  $('#play-colour').value = play.color;
  $('#difficulty').onchange = e => {
    app.state.strength = e.target.value;
    app.save();
    const line = $('.focus-progress', root);
    if (line) line.textContent = `${shortLevel(app.state.strength)} · you play ${play.color === 'w' ? 'White' : 'Black'}`;
  };
  $('#coach').onchange = e => {
    app.state.coach = e.target.checked;
    app.save();
  };
  $('#candidates-on').onchange = e => {
    app.state.settings.candidates = e.target.checked;
    play.candidates = [];
    play.marking = false;
    app.save();
    draw();
  };
  $('#menu-new').onclick = () => {
    const c = $('#play-colour').value;
    closeModal();
    startNewGame(c);
  };
  $('#export-game').onclick = () => download(`rankup-practice-${dateKey()}.pgn`, pgnWithHeaders(), 'application/x-chess-pgn');
  $('#review-game').onclick = () => app.navigate('review', { pgn: pgnWithHeaders(), colour: play.color });
}

function pgnWithHeaders() {
  const g = new Chess();
  g.loadPgn(play.game.pgn());
  const label = levelById(app.state.strength).label;
  g.setHeader('Event', 'Rankup practice');
  g.setHeader('Date', dateKey().replace(/-/g, '.'));
  g.setHeader('White', play.color === 'w' ? 'You' : `Stockfish (${label})`);
  g.setHeader('Black', play.color === 'b' ? 'You' : `Stockfish (${label})`);
  if (play.game.isGameOver()) g.setHeader('Result', play.game.isCheckmate() ? (play.game.turn() === 'w' ? '0-1' : '1-0') : '1/2-1/2');
  return g.pgn();
}

function newGame({ fen = null, color = 'w', from = null }) {
  play.token++;
  play.game = fen ? new Chess(fen) : new Chess();
  play.color = color;
  play.from = from;
  play.mistakes = {};
  play.prepared = null;
  play.thinking = false;
  play.note = '';
  play.lastMove = [];
  play.recorded = false;
  play.candidates = [];
  play.marking = false;
  play.level = fen ? null : app.state.strength; // games from a puzzle position do not count towards the ladder
  engine.newGame();
  persist();
}

/**
 * Once a full game ends, record the result and, when the setting is on, move
 * the opponent up or down the ladder for the next game.
 */
function recordResult() {
  const g = play.game;
  if (play.recorded || !play.level || !g.isGameOver() || g.history().length < 6) return;
  play.recorded = true;
  const result = g.isCheckmate() ? (g.turn() === play.color ? 0 : 1) : 0.5;
  logGame(app.state, { level: play.level, result });
  if (app.state.settings.autoLevel) {
    const next = adaptLevel(app.state.games, play.level);
    if (next.change) {
      app.state.strength = next.level;
      const label = levelById(next.level).label;
      play.note =
        next.change === 'up'
          ? `You are scoring well here. Next game: ${label}.`
          : `A step down for the next game: ${label}. Win a few and it climbs again.`;
      toast(play.note);
      const sel = $('#difficulty');
      if (sel) sel.value = next.level;
      const line = $('.focus-progress', root);
      if (line) line.textContent = `${shortLevel(next.level)} · you play ${play.color === 'w' ? 'White' : 'Black'}`;
    }
  }
  app.save();
  persist();
}

function refreshBoard() {
  if (!board || app.page !== 'play') return;
  const g = play.game;
  board.onSquare = play.marking ? toggleCandidate : null;
  board.set({
    game: g,
    orientation: board.game ? board.orientation : play.color,
    interactive: !play.marking && !play.thinking && g.turn() === play.color && !g.isGameOver(),
    movable: play.color,
    lastMove: play.lastMove,
    marks: Object.fromEntries(play.candidates.map(sq => [sq, 'hint'])),
  });
  const chip = $('#board-chip');
  if (chip) chip.textContent = turnLabel(g);
  const h = $('#history');
  if (h) {
    h.textContent = moveRecord();
    h.scrollTop = h.scrollHeight;
  }
  const undo = $('#undo-game');
  if (undo) undo.disabled = !g.history().length || play.thinking;
  if ($('#export-game')) $('#export-game').disabled = !g.history().length;
  if ($('#review-game')) $('#review-game').disabled = g.history().length < 6;
}

function status(text, tone = '') {
  if (app.page !== 'play') return;
  const el = $('#play-status');
  if (el && el.textContent !== text) {
    el.textContent = text;
    el.className = 'status ' + tone;
    settle(el);
  } else if (el) el.className = 'status ' + tone;
}

function prepareCoach() {
  if (!app.state.coach || play.game.isGameOver() || play.game.turn() !== play.color) return;
  const fen = play.game.fen();
  const promise = engine.analyse(fen, { nodes: BUDGET.coach });
  promise.catch(() => {});
  play.prepared = { fen, promise };
}

async function onMove(move) {
  const g = play.game;
  if (play.thinking || g.turn() !== play.color || g.isGameOver()) return;
  const token = play.token;
  const fen = g.fen();
  play.thinking = true;
  play.note = '';
  refreshBoard();
  try {
    let before = null;
    const named = play.candidates.slice();
    if (app.state.coach || named.length) {
      status('Coach is checking the position…');
      before = await (play.prepared?.fen === fen ? play.prepared.promise : engine.analyse(fen, { nodes: BUDGET.coach }));
    }
    if (token !== play.token) return;
    const m = g.move(move);
    play.lastMove = [m.from, m.to];
    play.candidates = [];
    if (named.length && before?.best) {
      const bestSan = playUci(new Chess(fen), before.best).san;
      const hit = named.includes(before.best.slice(2, 4));
      logCandidates(app.state, hit);
      app.save();
      play.note = hit
        ? `The engine's best, ${bestSan}, was among your candidates.`
        : `The engine preferred ${bestSan}, which was not among your candidates.`;
    }
    persist();
    refreshBoard();
    board.announce(`You played ${m.san}.`);
    if (g.isGameOver()) return recordResult();
    const level = levelById(app.state.strength);
    let after = null;
    if (app.state.coach || level.mode === 'noise' || level.mode === 'full') {
      after = await engine.analyse(g.fen(), { nodes: BUDGET.coach, multipv: level.mode === 'noise' ? level.multipv : 1 });
    }
    if (token !== play.token) return;
    if (app.state.coach && before && after && moveToUci(m) !== before.best && isTrainableMistake(before.score, after.score)) {
      const saved = createMistake({
        fen,
        played: m.san,
        before,
        after,
        loss: winPercentLoss(before.score, after.score),
        source: { practice: true },
      });
      if (saved) {
        // Only positions created by this game are undone by a takeback.
        if (saved.created) play.mistakes[g.history().length - 1] = saved.mistake.id;
        persist();
        play.note = 'Coach: a stronger move was available. Saved to My mistakes for later.';
      }
    }
    status((play.note ? play.note + ' ' : '') + 'Stockfish is thinking…');
    await engineMove(token, after, level);
  } catch (e) {
    if (token === play.token) status(e.message, 'error');
  } finally {
    if (token === play.token) {
      play.thinking = false;
      refreshBoard();
      status((play.note ? play.note + ' ' : '') + gameStatus(), play.note ? 'warning' : '');
      prepareCoach();
    }
  }
}

async function engineMove(token, after, level) {
  const g = play.game;
  const fen = g.fen();
  let uci = null;
  if (level.mode === 'full') {
    uci = after?.best || (await engine.analyse(fen, { nodes: BUDGET.coach })).best;
  } else if (level.mode === 'noise') {
    const lines = after?.lines?.length
      ? after.lines
      : (await engine.analyse(fen, { nodes: BUDGET.opponent, multipv: level.multipv })).lines;
    uci = pickNoisyMove(lines, g.moves({ verbose: true }).map(moveToUci), level);
  } else if (level.mode === 'maia') {
    try {
      uci = await humanMove({ level: level.maia, game: g });
    } catch (e) {
      // The network could not load (for example offline before first use): fall back to Stockfish.
      toast(e.message + ' Using Stockfish for this move.');
      uci = (await engine.analyse(fen, { elo: Math.max(1320, level.elo), movetime: 500 })).best;
    }
  } else {
    uci = (await engine.analyse(fen, { elo: level.elo, movetime: 500 })).best;
  }
  if (token !== play.token || !uci) return;
  const m = playUci(g, uci);
  play.lastMove = [m.from, m.to];
  persist();
  if (board) board.announce(`Stockfish played ${m.san}.`);
  if (g.isGameOver()) recordResult();
}

async function engineTurn() {
  const token = play.token;
  play.thinking = true;
  refreshBoard();
  status('Stockfish is thinking…');
  try {
    await engineMove(token, null, levelById(app.state.strength));
  } catch (e) {
    if (token === play.token) status(e.message, 'error');
  } finally {
    if (token === play.token) {
      play.thinking = false;
      refreshBoard();
      status(gameStatus());
      prepareCoach();
    }
  }
}

function takeBack() {
  const g = play.game;
  if (play.thinking || !g.history().length) return;
  g.undo();
  if (g.turn() !== play.color && g.history().length) g.undo();
  const length = g.history().length;
  let removed = 0;
  for (const [ply, id] of Object.entries(play.mistakes)) {
    if (Number(ply) < length) continue;
    if (!app.state.records[id]?.tries) {
      deleteMistake(id);
      removed++;
    }
    delete play.mistakes[ply];
  }
  play.token++;
  play.prepared = null;
  play.note = '';
  play.lastMove = [];
  persist();
  refreshBoard();
  status(gameStatus());
  if (removed) toast(`Removed ${removed === 1 ? 'the mistake' : removed + ' mistakes'} saved for that move.`);
  if (g.turn() !== play.color) engineTurn();
  else prepareCoach();
}
