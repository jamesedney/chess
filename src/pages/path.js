// Learning path: short lessons, each with worked examples on a real board.
import { Chess } from '../../vendor/chess.js';
import { lessons } from '../../data/lessons.js';
import { app } from '../app-context.js';
import { BoardView } from '../board.js';
import { $, esc, pageHead, showModal, closeModal, choosePromotion } from '../ui.js';
import { moveToUci, playUci } from '../chess-utils.js';
import { PERSONAL } from '../themes.js';

export function render(main) {
  const read = app.state.read;
  main.innerHTML =
    pageHead('YOUR LEARNING PATH', 'Build the habits behind 1500.', 'Short lessons. Real positions to solve. No memorisation marathon.') +
    `<div class="lesson-grid">${lessons
      .map(
        (l, i) => `<article class="lesson">
          <div class="lesson-number">${String(i + 1).padStart(2, '0')}</div>
          <div class="eyebrow">${esc(l.range)}</div>
          <h2>${esc(l.title)}</h2>
          <p>${esc(l.intro)}</p>
          <div class="lesson-footer"><span class="small">${read.includes(i) ? '✓ Completed' : l.examples.length ? `3-minute lesson · ${l.examples.length} positions` : '3-minute lesson'}</span><button type="button" data-lesson="${i}">Open lesson</button></div>
        </article>`,
      )
      .join('')}</div>`;
  main.querySelectorAll('[data-lesson]').forEach(b => (b.onclick = () => openLesson(Number(b.dataset.lesson))));
}

function markRead(i) {
  if (!app.state.read.includes(i)) {
    app.state.read.push(i);
    app.save();
  }
}

function openLesson(i) {
  const l = lessons[i];
  const content = showModal(
    `<div class="eyebrow">LESSON ${i + 1} · ${esc(l.range)}</div><h2>${esc(l.title)}</h2>
    ${l.text.map((t, j) => `<div class="step"><span class="step-number">${j + 1}</span><p>${esc(t)}</p></div>`).join('')}
    <div class="callout">${esc(l.rule)}</div>
    ${l.examples.length ? '<div id="lesson-example" class="lesson-example"></div>' : ''}
    <div class="actions"><button type="button" id="lesson-practise" class="primary">${l.theme === PERSONAL ? 'Review a game' : 'Practise this skill'}</button></div>`,
    { onClose: () => app.page === 'path' && render($('#main')) },
  );
  content.closest('dialog').classList.add('wide-dialog');
  if (!l.examples.length) markRead(i);
  else showExample(i, 0);
  $('#lesson-practise').onclick = () => {
    markRead(i);
    closeModal();
    if (l.theme === PERSONAL) app.navigate('review');
    else app.navigate('train', { mode: 'daily', theme: l.theme });
  };
}

function mateMove(game) {
  for (const m of game.moves({ verbose: true })) {
    const g = new Chess(game.fen());
    g.move(m);
    if (g.isCheckmate()) return moveToUci(m);
  }
  return null;
}

function showExample(i, k) {
  const l = lessons[i];
  const ex = l.examples[k];
  const host = $('#lesson-example');
  if (!host) return;
  const game = new Chess(ex.fen);
  const solver = game.turn();
  const state = { ply: 0, done: false };
  host.innerHTML = `<div class="eyebrow">TRY IT · POSITION ${k + 1} OF ${l.examples.length}</div>
    <p><strong>${esc(ex.prompt)}</strong> <span class="muted">${solver === 'w' ? 'White' : 'Black'} to move.</span></p>
    <div class="mini-board" id="lesson-board"></div>
    <div id="lesson-feedback" class="status" role="status" aria-live="polite">Tap a piece, then its destination.</div>
    <div class="actions"><button type="button" id="lesson-answer">Show answer</button><button type="button" id="lesson-next" hidden>${k + 1 < l.examples.length ? 'Next position' : 'Start again'}</button></div>`;
  const say = (text, tone = '') => {
    const el = $('#lesson-feedback');
    el.textContent = text;
    el.className = 'status ' + tone;
  };
  const board = new BoardView($('#lesson-board'), {
    askPromotion: choosePromotion,
    label: 'Lesson board',
    onMove: async move => {
      if (state.done) return;
      const m = game.move(move);
      const u = moveToUci(m);
      let correct = false;
      if (ex.kind === 'answers') correct = ex.answers.includes(u);
      else if (ex.kind === 'mate') correct = game.isCheckmate();
      else correct = u === ex.line[state.ply];
      if (!correct) {
        const stalemate = game.isStalemate();
        game.undo();
        board.set({ game, lastMove: [] });
        board.flash(m.to);
        say(
          stalemate
            ? `${m.san} is stalemate: Black has no legal move and is not in check. That throws away the win.`
            : 'Not quite. Look again, then try another move.',
          'error',
        );
        return;
      }
      board.set({ game, lastMove: [m.from, m.to] });
      if (ex.kind === 'line' && state.ply + 1 < ex.line.length) {
        state.ply++;
        board.set({ interactive: false });
        say('Good. Now the reply…', 'success');
        await new Promise(r => setTimeout(r, 500));
        const reply = playUci(game, ex.line[state.ply]);
        state.ply++;
        board.set({ game, lastMove: [reply.from, reply.to], interactive: true });
        say(`${reply.san}. Your move again.`);
        return;
      }
      complete();
    },
  });
  const complete = (shown = false) => {
    state.done = true;
    board.set({ interactive: false });
    say((shown ? '' : 'Correct. ') + ex.explain, 'success');
    $('#lesson-answer').hidden = true;
    $('#lesson-next').hidden = false;
    if (k + 1 >= l.examples.length) markRead(i);
  };
  board.set({ game, orientation: solver, interactive: true, movable: solver });
  $('#lesson-answer').onclick = async () => {
    if (state.done) return;
    board.set({ interactive: false });
    const moves = ex.kind === 'answers' ? [ex.answers[0]] : ex.kind === 'mate' ? [mateMove(game)] : ex.line.slice(state.ply);
    for (const u of moves) {
      const m = playUci(game, u);
      board.set({ game, lastMove: [m.from, m.to] });
      await new Promise(r => setTimeout(r, 550));
    }
    complete(true);
  };
  $('#lesson-next').onclick = () => showExample(i, (k + 1) % l.examples.length);
}
