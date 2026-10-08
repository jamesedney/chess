// Learning path: interactive lessons played step by step on the board.
import { Chess } from '../../vendor/chess.js';
import { lessons, SECTIONS } from '../../data/lessons.js';
import { app } from '../app-context.js';
import { BoardView, turnLabel } from '../board.js';
import { $, esc, pageHead, choosePromotion, plural, settle, showModal, closeModal } from '../ui.js';
import { moveToUci, playUci } from '../chess-utils.js';
import { PERSONAL } from '../themes.js';
import { cue } from '../sound.js';
import { personalLessons, PERSONAL_SECTION } from '../personal-lessons.js';
import { engine, BUDGET } from '../engine.js';
import { judgeAlternative } from '../verify.js';
import { BANDS, UNITS, unitsIn, unitStatus, currentBand } from '../curriculum.js';
import { SKILLS } from '../../data/curriculum.js';
import { endgameTitle } from '../endgames.js';

/** Built-in lessons plus the ones made from the user's own mistakes. */
function allLessons() {
  return [...personalLessons(app.state), ...lessons];
}

const wait = ms => new Promise(r => setTimeout(r, ms));

let root = null;
let active = null; // { lesson, index, step state }
let board = null;

function progressOf(lesson) {
  const p = app.state.lessons[lesson.id];
  return { step: Math.min(p?.step || 0, lesson.steps.length), done: !!p?.done };
}

function saveProgress(lesson, step, done = false) {
  const prev = app.state.lessons[lesson.id] || { step: 0, done: false };
  app.state.lessons[lesson.id] = { step: Math.max(prev.step, step), done: prev.done || done };
  if (done && !lesson.personal) {
    const index = lessons.indexOf(lesson);
    if (!app.state.read.includes(index)) app.state.read.push(index);
  }
  app.save();
}

export function render(main, params = {}) {
  root = main;
  if (params.lesson) {
    const lesson = allLessons().find(l => l.id === params.lesson);
    if (lesson) return openLesson(lesson);
  }
  active = null;
  drawList();
}

export function leave() {
  active = null;
}

// ---------- The path ----------

/** The curriculum map: every band and unit, where you are, and the lessons inside. */
function drawList() {
  const s = app.state;
  const band = currentBand(s);
  const current = s.curriculum.current;
  const inUnits = new Set(UNITS.map(u => u.lesson).filter(Boolean));
  const extras = lessons.filter(l => !inUnits.has(l.id));
  const personal = personalLessons(s);
  const bandIndex = BANDS.indexOf(band);
  root.innerHTML =
    pageHead('', 'Your path') +
    `${personal.length ? `<section class="path-section"><h2 class="path-heading">Made from your games</h2><div class="lesson-grid">${personal.map(l => lessonCard(l, false)).join('')}</div></section>` : ''}
    ${BANDS.map((b, i) => {
      const units = unitsIn(b.id);
      const done = units.filter(u => unitStatus(s, u).done).length;
      const state = i < bandIndex ? 'past' : i === bandIndex ? 'now' : 'later';
      return `<details class="band band-${state}" ${state === 'now' ? 'open' : ''}>
        <summary><span class="band-name">${esc(b.label)}</span><span class="small">${b.floor ? b.floor + '–' : 'up to '}${b.ceiling} · ${done} of ${units.length}</span></summary>
        <ol class="units">${units
          .map(u => {
            const st = unitStatus(s, u);
            const cls = st.done ? 'done' : u.id === current ? 'current' : '';
            const pct = Math.round(st.progress * 100);
            return `<li class="unit ${cls}"><button type="button" data-unit="${u.id}">
              <span class="unit-ring" style="--pct:${pct}" aria-hidden="true">${st.done ? '✓' : ''}</span>
              <span class="unit-text"><strong>${esc(u.title)}</strong><span class="small">${esc(SKILLS[u.skill].short)}${st.placed ? ' · placed' : st.done ? ' · mastered' : u.id === current ? ' · now' : pct ? ` · ${pct}%` : ''}</span></span>
            </button></li>`;
          })
          .join('')}</ol>
      </details>`;
    }).join('')}
    ${extras.length ? `<section class="path-section"><h2 class="path-heading">More lessons</h2><div class="lesson-grid">${extras.map(l => lessonCard(l, false)).join('')}</div></section>` : ''}`;
  root.querySelectorAll('[data-lesson]').forEach(b => (b.onclick = () => app.navigate('path', { lesson: b.dataset.lesson })));
  root.querySelectorAll('[data-unit]').forEach(b => (b.onclick = () => openUnit(UNITS.find(u => u.id === b.dataset.unit))));
}

/** A unit's detail: what it teaches, how far you are, and a way into each part. */
function openUnit(unit) {
  const s = app.state;
  const st = unitStatus(s, unit);
  const lesson = unit.lesson && lessons.find(l => l.id === unit.lesson);
  const drill = unit.drill;
  const drillText = !drill
    ? ''
    : drill.type === 'endgame'
      ? `Win the “${endgameTitle(drill.id)}” endgame drill`
      : drill.type === 'vision'
        ? `Score ${drill.score} in a vision sprint`
        : drill.type === 'visual'
          ? `Score ${drill.score} in visualisation`
          : drill.type === 'checks'
            ? `Score ${drill.score} in find every check`
            : `Complete ${plural(drill.runs, 'assessment run')}`;
  showModal(`<h2>${esc(unit.title)}</h2>
    <p>${esc(unit.concept)}</p>
    <ul class="gate">
      <li class="${st.puzzlesOk ? 'ok' : ''}">Solve ${unit.gate.puzzles} puzzles cleanly (${Math.min(st.clean, unit.gate.puzzles)} so far) at ${Math.round(unit.gate.accuracy * 100)}% accuracy${st.recent.length ? ` (now ${Math.round(st.accuracy * 100)}%)` : ''}</li>
      ${lesson ? `<li class="${st.lessonDone ? 'ok' : ''}">Finish the lesson “${esc(lesson.title)}”</li>` : ''}
      ${drill ? `<li class="${st.drillOk ? 'ok' : ''}">${esc(drillText)}</li>` : ''}
    </ul>
    ${st.done ? `<p class="status success">${st.placed ? 'Placed: your rating says you know this. It comes back if your games say otherwise.' : 'Mastered.'}</p>` : ''}
    <div class="actions">
      <button type="button" class="primary" id="unit-practise">Practise now</button>
      ${lesson ? `<button type="button" id="unit-lesson">${st.lessonDone ? 'Replay lesson' : 'Lesson'}</button>` : ''}
      ${drill ? '<button type="button" id="unit-drill">Drill</button>' : ''}
      ${!st.done && unit.id !== s.curriculum.current ? '<button type="button" id="unit-focus">Make this today’s unit</button>' : ''}
    </div>`);
  $('#unit-practise').onclick = () => {
    closeModal();
    app.navigate('train', { mode: 'daily', tags: unit.tags, strict: 1, unit: unit.id, rating: s.skills[unit.skill]?.rating, limit: 8 });
  };
  $('#unit-lesson')?.addEventListener('click', () => {
    closeModal();
    app.navigate('path', { lesson: unit.lesson });
  });
  $('#unit-drill')?.addEventListener('click', () => {
    closeModal();
    if (drill.type === 'vision') app.navigate('train', { mode: 'vision' });
    else
      app.navigate(
        'drills',
        drill.type === 'endgame' ? { drill: 'endgames', id: drill.id } : { drill: drill.type === 'visual' ? 'visualise' : drill.type },
      );
  });
  $('#unit-focus')?.addEventListener('click', () => {
    s.curriculum.current = unit.id;
    s.session = null; // re-plan today around it
    app.save();
    closeModal();
    drawList();
  });
}

function lessonCard(l, isNext) {
  const { step, done } = progressOf(l);
  const total = l.steps.length;
  const interactive = l.steps.filter(s => s.kind !== 'read' && s.kind !== 'cta').length;
  const pct = done ? 100 : Math.round((step / total) * 100);
  const status = done ? 'Completed' : step ? `${step} of ${total} steps` : `${plural(interactive, 'exercise')}`;
  const action = done ? 'Replay' : step ? 'Continue' : 'Start';
  return `<article class="lesson ${done ? 'done' : ''} ${isNext ? 'next-up' : ''}">
    <div class="lesson-ring" role="img" aria-label="${pct}% complete" style="--pct:${pct}"><span>${done ? '✓' : pct ? pct + '%' : ''}</span></div>
    <div class="lesson-body">
      <h3>${esc(l.title)}</h3>
      <p>${esc(l.intro)}</p>
      <div class="lesson-footer"><span class="small">${esc(status)}${isNext ? ' · next up' : ''}</span><button type="button" class="${isNext ? 'primary' : ''}" data-lesson="${l.id}">${action}</button></div>
    </div>
  </article>`;
}

// ---------- The player ----------

function openLesson(lesson) {
  const { step, done } = progressOf(lesson);
  const start = done || step >= lesson.steps.length ? 0 : step;
  active = { lesson, index: start, solved: false, tries: 0, ply: 0, busy: false, picked: null, message: '', tone: '' };
  drawStep();
}

function stepOf() {
  return active.lesson.steps[active.index];
}

function goTo(index) {
  const { lesson } = active;
  if (index >= lesson.steps.length) {
    saveProgress(lesson, lesson.steps.length, true);
    return drawComplete();
  }
  active = { ...active, index, solved: false, tries: 0, ply: 0, busy: false, picked: null, message: '', tone: '' };
  saveProgress(lesson, index);
  drawStep();
}

function drawStep() {
  if (!root || app.page !== 'path' || !active) return;
  const { lesson, index } = active;
  const step = stepOf();
  const total = lesson.steps.length;
  const isLast = index === total - 1;
  const needsBoard = !!step.fen;
  const sideToMove = needsBoard ? new Chess(step.fen).turn() : null;

  root.innerHTML = `<div class="focus lesson-player">
    <div class="focus-top">
      <button type="button" id="lesson-exit" class="secondary focus-menu" style="margin-left:0" aria-label="Back to the learning path">‹ Lessons</button>
      <span class="focus-progress">${esc(lesson.title)} · ${index + 1} of ${total}</span>
    </div>
    <ol class="step-dots" aria-label="Steps">${lesson.steps.map((s, i) => `<li class="${i < index ? 'past' : i === index ? 'now' : ''} ${s.kind === 'read' || s.kind === 'cta' ? 'read' : ''}" aria-current="${i === index ? 'step' : 'false'}"></li>`).join('')}</ol>
    ${needsBoard ? `<div class="focus-prompt"><strong id="board-title">${kindLabel(step)}</strong><span class="chip" id="board-chip">${sideToMove === 'w' ? 'White' : 'Black'} to move</span></div><div class="focus-board"><div id="board"></div></div>` : ''}
    <div class="lesson-text ${needsBoard ? '' : 'lesson-text-only'}">
      ${!needsBoard ? `<div class="eyebrow">${kindLabel(step)}</div>` : ''}
      <p id="lesson-prompt">${esc(step.text)}</p>
      ${step.kind === 'choice' ? `<div class="choices" role="group" aria-label="Answers">${step.options.map((o, i) => `<button type="button" class="choice" data-choice="${i}">${esc(o.label)}</button>`).join('')}</div>` : ''}
      <div id="lesson-feedback" class="status ${active.tone}" role="status" aria-live="polite" ${active.message ? '' : 'hidden'}>${esc(active.message)}</div>
    </div>
    <div class="focus-actions">
      <button type="button" id="lesson-back" class="secondary" ${index === 0 ? 'disabled' : ''}>Back</button>
      ${step.kind === 'cta' ? `<button type="button" id="lesson-cta" class="primary">${esc(step.label)}</button>` : ''}
      ${['move', 'line', 'tap', 'choice'].includes(step.kind) && !active.solved ? '<button type="button" id="lesson-answer">Show answer</button>' : ''}
      <button type="button" id="lesson-next" class="primary" ${['move', 'line', 'tap', 'choice'].includes(step.kind) && !active.solved ? 'hidden' : ''}>${isLast ? 'Finish lesson' : 'Next'}</button>
    </div>
  </div>`;

  $('#lesson-exit').onclick = () => app.navigate('path', { list: true });
  $('#lesson-back').onclick = () => goTo(index - 1);
  $('#lesson-next').onclick = () => goTo(index + 1);
  $('#lesson-cta')?.addEventListener('click', () => app.navigate(step.page, step.params || {}));
  $('#lesson-answer')?.addEventListener('click', showAnswer);
  root.querySelectorAll('[data-choice]').forEach(b => (b.onclick = () => choose(Number(b.dataset.choice))));
  if (active.picked !== null) markChoices();

  if (needsBoard) setupBoard(step);
  if (step.kind === 'read' || step.kind === 'cta') saveProgress(lesson, index + 1);
}

function kindLabel(step) {
  return { read: 'Read', tap: 'Tap the square', move: 'Your move', line: 'Play the line', choice: 'Decide', cta: 'Next step' }[step.kind];
}

function setupBoard(step) {
  const game = new Chess(step.fen);
  const solver = game.turn();
  const marks = {};
  for (const sq of step.highlight || []) marks[sq] = 'hint';
  const arrows = (step.arrows || []).map(a => ({ ...a, kind: 'best' }));
  board = new BoardView($('#board'), {
    label: 'Lesson board',
    askPromotion: choosePromotion,
    onMove: handleMove,
    onSquare: step.kind === 'tap' && !active.solved ? handleTap : null,
  });
  const interactive = (step.kind === 'move' || step.kind === 'line') && !active.solved;
  // A line in progress replays the moves made so far.
  if (step.kind === 'line') for (const u of step.line.slice(0, active.ply)) playUci(game, u);
  board.set({ game, orientation: solver, interactive, movable: solver, marks, arrows });
  if (step.kind === 'tap' && active.solved) board.set({ marks: Object.fromEntries(step.targets.map(t => [t, 'good'])) });
  const chip = $('#board-chip');
  if (chip) chip.textContent = turnLabel(game);
}

function say(message, tone = '') {
  active.message = message;
  active.tone = tone;
  const el = $('#lesson-feedback');
  if (!el) return;
  el.textContent = message;
  el.className = 'status ' + tone;
  el.hidden = !message;
  settle(el);
}

function solved(explain) {
  active.solved = true;
  if (!active.tries) cue('success');
  say(explain, 'success');
  board?.set({ interactive: false });
  if (board) board.onSquare = null;
  $('#lesson-answer')?.remove();
  const next = $('#lesson-next');
  if (next) {
    next.hidden = false;
    next.focus({ preventScroll: true });
  }
  saveProgress(active.lesson, active.index + 1);
  if (stepOf().kind === 'choice') markChoices();
}

function handleTap(sq) {
  const step = stepOf();
  if (step.kind !== 'tap' || active.solved) return;
  if (step.targets.includes(sq)) {
    board.set({ marks: { [sq]: 'good' } });
    return solved('Yes. ' + step.explain);
  }
  active.tries++;
  board.set({ marks: { [sq]: 'answer' } });
  say(
    active.tries >= 2 ? 'Not that one. Look at which pieces could recapture there, or use Show answer.' : 'Not that square. Try again.',
    'error',
  );
}

async function handleMove(move) {
  const step = stepOf();
  if (active.solved || active.busy) return;
  const game = board.game;
  let m;
  try {
    m = game.move(move);
  } catch {
    return;
  }
  const uci = moveToUci(m);
  let correct;
  if (step.kind === 'move') correct = step.mate ? game.isCheckmate() : step.answers.includes(uci);
  else correct = uci === step.line[active.ply];
  // Positions from your own games accept any move Stockfish rates as just as good.
  if (!correct && step.engine && engine.available) {
    active.busy = true;
    board.set({ game, lastMove: [m.from, m.to], interactive: false });
    say('Checking your move with Stockfish…');
    try {
      const before = await engine.analyse(m.before, { nodes: BUDGET.verify });
      const after = game.isGameOver() ? null : await engine.analyse(m.after, { nodes: BUDGET.verify });
      correct = game.isCheckmate() || judgeAlternative({ before, after, minWin: 0 }).accepted;
    } catch {}
    if (!active || stepOf() !== step || board.game !== game) return;
    active.busy = false;
    board.set({ interactive: !correct });
    if (correct) return solved(`${m.san} works too. ${step.explain}`);
  }
  if (!correct) {
    const stalemate = game.isStalemate();
    game.undo();
    active.tries++;
    board.set({ game, lastMove: [] });
    board.flash(m.to);
    cue('error');
    say(
      stalemate
        ? `${m.san} is stalemate: the other side has no legal move and is not in check. That throws away the win.`
        : active.tries >= 2
          ? 'Not that. Think about what the move needs to achieve, or use Show answer.'
          : 'Not quite. Try another move.',
      'error',
    );
    return;
  }
  board.set({ game, lastMove: [m.from, m.to] });
  if (step.kind === 'line' && active.ply + 1 < step.line.length) {
    active.ply++;
    active.busy = true;
    board.set({ interactive: false });
    say(`${m.san}. Now the reply…`, 'success');
    await wait(550);
    if (!active || stepOf() !== step) return;
    const reply = playUci(game, step.line[active.ply]);
    active.ply++;
    active.busy = false;
    board.set({ game, lastMove: [reply.from, reply.to], interactive: true });
    const chip = $('#board-chip');
    if (chip) chip.textContent = turnLabel(game);
    say(`${reply.san}. Your move again.`);
    return;
  }
  solved(`${m.san}. ${step.explain}`);
}

function choose(i) {
  const step = stepOf();
  if (active.solved) return;
  active.picked = i;
  markChoices();
  const option = step.options[i];
  if (option.correct) return solved(option.why);
  active.tries++;
  say(option.why + ' Try another answer.', 'error');
}

function markChoices() {
  const step = stepOf();
  root.querySelectorAll('[data-choice]').forEach(b => {
    const i = Number(b.dataset.choice);
    b.classList.toggle('picked', i === active.picked);
    b.classList.toggle('right', active.solved && step.options[i].correct);
    b.classList.toggle('wrong', i === active.picked && !step.options[i].correct);
    if (active.solved) b.disabled = true;
  });
}

async function showAnswer() {
  const step = stepOf();
  if (active.solved) return;
  if (step.kind === 'choice') {
    active.picked = step.options.findIndex(o => o.correct);
    markChoices();
    return solved(step.options[active.picked].why);
  }
  if (step.kind === 'tap') {
    board.set({ marks: Object.fromEntries(step.targets.map(t => [t, 'good'])) });
    return solved(step.explain);
  }
  const game = board.game;
  board.set({ interactive: false });
  active.busy = true;
  let moves;
  if (step.kind === 'move') moves = [step.mate ? mateMove(game) : step.answers[0]];
  else moves = step.line.slice(active.ply);
  for (const u of moves) {
    const m = playUci(game, u);
    board.set({ game, lastMove: [m.from, m.to] });
    await wait(550);
    if (!active || stepOf() !== step) return;
  }
  active.busy = false;
  solved(step.explain);
}

function mateMove(game) {
  for (const m of game.moves({ verbose: true })) {
    const g = new Chess(game.fen());
    g.move(m);
    if (g.isCheckmate()) return moveToUci(m);
  }
  return null;
}

function drawComplete() {
  const { lesson } = active;
  const next = lessons.find(l => !progressOf(l).done && l !== lesson);
  root.innerHTML = `<div class="focus">
    <div class="focus-top"><button type="button" id="lesson-exit" class="secondary focus-menu" style="margin-left:0">‹ Lessons</button></div>
    <div class="panel dark-panel">
      <div class="eyebrow">Lesson complete</div>
      <h2>${esc(lesson.title)}</h2>
      <div class="callout">${esc(lesson.rule)}</div>
      <p>Carry the rule into the next thing you play.</p>
      <div class="actions">
        ${lesson.personal ? '<button type="button" id="lesson-practise" class="lime">Practise my mistakes</button>' : lesson.theme === PERSONAL ? '<button type="button" id="lesson-practise" class="lime">Review a game</button>' : `<button type="button" id="lesson-practise" class="lime">Practise ${esc(lesson.theme.toLowerCase())} puzzles</button>`}
        ${next ? `<button type="button" id="lesson-following">Next lesson: ${esc(next.title)}</button>` : ''}
      </div>
    </div>
  </div>`;
  $('#lesson-exit').onclick = () => app.navigate('path', { list: true });
  $('#lesson-practise').onclick = () =>
    lesson.personal
      ? app.navigate('train', { mode: 'mistakes' })
      : lesson.theme === PERSONAL
        ? app.navigate('review')
        : app.navigate('train', { mode: 'daily', theme: lesson.theme });
  $('#lesson-following')?.addEventListener('click', () => app.navigate('path', { lesson: next.id }));
}
