// Practice games against Stockfish with an optional coach, on a clock when asked.
import { Chess } from '../../vendor/chess.js';
import { app } from '../app-context.js';
import { engine, BUDGET } from '../engine.js';
import { BoardView, turnLabel } from '../board.js';
import { $, esc, choosePromotion, confirmDialog, download, toast, settle, showModal, closeModal } from '../ui.js';
import { moveToUci, playUci, opposite } from '../chess-utils.js';
import { LEVELS, levelById, pickNoisyMove, adaptLevel } from '../strength.js';
import { humanMove, humanMoves } from '../maia.js';
import { nemesisMove, maiaFor, trapText, trapTally } from '../nemesis.js';
import { isTrainableMistake, winPercentLoss } from '../evaluation.js';
import { createMistake, deleteMistake } from '../mistakes.js';
import { dateKey, logGame, logCandidates, logAttempt } from '../state.js';
import { replayCandidates, nextReplay, opponentLevel, judgeReplay, recordReplay, goalText, MAX_MOVES } from '../replay.js';
import { makeClock, startTurn, endTurn, timeLeft, flagged, userControl, controlText, clockText } from '../gameclock.js';
import { thresholds, rushedText } from '../clocks.js';
import { opponentMove } from '../opening-practice.js';

const SAVE_KEY = 'rankup-practice';
/** Under this many seconds the clock chip turns urgent. */
const URGENT_SECONDS = 30;
let root = null;
let board = null;
let clockTimer = null; // the 250 ms tick of the user's clock
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
  challenge: null, // Play it again: { id, goal, text, level, moves, clock, done: null | 'success' | 'fail' }
  clock: null, // the user's clock (gameclock.js) or null when the game is untimed
  blunders: 0, // coach mistakes saved this game
  fast: 0, // of those, played in under the control's rushed threshold
  flagged: false, // the game ended because the clock ran out
  book: false, // opening practice: the opponent plays your real opponents' moves while they have one
  nemesis: false, // the opponent sets traps your likely move falls into
  trap: null, // the trap in the position you are in, if Nemesis set one: { uci, san, p, loss, best }
  traps: [], // this game's traps: [{ san, loss, taken }]
};

(function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!saved) {
      play.color = pickColour();
      return;
    }
    const g = new Chess();
    g.loadPgn(saved.pgn);
    play.game = g;
    play.color = saved.color === 'b' ? 'b' : 'w';
    play.from = saved.from || null;
    play.mistakes = saved.mistakes || {};
    play.recorded = !!saved.recorded;
    play.level = saved.level || null;
    play.challenge = saved.challenge || null;
    // A reload pauses the clock; it starts again on your turn.
    play.clock = saved.clock && typeof saved.clock === 'object' ? { ...saved.clock, running: false, at: null } : null;
    play.blunders = saved.blunders || 0;
    play.fast = saved.fast || 0;
    play.flagged = !!saved.flagged;
    play.book = !!saved.book;
    play.nemesis = !!saved.nemesis;
    play.trap = saved.trap || null;
    play.traps = Array.isArray(saved.traps) ? saved.traps : [];
  } catch {}
})();

/** Your colour for a new game: your choice in Options, or White or Black at random (the default). */
function pickColour() {
  const c = app.state.settings.colour;
  return c === 'w' || c === 'b' ? c : Math.random() < 0.5 ? 'w' : 'b';
}

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
        challenge: play.challenge,
        clock: play.clock,
        blunders: play.blunders,
        fast: play.fast,
        flagged: play.flagged,
        book: play.book,
        nemesis: play.nemesis,
        trap: play.trap,
        traps: play.traps,
      }),
    );
  } catch {}
}

/** The control a `clock` parameter asks for: 1 for your most played, "180+2" for that one; null for none. */
function clockParam(value) {
  if (value === 1 || value === '1') return userControl(app.state.ledger);
  const m = /^(\d+)\+(\d+)$/.exec(String(value ?? ''));
  return m ? { base: Number(m[1]), inc: Number(m[2]) } : null;
}

/** The control for a free game: your most played when the Clock option is on, else none. */
function freeClock() {
  return app.state.settings.clock ? userControl(app.state.ledger) : null;
}

export function render(main, params = {}) {
  root = main;
  stopClockTimer();
  if (params.replay) startReplay(params.replay);
  // The user keeps the side they solved the puzzle with; Stockfish replies first.
  if (params.fen) {
    newGame({ fen: params.fen, from: params.from || 'a puzzle', color: params.colour || new Chess(params.fen).turn() });
    if (params.book) {
      play.book = true;
      persist();
    }
  }
  // A session game: a fresh game unless one is under way, with one thing to practise, on a clock when asked.
  const control = clockParam(params.clock);
  const nemesis = params.nemesis === 1 || params.nemesis === '1';
  if (params.objective || control || nemesis) {
    if (params.objective) play.objective = params.objective;
    const fresh = !play.game.history().length;
    if (play.game.isGameOver() || play.from || play.recorded || (control && fresh) || (nemesis && !play.nemesis))
      newGame({ color: pickColour(), clock: control, nemesis });
  }
  // A free game not yet begun takes the Clock option as it stands.
  if (!play.clock && !play.game.history().length && !play.from && !play.challenge && app.state.settings.clock) {
    play.clock = makeClock(freeClock());
    persist();
  }
  draw();
  if (play.game.turn() !== play.color && !play.game.isGameOver() && !play.thinking && !play.flagged) engineTurn();
  else beginUserTurn();
}

/** Leaving the page pauses your clock where it stands, as a reload does; it runs again when you come back. */
export function leave() {
  stopClockTimer();
  if (play.clock?.running) {
    haltClock();
    persist();
  }
}

// ---------- The clock ----------

function stopClockTimer() {
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = null;
}

/** Your turn begins: the clock runs once the opponent's move is on the board (or a replay position is set). */
function beginUserTurn() {
  const g = play.game;
  const ch = play.challenge;
  if (!play.clock || play.flagged || g.isGameOver() || g.turn() !== play.color || ch?.done) return;
  if (!g.history().length && !ch) return;
  if (ch && ch.moves >= MAX_MOVES) return; // being judged
  startTurn(play.clock, Date.now());
  persist();
  if (!clockTimer) clockTimer = setInterval(tickClock, 250);
  tickClock();
}

/** Stop the clock where it stands (a challenge settled, or time run out). */
function haltClock(now = Date.now()) {
  const c = play.clock;
  if (!c) return;
  c.left = timeLeft(c, now);
  c.running = false;
  c.at = null;
}

function tickClock() {
  const c = play.clock;
  if (!c || app.page !== 'play' || !c.running) return stopClockTimer();
  const now = Date.now();
  updateClockChip(now);
  // While your move is being validated the time up to the tap is what counts.
  if (!play.thinking && flagged(c, now)) flagOut(now);
}

function updateClockChip(now = Date.now()) {
  const el = $('#play-clock');
  if (!el || !play.clock) return;
  const left = timeLeft(play.clock, now);
  const text = clockText(left);
  if (el.textContent !== text) el.textContent = text;
  el.classList.toggle('urgent', left < URGENT_SECONDS);
}

/** Out of time: the game is lost, as online. */
function flagOut(now = Date.now()) {
  if (play.flagged) return;
  play.flagged = true;
  haltClock(now);
  stopClockTimer();
  play.token++;
  play.thinking = false;
  play.prepared = null;
  play.marking = false;
  if (play.challenge) settleChallenge({ result: 'loss', timed: true });
  else recordResult();
  persist();
  draw();
}

/** "Blunders 2, in under 4.5 seconds 1, 0:41 left." */
function clockLine() {
  const c = play.clock;
  return `Blunders ${play.blunders}, in ${rushedText(c)} ${play.fast}, ${clockText(timeLeft(c))} left.`;
}

/** The line above the board: "Maia 1500 · you play White · 5+0". */
function progressText(level) {
  const who = play.nemesis ? `Nemesis (${shortLevel(level)})` : shortLevel(level);
  return `${who} · you play ${play.color === 'w' ? 'White' : 'Black'}${play.clock ? ` · ${controlText(play.clock)}` : ''}`;
}

function gameStatus() {
  const g = play.game;
  if (play.flagged) return play.challenge ? '' : 'You lost on time.';
  const over = g.isCheckmate()
    ? g.turn() === play.color
      ? 'Checkmate. Review what opened your king.'
      : 'Checkmate. Well played.'
    : g.isStalemate()
      ? 'Draw by stalemate.'
      : g.isThreefoldRepetition()
        ? 'Draw by repetition.'
        : g.isInsufficientMaterial()
          ? 'Draw: not enough material to mate.'
          : g.isDraw()
            ? 'The game is drawn.'
            : '';
  if (over) {
    const tally = play.nemesis ? trapTally(play.traps) : '';
    return [over, play.clock ? clockLine() : '', tally].filter(Boolean).join(' ');
  }
  if (play.thinking) return `${opponentName()} is thinking…`;
  if (play.challenge?.done) return play.clock ? clockLine() : '';
  return g.turn() === play.color ? 'Your move. Check the threat before choosing.' : `${opponentName()} to move.`;
}

/** Nemesis plays like a person of your rating: the Maia level nearest your real rating, else your puzzle rating. */
function nemesisLevel() {
  const real = app.state.ratings.at(-1)?.rating;
  return levelById(`maia${maiaFor(real || app.state.puzzle.rating)}`);
}

/** The opponent for this game: the challenge's, Nemesis, or your chosen practice level. */
function currentLevel() {
  if (play.challenge) return levelById(play.challenge.level);
  if (play.nemesis) return nemesisLevel();
  return levelById(app.state.strength);
}

/** Who the practice opponent is: Nemesis, Maia for the human-like levels, otherwise Stockfish. */
function opponentName() {
  return play.nemesis ? 'Nemesis' : currentLevel().mode === 'maia' ? 'Maia' : 'Stockfish';
}

// ---------- Play it again ----------

/** Start a challenge from one of your games: the position before your mistake, against their strength, on their clock. */
function startReplay(id) {
  const c = replayCandidates(app.state).find(x => x.id === id);
  if (!c) return toast('That position is no longer in your games.');
  const yours = app.state.ratings.at(-1)?.rating || app.state.puzzle.rating;
  // The game's control names the clock; the seconds you had before the mistake are what is left.
  const base = app.state.reviews.find(r => r.id === c.reviewId)?.tc?.base ?? c.clock?.left;
  newGame({ fen: c.fen, from: `your game against ${c.opponent}`, color: c.colour, clock: c.clock ? { base, inc: c.clock.inc } : null });
  if (play.clock) play.clock.left = c.clock.left;
  play.challenge = {
    id: c.id,
    goal: c.goal,
    text: goalText(c),
    level: opponentLevel(c.oppElo, yours),
    moves: 0,
    clock: c.clock,
    done: null,
  };
  persist();
}

/** An evaluation from your side in words: "+3.1", "−0.4", "a forced mate for you". */
function evalWords(cp) {
  if (Math.abs(cp) >= 10000) return cp > 0 ? 'a forced mate for you' : 'a forced mate against you';
  const pawns = Math.abs(cp / 100).toFixed(1);
  return cp >= 0 ? `+${pawns} for you` : `−${pawns} against you`;
}

/** The game ended, or reached the move limit: judge it, save it, say plainly what happened. */
function settleChallenge({ result = null, evalUser = null, stopped = false, timed = false }) {
  const ch = play.challenge;
  if (!ch || ch.done) return;
  haltClock();
  const success = judgeReplay(ch.goal, { result, evalUser });
  ch.done = success ? 'success' : 'fail';
  recordReplay(app.state, ch.id, success, dateKey(), { flagged: timed, left: play.clock ? Math.round(play.clock.left) : null });
  logAttempt(app.state, { kind: 'r', theme: ch.goal, clean: success });
  app.save();
  persist();
  const what = timed
    ? 'you lost on time'
    : stopped
      ? 'you stopped'
      : result === 'win'
        ? 'you won the game'
        : result === 'draw'
          ? 'the game was drawn'
          : result === 'loss'
            ? 'you lost the game'
            : `after ${ch.moves} moves Stockfish has it at ${evalWords(evalUser)}`;
  const convert = ch.goal === 'convert';
  play.note = success
    ? `Passed. In your game ${convert ? 'this win slipped away' : 'you lost from here'}; this time ${what}.`
    : `Not passed: ${what}. ${
        convert
          ? `To pass, win or be +4.0 or better after ${MAX_MOVES} moves.`
          : `To pass, draw or win, or be no worse than −1.0 after ${MAX_MOVES} moves.`
      } This position comes back for another try.`;
}

/** The challenge line above the board, with your clock and your move count while it is running. */
function challengeText() {
  const ch = play.challenge;
  return `<strong>Play it again:</strong> ${esc(ch.text)}${ch.clock ? ` You have ${clockText(ch.clock.left)}.` : ''}${
    ch.moves && !ch.done ? ` Move ${ch.moves} of ${MAX_MOVES}.` : ''
  }`;
}

const resultFor = g => (g.isCheckmate() ? (g.turn() === play.color ? 'loss' : 'win') : 'draw');

/** Ask the engine where the position stands, from your side. */
async function judgeNow() {
  const ch = play.challenge;
  if (!ch || ch.done || play.thinking) return;
  const token = play.token;
  play.thinking = true;
  refreshBoard();
  status('Stockfish is judging the position…');
  try {
    const r = await engine.analyse(play.game.fen(), { nodes: BUDGET.coach });
    if (token !== play.token) return;
    const mine = play.game.turn() === play.color;
    const score = r.mate ? (r.mate > 0 ? 10000 : -10000) : r.score;
    settleChallenge({ evalUser: mine ? score : -score });
  } catch (e) {
    if (token === play.token) status(e.message, 'error');
  } finally {
    if (token === play.token) {
      play.thinking = false;
      draw();
    }
  }
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
  const left = play.clock ? timeLeft(play.clock) : 0;
  root.innerHTML = `<div class="focus">
    <div class="focus-top">
      <span class="focus-progress">${esc(progressText(currentLevel().id))}</span>
      <button type="button" id="play-menu" class="secondary focus-menu" aria-haspopup="dialog" aria-label="Game options: opponent, colour, coach, clock, export and review">Options</button>
    </div>
    <div class="focus-prompt"><strong id="board-title">${esc(play.from ? `From: ${play.from}` : play.nemesis ? 'Nemesis' : 'Practice game')}</strong>${
      play.clock
        ? `<span class="chip sprint-clock${left < URGENT_SECONDS ? ' urgent' : ''}" id="play-clock" role="timer" aria-live="off">${clockText(left)}</span>`
        : '<span class="chip" id="board-chip"></span>'
    }</div>
    ${play.nemesis ? '<p class="objective small">Nemesis plays like a person of your level, and sets the traps your likely move falls into. Every trap is scored: taken or declined.</p>' : ''}
    ${play.objective && !play.from ? `<p class="objective small"><strong>Objective:</strong> ${esc(play.objective)}</p>` : ''}
    ${play.challenge ? `<p class="objective small" id="challenge-text">${challengeText()}</p>` : ''}
    <div class="focus-board"><div id="board"></div></div>
    <div id="history" class="history small">${esc(moveRecord())}</div>
    <div id="play-status" class="status ${play.challenge?.done === 'success' ? 'success' : ''}" role="status" aria-live="polite">${esc((play.note ? play.note + ' ' : '') + gameStatus())}</div>
    <div class="focus-actions">
      ${
        play.marking
          ? '<button type="button" id="candidates-done" class="primary">Done</button>'
          : play.challenge && !play.challenge.done
            ? `<button type="button" id="judge" ${play.challenge.moves >= 10 && !play.thinking && !g.isGameOver() ? '' : 'disabled'}>Judge position</button>
               <button type="button" id="give-up" class="secondary">Stop</button>`
            : play.challenge
              ? `<button type="button" id="replay-again">Try again</button>
                 <button type="button" id="replay-next" class="primary">${nextReplay(app.state) ? 'Next position' : 'New game'}</button>`
              : `<button type="button" id="new-game" class="primary">New game</button>
             ${app.state.settings.candidates ? `<button type="button" id="candidates" ${g.turn() === play.color && !g.isGameOver() && !play.thinking && !play.flagged ? '' : 'disabled'}>Candidates</button>` : ''}
             <button type="button" id="undo-game" ${g.history().length && !play.thinking && !play.clock ? '' : 'disabled'}>Take back</button>`
      }
      <button type="button" id="board-flip" class="secondary" aria-label="Flip board"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 20V4M4.5 7.5 8 4l3.5 3.5M16 4v16M12.5 16.5 16 20l3.5-3.5"/></svg></button>
    </div>
  </div>`;
  board = new BoardView($('#board', root), { onMove, askPromotion: choosePromotion, label: 'Practice board' });
  refreshBoard();
  $('#board-flip', root).onclick = () => board.set({ orientation: opposite(board.orientation) });
  $('#play-menu', root).onclick = openMenu;
  $('#new-game', root)?.addEventListener('click', () => startNewGame(app.state.settings.colour));
  $('#undo-game', root)?.addEventListener('click', takeBack);
  $('#candidates', root)?.addEventListener('click', () => setMarking(true));
  $('#candidates-done', root)?.addEventListener('click', () => setMarking(false));
  $('#judge', root)?.addEventListener('click', judgeNow);
  $('#give-up', root)?.addEventListener('click', () => {
    settleChallenge({ result: 'loss', stopped: true });
    draw();
  });
  $('#replay-again', root)?.addEventListener('click', () => {
    startReplay(play.challenge.id);
    draw();
    if (play.game.turn() !== play.color) engineTurn();
    else beginUserTurn();
  });
  $('#replay-next', root)?.addEventListener('click', () => {
    const next = nextReplay(app.state);
    if (next) startReplay(next.id);
    else newGame({ color: pickColour(), clock: freeClock() });
    draw();
    if (play.game.turn() !== play.color) engineTurn();
    else beginUserTurn();
  });
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
  if (play.game.history().length && !play.game.isGameOver() && !play.flagged) {
    const ok = await confirmDialog({
      title: 'Start a new game?',
      body: 'The current game will be replaced. Export the PGN first if you want to keep it.',
      confirm: 'New game',
    });
    if (!ok) return;
  }
  const c = colour === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : colour;
  newGame({ color: c, clock: freeClock(), nemesis: !!app.state.settings.nemesis });
  draw();
  if (play.color === 'b') engineTurn();
}

/** Opponent, colour, coach, clock, export and review live behind one button. */
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
    <div class="field"><label for="play-colour">Your colour</label><select id="play-colour"><option value="r">Random</option><option value="w">White</option><option value="b">Black</option></select><small>For each new game. This game: ${play.color === 'w' ? 'White' : 'Black'}.</small></div>
    <div class="checks">
      <label><input type="checkbox" id="nemesis-on" ${app.state.settings.nemesis ? 'checked' : ''}> Nemesis: the opponent sets the traps my likely move falls into (new games)</label>
      <label><input type="checkbox" id="coach" ${app.state.coach ? 'checked' : ''}> Coach: save my missed opportunities as exercises</label>
      <label><input type="checkbox" id="candidates-on" ${app.state.settings.candidates ? 'checked' : ''}> Candidate moves: name the squares I am considering before I move</label>
      <label><input type="checkbox" id="clock-on" ${app.state.settings.clock ? 'checked' : ''}> Clock: ${esc(userControl(app.state.ledger).text)} in free games (your most played control)</label>
    </div>
    <div class="actions">
      <button type="button" id="menu-new" class="primary">New game</button>
      <button type="button" id="export-game" ${g.history().length ? '' : 'disabled'}>Export PGN</button>
      <button type="button" id="review-game" ${g.history().length >= 6 ? '' : 'disabled'}>Review this game</button>
    </div>`);
  $('#play-colour').value = app.state.settings.colour;
  $('#play-colour').onchange = e => {
    app.state.settings.colour = e.target.value;
    app.save();
  };
  $('#difficulty').onchange = e => {
    app.state.strength = e.target.value;
    app.save();
    const line = $('.focus-progress', root);
    if (line) line.textContent = progressText(app.state.strength);
  };
  $('#coach').onchange = e => {
    app.state.coach = e.target.checked;
    app.save();
  };
  $('#nemesis-on').onchange = e => {
    app.state.settings.nemesis = e.target.checked;
    app.save();
  };
  $('#candidates-on').onchange = e => {
    app.state.settings.candidates = e.target.checked;
    play.candidates = [];
    play.marking = false;
    app.save();
    draw();
  };
  $('#clock-on').onchange = e => {
    app.state.settings.clock = e.target.checked;
    app.save();
    // A free game not yet begun follows the setting at once; a game under way keeps its clock.
    if (!play.game.history().length && !play.from && !play.challenge) {
      stopClockTimer();
      play.clock = app.state.settings.clock ? makeClock(freeClock()) : null;
      persist();
      draw();
      beginUserTurn();
    }
  };
  $('#menu-new').onclick = () => {
    closeModal();
    startNewGame(app.state.settings.colour);
  };
  $('#export-game').onclick = () => download(`rankup-practice-${dateKey()}.pgn`, pgnWithHeaders(), 'application/x-chess-pgn');
  $('#review-game').onclick = () => app.navigate('review', { pgn: pgnWithHeaders(), colour: play.color });
}

function pgnWithHeaders() {
  const g = new Chess();
  g.loadPgn(play.game.pgn());
  const label = currentLevel().label;
  g.setHeader('Event', 'Rankup practice');
  g.setHeader('Date', dateKey().replace(/-/g, '.'));
  g.setHeader('White', play.color === 'w' ? 'You' : `Stockfish (${label})`);
  g.setHeader('Black', play.color === 'b' ? 'You' : `Stockfish (${label})`);
  if (play.clock) g.setHeader('TimeControl', `${play.clock.base}+${play.clock.inc}`);
  if (play.flagged) g.setHeader('Result', play.color === 'w' ? '0-1' : '1-0');
  else if (play.game.isGameOver()) g.setHeader('Result', play.game.isCheckmate() ? (play.game.turn() === 'w' ? '0-1' : '1-0') : '1/2-1/2');
  return g.pgn();
}

/** A fresh game; `clock` is a { base, inc } control, or null for no clock. */
function newGame({ fen = null, color = 'w', from = null, clock = null, nemesis = false }) {
  stopClockTimer();
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
  play.challenge = null;
  play.clock = clock ? makeClock({ base: clock.base, inc: clock.inc }) : null;
  play.blunders = 0;
  play.fast = 0;
  play.flagged = false;
  play.book = false;
  play.nemesis = nemesis;
  play.trap = null;
  play.traps = [];
  engine.newGame();
  persist();
}

/**
 * Once a full game ends (or your clock runs out), record the result and, when
 * the setting is on, move the opponent up or down the ladder for the next game.
 */
function recordResult() {
  const g = play.game;
  if (play.recorded || !play.level || !(g.isGameOver() || play.flagged) || (g.history().length < 6 && !play.flagged)) return;
  play.recorded = true;
  const result = play.flagged ? 0 : g.isCheckmate() ? (g.turn() === play.color ? 0 : 1) : 0.5;
  logGame(app.state, {
    level: play.level,
    result,
    clock: play.clock,
    left: play.clock ? timeLeft(play.clock) : null,
    flagged: play.flagged,
    blunders: play.blunders,
    fast: play.fast,
  });
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
      if (line) line.textContent = progressText(next.level);
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
    interactive: !play.marking && !play.thinking && !play.challenge?.done && !play.flagged && g.turn() === play.color && !g.isGameOver(),
    movable: play.color,
    lastMove: play.lastMove,
    marks: Object.fromEntries(play.candidates.map(sq => [sq, 'hint'])),
  });
  const chip = $('#board-chip');
  if (chip) chip.textContent = turnLabel(g);
  updateClockChip();
  const h = $('#history');
  if (h) {
    h.textContent = moveRecord();
    h.scrollTop = h.scrollHeight;
  }
  const challenge = $('#challenge-text');
  if (challenge && play.challenge && !play.challenge.done) challenge.innerHTML = challengeText();
  const judge = $('#judge');
  if (judge) judge.disabled = !(play.challenge?.moves >= 10) || play.thinking || g.isGameOver();
  const undo = $('#undo-game');
  if (undo) undo.disabled = !g.history().length || play.thinking || !!play.clock;
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
  if (!app.state.coach || play.game.isGameOver() || play.flagged || play.game.turn() !== play.color) return;
  const fen = play.game.fen();
  const promise = engine.analyse(fen, { nodes: BUDGET.coach });
  promise.catch(() => {});
  play.prepared = { fen, promise };
}

async function onMove(move) {
  const g = play.game;
  if (play.thinking || g.turn() !== play.color || g.isGameOver() || play.flagged) return;
  const token = play.token;
  const at = Date.now(); // your clock stops at the tap: no search time is ever charged
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
    const spent = play.clock ? endTurn(play.clock, at) : 0;
    play.lastMove = [m.from, m.to];
    play.candidates = [];
    // Nemesis's trap in the position just left: taken or declined, scored and said.
    if (play.trap) {
      const trap = play.trap;
      const taken = moveToUci(m) === trap.uci;
      play.traps.push({ san: trap.san, loss: trap.loss, taken });
      play.trap = null;
      logAttempt(app.state, { kind: 'n', theme: 'trap', clean: !taken });
      app.save();
      play.note = taken ? `Nemesis's trap: ${trapText(trap)}` : `You declined Nemesis's trap: ${trapText(trap)}`;
    }
    if (named.length && before?.best) {
      const bestSan = playUci(new Chess(fen), before.best).san;
      const hit = named.includes(before.best.slice(2, 4));
      logCandidates(app.state, hit);
      app.save();
      play.note = hit
        ? `The engine's best, ${bestSan}, was among your candidates.`
        : `The engine preferred ${bestSan}, which was not among your candidates.`;
    }
    if (play.challenge && !play.challenge.done) play.challenge.moves++;
    persist();
    refreshBoard();
    board.announce(`You played ${m.san}.`);
    if (g.isGameOver()) {
      if (play.challenge) settleChallenge({ result: resultFor(g) });
      return recordResult();
    }
    const level = currentLevel();
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
        play.blunders++;
        if (play.clock && spent < thresholds(play.clock).rushed) play.fast++;
        persist();
        play.note = 'Coach: a stronger move was available. Saved to My mistakes for later.';
      }
    }
    status((play.note ? play.note + ' ' : '') + `${opponentName()} is thinking…`);
    await engineMove(token, after, level);
    // The challenge is judged by the engine once you have made your moves.
    const ch = play.challenge;
    if (token === play.token && ch && !ch.done && !g.isGameOver() && ch.moves >= MAX_MOVES) {
      play.thinking = false;
      return judgeNow();
    }
  } catch (e) {
    if (token === play.token) status(e.message, 'error');
  } finally {
    if (token === play.token) {
      play.thinking = false;
      refreshBoard();
      status(
        (play.note ? play.note + ' ' : '') + gameStatus(),
        play.challenge?.done === 'success' ? 'success' : play.note ? 'warning' : '',
      );
      if (play.challenge?.done) draw();
      beginUserTurn();
      prepareCoach();
    }
  }
}

async function engineMove(token, after, level) {
  const g = play.game;
  const fen = g.fen();
  let uci = null;
  const book = play.book ? opponentMove(app.state.reviews, fen, play.color) : null;
  const booked = book && g.moves({ verbose: true }).find(m => m.san === book);
  if (booked) uci = moveToUci(booked);
  else if (play.nemesis) {
    try {
      const candidates = await humanMoves({ level: level.maia, game: g });
      const r = await nemesisMove(
        fen,
        candidates,
        (f, o) => engine.analyse(f, { multipv: o.multipv, nodes: o.nodes }),
        f => humanMoves({ level: level.maia, game: g, fen: f }),
      );
      uci = r.uci;
      if (token === play.token) play.trap = r.trap;
    } catch (e) {
      // The network could not load: fall back to Stockfish at the level, with no trap.
      toast(e.message + ' Using Stockfish for this move.');
      uci = (await engine.analyse(fen, { elo: Math.max(1320, level.elo), movetime: 500 })).best;
    }
  } else if (level.mode === 'full') {
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
  if (board) board.announce(`${opponentName()} played ${m.san}.`);
  if (g.isGameOver()) {
    if (play.challenge) settleChallenge({ result: resultFor(g) });
    recordResult();
  }
}

async function engineTurn() {
  const token = play.token;
  play.thinking = true;
  refreshBoard();
  status(`${opponentName()} is thinking…`);
  try {
    await engineMove(token, null, currentLevel());
  } catch (e) {
    if (token === play.token) status(e.message, 'error');
  } finally {
    if (token === play.token) {
      play.thinking = false;
      refreshBoard();
      status(gameStatus());
      beginUserTurn();
      prepareCoach();
    }
  }
}

/** Take back your last move; not on a clock, where a move played is a move made. */
function takeBack() {
  const g = play.game;
  if (play.thinking || !g.history().length || play.clock) return;
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
  play.trap = null;
  persist();
  refreshBoard();
  status(gameStatus());
  if (removed) toast(`Removed ${removed === 1 ? 'the mistake' : removed + ' mistakes'} saved for that move.`);
  if (g.turn() !== play.color) engineTurn();
  else prepareCoach();
}
