// Review a game: import (paste, file, Lichess, Chess.com), analyse, view, and
// manage the personal mistake bank that the analysis fills.
import { Chess } from '../../vendor/chess.js';
import { app } from '../app-context.js';
import { engine, BUDGET } from '../engine.js';
import { BoardView } from '../board.js';
import { $, esc, pageHead, confirmDialog, toast, plural, formatDate } from '../ui.js';
import { splitPgn, loadGame, describeGame, detectColour, readHeaders } from '../pgn.js';
import { moveToUci, playUci, opposite } from '../chess-utils.js';
import { whitePov, winPercentLoss, classifyLoss, isTrainableMistake, formatScore } from '../evaluation.js';
import { createMistake, archiveMistake, deleteMistake } from '../mistakes.js';
import { evalGraph, hydrateEvalGraph } from '../charts.js';
import { MAX_REVIEWS } from '../state.js';

export const MAX_PLIES = 200;
export const MATE_EVAL = 10000;
const SYMBOL = { inaccuracy: '?!', mistake: '?', blunder: '??' };

let root = null;
let tab = 'paste';
let draft = { text: '', colour: 'w' };
let picker = null; // { source, games: [pgn] }
let selected = null; // pgn chosen from the picker
let analysis = { running: false, token: 0, status: '' };
let viewer = null; // { id, ply }
let showArchived = false;
let keyHandler = null;

export function render(main, params = {}) {
  root = main;
  if (params.pgn) {
    tab = 'paste';
    draft = { text: params.pgn, colour: params.colour || draft.colour };
    picker = null;
    selected = null;
    viewer = null;
  }
  if (params.review) viewer = { id: params.review, ply: params.ply ?? 0 };
  if (params.list) viewer = null;
  draw();
}

export function leave() {
  if (keyHandler) document.removeEventListener('keydown', keyHandler);
  keyHandler = null;
}

function draw() {
  if (!root || app.page !== 'review') return;
  leave();
  const review = viewer && app.state.reviews.find(r => r.id === viewer.id);
  if (review) return drawViewer(review);
  viewer = null;
  drawImport();
}

// ---------- Import and analysis ----------

function usernames() {
  return [app.state.profiles.lichess, app.state.profiles.chesscom].filter(Boolean);
}

function drawImport() {
  const p = app.state.profiles;
  root.innerHTML =
    pageHead('YOUR GAMES, YOUR CURRICULUM', 'Turn a loss into a lesson.', 'Bring a game. Find the turning points. Train the better move.') +
    `<div class="two-col">
      <section class="panel">
        <h2>Bring a game</h2>
        <div class="tabs" role="tablist" aria-label="Game source">
          ${[
            ['paste', 'Paste or file'],
            ['lichess', 'Lichess'],
            ['chesscom', 'Chess.com'],
          ]
            .map(
              ([id, label]) =>
                `<button type="button" role="tab" id="tab-${id}" aria-selected="${tab === id}" class="${tab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`,
            )
            .join('')}
        </div>
        <div role="tabpanel" aria-labelledby="tab-${tab}">
        ${
          tab === 'paste'
            ? `<div class="field"><label for="pgn">Game PGN</label><textarea id="pgn" placeholder="1. e4 e5 2. Nf3 Nc6 …" spellcheck="false">${esc(draft.text)}</textarea></div>
             <div class="field"><label for="pgn-file">Or choose a PGN file</label><input type="file" id="pgn-file" accept=".pgn,.txt,application/x-chess-pgn"></div>`
            : `<form id="fetch-form" class="field"><label for="username">${tab === 'lichess' ? 'Lichess' : 'Chess.com'} username</label>
               <div class="inline-field"><input id="username" autocomplete="username" spellcheck="false" maxlength="40" value="${esc(tab === 'lichess' ? p.lichess : p.chesscom)}" placeholder="Your username"><button type="submit" class="primary">Fetch recent games</button></div>
               <small>Fetches your last 20 public games directly from ${tab === 'lichess' ? 'lichess.org' : 'chess.com'}. Needs a connection; analysis then runs on this device.</small></form>`
        }
        </div>
        <div id="game-picker">${pickerHTML()}</div>
        <div class="field"><label for="review-colour">Which side did you play?</label><select id="review-colour"><option value="w">White</option><option value="b">Black</option></select></div>
        <div class="actions">
          <button type="button" id="analyse" class="primary" ${analysis.running ? 'disabled' : ''}>${selected ? 'Analyse selected game' : 'Find my missed opportunities'}</button>
          <button type="button" id="cancel-review" ${analysis.running ? '' : 'hidden'}>Stop analysis</button>
        </div>
        <div id="review-status" class="status" role="status" aria-live="polite">${esc(analysis.status || `One game at a time · up to ${MAX_PLIES} half-moves · about 1–2 minutes on a phone`)}</div>
        <small>Stockfish flags moves that cost at least 20% winning chances. These are practice candidates, not definitive verdicts.</small>
      </section>
      <section class="panel">
        <div class="eyebrow">REVIEWED GAMES</div>
        <h2>Step through your games</h2>
        ${reviewsHTML()}
      </section>
    </div>
    <section class="panel">
      <div class="eyebrow">PERSONAL MISTAKE BANK</div>
      <div class="panel-head"><h2>Lessons you actually need</h2><label class="small toggle"><input type="checkbox" id="show-archived" ${showArchived ? 'checked' : ''}> Show removed</label></div>
      <div id="mistake-list">${mistakesHTML()}</div>
    </section>`;

  root.querySelectorAll('[data-tab]').forEach(
    b =>
      (b.onclick = () => {
        saveDraft();
        tab = b.dataset.tab;
        picker = null;
        selected = null;
        draw();
      }),
  );
  $('#review-colour', root).value = draft.colour;
  $('#review-colour', root).onchange = e => (draft.colour = e.target.value);
  $('#pgn', root)?.addEventListener('input', e => {
    draft.text = e.target.value;
    selected = null;
    picker = null;
    $('#game-picker').innerHTML = '';
  });
  $('#pgn-file', root)?.addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 5e6) return toast('Choose a PGN file under 5 MB.');
    draft.text = await f.text();
    $('#pgn').value = draft.text;
    offerGames(splitPgn(draft.text), 'file');
  });
  $('#fetch-form', root)?.addEventListener('submit', e => {
    e.preventDefault();
    fetchGames(tab, $('#username').value.trim());
  });
  $('#analyse', root).onclick = startAnalysis;
  $('#cancel-review', root).onclick = () => {
    analysis.token++;
    engine.stop();
  };
  $('#show-archived', root).onchange = e => {
    showArchived = e.target.checked;
    $('#mistake-list').innerHTML = mistakesHTML();
    wireMistakes();
  };
  wirePicker();
  wireReviews();
  wireMistakes();
}

function saveDraft() {
  const t = $('#pgn');
  if (t) draft.text = t.value;
}

function pickerHTML() {
  if (!picker || !picker.games.length) return '';
  const names = usernames();
  return `<div class="picker" role="list" aria-label="Games found">
    <p class="small">${plural(picker.games.length, 'game')} found. Choose one to analyse.</p>
    ${picker.games
      .map((pgn, i) => {
        const d = describeGame(pgn);
        const side = detectColour(pgn, names);
        return `<div class="picker-item ${selected === pgn ? 'chosen' : ''}" role="listitem"><div><strong>${esc(d.players)}</strong><p>${esc([d.result, formatDate(d.date), d.event].filter(Boolean).join(' · '))}${side ? ` · you played ${side === 'w' ? 'White' : 'Black'}` : ''}</p></div><button type="button" data-pick="${i}">${selected === pgn ? 'Selected' : 'Choose'}</button></div>`;
      })
      .join('')}
  </div>`;
}

function wirePicker() {
  root.querySelectorAll('[data-pick]').forEach(
    b =>
      (b.onclick = () => {
        selected = picker.games[Number(b.dataset.pick)];
        const side = detectColour(selected, usernames());
        if (side) draft.colour = side;
        draw();
        $('#analyse')?.focus();
      }),
  );
}

function offerGames(games, source) {
  picker = { source, games };
  selected = games.length === 1 ? games[0] : null;
  if (selected) {
    const side = detectColour(selected, usernames());
    if (side) draft.colour = side;
  }
  draw();
}

async function fetchGames(source, username) {
  if (!/^[A-Za-z0-9_-]{2,40}$/.test(username)) return setStatus('Enter a valid username: letters, numbers, - and _ only.');
  setStatus(`Fetching recent games for ${username}…`);
  try {
    const games = source === 'lichess' ? await fetchLichess(username) : await fetchChessCom(username);
    if (!games.length) return setStatus('No standard chess games found for that account.');
    app.state.profiles[source] = username;
    app.save();
    analysis.status = '';
    offerGames(games, source);
  } catch (e) {
    setStatus(e.message || 'Could not fetch games. Check your connection and try again.');
  }
}

export async function fetchLichess(username, fetchImpl = fetch) {
  const url = `https://lichess.org/api/games/user/${encodeURIComponent(username)}?max=20&moves=true&tags=true&clocks=false&evals=false&opening=false`;
  let res;
  try {
    res = await fetchImpl(url, { headers: { Accept: 'application/x-chess-pgn' } });
  } catch {
    throw new Error('Could not reach lichess.org. Check your connection.');
  }
  if (res.status === 404) throw new Error(`No Lichess account called ${username}.`);
  if (res.status === 429) throw new Error('Lichess is rate-limiting requests. Wait a minute and try again.');
  if (!res.ok) throw new Error(`Lichess returned an error (${res.status}).`);
  return splitPgn(await res.text()).filter(pgn => {
    const v = readHeaders(pgn).Variant;
    return !v || v === 'Standard' || v === 'From Position';
  });
}

export async function fetchChessCom(username, fetchImpl = fetch) {
  const base = `https://api.chess.com/pub/player/${encodeURIComponent(username.toLowerCase())}/games/archives`;
  let res;
  try {
    res = await fetchImpl(base);
  } catch {
    throw new Error('Could not reach chess.com. Check your connection.');
  }
  if (res.status === 404) throw new Error(`No Chess.com account called ${username}.`);
  if (!res.ok) throw new Error(`Chess.com returned an error (${res.status}).`);
  const archives = ((await res.json()).archives || []).slice(-3).reverse();
  const games = [];
  for (const url of archives) {
    const r = await fetchImpl(url);
    if (!r.ok) continue;
    const month = ((await r.json()).games || []).filter(g => g.rules === 'chess' && g.pgn).reverse();
    games.push(...month.map(g => g.pgn));
    if (games.length >= 20) break;
  }
  return games.slice(0, 20);
}

function setStatus(text) {
  analysis.status = text;
  const el = $('#review-status');
  if (el && app.page === 'review') el.textContent = text;
}

function startAnalysis() {
  saveDraft();
  if (analysis.running) return;
  let pgn = selected;
  if (!pgn) {
    const games = splitPgn(draft.text);
    if (!games.length) return setStatus('Paste a PGN, choose a file, or fetch your games first.');
    if (games.length > 1) {
      offerGames(games, 'paste');
      return setStatus(`That text contains ${games.length} games. Choose one above.`);
    }
    pgn = games[0];
  }
  const colour = $('#review-colour')?.value || draft.colour;
  analyseGame(pgn, colour);
}

const clampEval = v => Math.max(-MATE_EVAL, Math.min(MATE_EVAL, Math.round(v)));

async function analyseGame(pgn, colour) {
  let game;
  try {
    game = loadGame(pgn);
  } catch (e) {
    return setStatus(e.message);
  }
  const moves = game.history({ verbose: true });
  const limit = Math.min(moves.length, MAX_PLIES);
  const key = colour + ':' + (moves[0]?.before || '') + ':' + moves.map(m => m.san).join(' ');
  const existing = app.state.reviews.find(r => r.key === key && r.complete);
  if (existing) {
    toast('You have already reviewed this game. Opening it.');
    return app.navigate('review', { review: existing.id, ply: 0 });
  }
  const d = describeGame(pgn);
  const review = {
    id: 'r' + Date.now().toString(36),
    key,
    created: Date.now(),
    white: d.white,
    black: d.black,
    result: d.result,
    date: d.date,
    event: d.event,
    colour,
    startFen: moves[0].before,
    moves: moves.slice(0, limit).map(m => m.san),
    evals: new Array(limit + 1).fill(null),
    marks: [],
    complete: false,
  };
  const token = ++analysis.token;
  analysis.running = true;
  let found = 0;
  const truncated = moves.length > MAX_PLIES ? ` Only the first ${MAX_PLIES} half-moves are analysed.` : '';
  draw();
  try {
    for (let i = 0; i < limit; i++) {
      if (token !== analysis.token) break;
      const m = moves[i];
      if (m.color !== colour) continue;
      setStatus(
        `Analysing move ${Math.floor(i / 2) + 1} of ${Math.ceil(limit / 2)} · ${plural(found, 'opportunity', 'opportunities')} found.${truncated}`,
      );
      const before = await engine.analyse(m.before, { nodes: BUDGET.review });
      if (token !== analysis.token) break;
      review.evals[i] = clampEval(whitePov(before.score, m.color));
      if (moveToUci(m) === before.best) {
        review.evals[i + 1] = review.evals[i];
        continue;
      }
      const afterGame = new Chess(m.after);
      let after;
      if (afterGame.isCheckmate()) {
        review.evals[i + 1] = m.color === 'w' ? MATE_EVAL : -MATE_EVAL;
        continue;
      } else if (afterGame.isDraw()) {
        after = { score: 0, mate: null, pv: [], best: null };
      } else {
        after = await engine.analyse(m.after, { nodes: BUDGET.review });
        if (token !== analysis.token) break;
      }
      review.evals[i + 1] = clampEval(whitePov(after.score, opposite(m.color)));
      const loss = winPercentLoss(before.score, after.score);
      const cls = classifyLoss(loss);
      if (cls === 'good') continue;
      const bestSan = playUci(new Chess(m.before), before.best).san;
      const mark = { ply: i, cls, loss: Math.round(loss), best: before.best, bestSan };
      if (isTrainableMistake(before.score, after.score)) {
        const mistake = createMistake({ fen: m.before, played: m.san, before, after, loss, source: { reviewId: review.id, ply: i } });
        if (mistake) {
          mark.mistakeId = mistake.id;
          mark.explanation = mistake.explanation;
          found++;
        }
      }
      review.marks.push(mark);
    }
    review.complete = token === analysis.token;
    app.state.reviews = [review, ...app.state.reviews.filter(r => r.key !== key)].slice(0, MAX_REVIEWS);
    app.save();
    analysis.status = `${review.complete ? 'Review complete' : 'Stopped'}. ${plural(found, 'practice position')} saved.${truncated}`;
    analysis.running = false;
    selected = null;
    picker = null;
    if (app.page === 'review') app.navigate('review', { review: review.id, ply: firstMarkPly(review) });
    else toast('Your game review is ready under Review a game.');
  } catch (e) {
    analysis.running = false;
    setStatus(e.message || 'Analysis failed. Try again.');
    draw();
  }
}

function firstMarkPly(review) {
  const m = review.marks.find(x => x.cls !== 'inaccuracy') || review.marks[0];
  return m ? m.ply : 0;
}

function reviewsHTML() {
  const list = app.state.reviews;
  if (!list.length)
    return `<p class="muted">No reviews yet. Your first review builds a training queue from the moves that mattered.</p>
      <div class="step"><span class="step-number">1</span><p>Fetch or paste a game and choose your colour.</p></div>
      <div class="step"><span class="step-number">2</span><p>Step through it with the evaluation graph. Mistakes are marked.</p></div>
      <div class="step"><span class="step-number">3</span><p>Solve the saved positions until the idea becomes familiar.</p></div>`;
  return list
    .map(r => {
      const counts = ['blunder', 'mistake', 'inaccuracy'].map(c => r.marks.filter(m => m.cls === c).length);
      return `<div class="review-item"><div><strong>${esc(r.white)} – ${esc(r.black)}</strong><p>${esc([r.result, formatDate(r.date), `you: ${r.colour === 'w' ? 'White' : 'Black'}`].filter(Boolean).join(' · '))}<br>${counts[0]} blunders · ${counts[1]} mistakes · ${counts[2]} inaccuracies${r.complete ? '' : ' · partial'}</p></div>
        <div class="item-actions"><button type="button" data-open="${r.id}">Open</button><button type="button" class="icon-button" data-delete-review="${r.id}" aria-label="Delete review of ${esc(r.white)} – ${esc(r.black)}">✕</button></div></div>`;
    })
    .join('');
}

function wireReviews() {
  root.querySelectorAll('[data-open]').forEach(
    b =>
      (b.onclick = () => {
        const r = app.state.reviews.find(x => x.id === b.dataset.open);
        app.navigate('review', { review: r.id, ply: firstMarkPly(r) });
      }),
  );
  root.querySelectorAll('[data-delete-review]').forEach(
    b =>
      (b.onclick = async () => {
        const ok = await confirmDialog({
          title: 'Delete this review?',
          body: 'Positions it saved stay in your mistake bank.',
          confirm: 'Delete',
          danger: true,
        });
        if (!ok) return;
        app.state.reviews = app.state.reviews.filter(r => r.id !== b.dataset.deleteReview);
        app.save();
        draw();
      }),
  );
}

function mistakesHTML() {
  const list = app.state.mistakes.filter(m => !!m.archived === showArchived);
  if (!list.length)
    return `<p class="muted">${showArchived ? 'No removed positions.' : 'No positions yet. Review a game or play with the coach on.'}</p>`;
  return list
    .slice(0, 60)
    .map(p => {
      const r = app.state.records[p.id];
      const origin = p.source?.reviewId ? app.state.reviews.find(x => x.id === p.source.reviewId) : null;
      const where = origin
        ? `from ${esc(origin.white)} – ${esc(origin.black)}`
        : p.source?.practice
          ? 'from a practice game'
          : 'from an imported game';
      return `<div class="review-item"><div><strong>${esc(p.title)}</strong><p>${new Chess(p.fen).turn() === 'w' ? 'White' : 'Black'} to move · ${where} · ${r?.clean ? `solved ${r.clean}×` : r?.tries ? 'not yet solved cleanly' : 'ready to practise'}</p></div>
        <div class="item-actions">${
          showArchived
            ? `<button type="button" data-restore="${p.id}">Restore</button><button type="button" class="danger" data-forget="${p.id}">Delete</button>`
            : `<button type="button" data-practise="${p.id}">Practise</button>${origin ? `<button type="button" data-view="${origin.id}" data-ply="${p.source.ply}">View in game</button>` : ''}<button type="button" class="icon-button" data-archive="${p.id}" aria-label="Remove ${esc(p.title)} from my mistakes">✕</button>`
        }</div></div>`;
    })
    .join('');
}

function wireMistakes() {
  const list = $('#mistake-list');
  if (!list) return;
  list.querySelectorAll('[data-practise]').forEach(b => (b.onclick = () => app.navigate('train', { puzzle: b.dataset.practise })));
  list
    .querySelectorAll('[data-view]')
    .forEach(b => (b.onclick = () => app.navigate('review', { review: b.dataset.view, ply: Number(b.dataset.ply) })));
  const refresh = () => {
    list.innerHTML = mistakesHTML();
    wireMistakes();
  };
  list.querySelectorAll('[data-archive]').forEach(
    b =>
      (b.onclick = () => {
        archiveMistake(b.dataset.archive, true);
        refresh();
        toast('Removed from your mistakes. Tick “Show removed” to restore it.');
      }),
  );
  list.querySelectorAll('[data-restore]').forEach(
    b =>
      (b.onclick = () => {
        archiveMistake(b.dataset.restore, false);
        refresh();
      }),
  );
  list.querySelectorAll('[data-forget]').forEach(
    b =>
      (b.onclick = async () => {
        if (
          !(await confirmDialog({
            title: 'Delete this position for good?',
            body: 'Its practice history is deleted too.',
            confirm: 'Delete',
            danger: true,
          }))
        )
          return;
        deleteMistake(b.dataset.forget);
        refresh();
      }),
  );
}

// ---------- Viewer ----------

function positions(review) {
  const g = new Chess(review.startFen);
  const fens = [g.fen()];
  const verbose = [];
  for (const san of review.moves) {
    const m = g.move(san);
    verbose.push(m);
    fens.push(g.fen());
  }
  return { fens, verbose };
}

function drawViewer(review) {
  const { fens, verbose } = positions(review);
  const total = review.moves.length;
  const ply = Math.max(0, Math.min(total, viewer.ply));
  viewer.ply = ply;
  const markAt = review.marks.find(m => m.ply === ply); // the reviewed side is about to move here
  const markJust = review.marks.find(m => m.ply === ply - 1); // the move just played
  const ev = review.evals[ply];
  const whiteShare =
    ev === null || ev === undefined ? 50 : 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * Math.max(-1000, Math.min(1000, ev)))) - 1);
  const moveLabel = ply === 0 ? 'Start position' : `${Math.ceil(ply / 2)}${ply % 2 ? '.' : '…'} ${review.moves[ply - 1]}`;
  const evText =
    ev === null || ev === undefined ? '' : Math.abs(ev) >= MATE_EVAL ? (ev > 0 ? 'White mating' : 'Black mating') : formatScore(ev);
  const focus = markJust || markAt;
  const mistake = focus?.mistakeId ? app.state.mistakes.find(m => m.id === focus.mistakeId) : null;

  root.innerHTML =
    pageHead(
      'GAME REVIEW',
      `${esc(review.white)} – ${esc(review.black)}`,
      esc([review.result, formatDate(review.date), `you played ${review.colour === 'w' ? 'White' : 'Black'}`].filter(Boolean).join(' · ')),
      '<button type="button" id="back-to-list">All reviews</button>',
    ) +
    `<div class="workspace">
      <div class="board-card">
        <div class="board-top"><strong id="board-title">${esc(moveLabel)}</strong><span class="chip">${esc(evText || 'not analysed')}</span></div>
        <div class="viewer-board">
          <div class="evalbar ${review.colour === 'b' ? 'flipped' : ''}" role="img" aria-label="Evaluation ${esc(evText || 'unknown')}"><span style="height:${whiteShare.toFixed(1)}%"></span></div>
          <div class="board-wrap"><div id="board"></div></div>
        </div>
        <div class="viewer-controls" role="group" aria-label="Move navigation">
          <button type="button" data-step="first" aria-label="First move">⏮</button>
          <button type="button" data-step="prev" aria-label="Previous move">◀</button>
          <span class="small">${ply} / ${total}</span>
          <button type="button" data-step="next" aria-label="Next move">▶</button>
          <button type="button" data-step="last" aria-label="Last move">⏭</button>
          <button type="button" id="board-flip" class="secondary" aria-label="Flip board">⇅</button>
        </div>
      </div>
      <div>
        <section class="panel">
          ${evalGraph('eval-graph', review.evals, review.marks, { current: ply })}
          ${focus ? momentHTML(review, focus, focus === markAt, mistake) : `<p class="muted small">Use the arrow keys or tap the graph to move through the game. Marked moves: ?! inaccuracy, ? mistake, ?? blunder.</p>`}
          <div class="actions">
            <button type="button" id="next-mark">Next marked move</button>
            ${review.marks.some(m => m.mistakeId) ? '<button type="button" id="practise-game" class="primary">Practise this game’s positions</button>' : ''}
          </div>
        </section>
        <section class="panel">
          <div class="eyebrow">MOVES</div>
          <ol class="move-list">${moveListHTML(review, ply)}</ol>
        </section>
      </div>
    </div>`;

  const board = new BoardView($('#board', root), { label: 'Game review board' });
  const arrows = [];
  if (markAt) {
    arrows.push({ from: markAt.best.slice(0, 2), to: markAt.best.slice(2, 4), kind: 'best' });
    const played = verbose[ply];
    if (played) arrows.push({ from: played.from, to: played.to, kind: 'played' });
  }
  const last = verbose[ply - 1];
  board.set({
    game: new Chess(fens[ply]),
    orientation: viewer.orientation || review.colour,
    interactive: false,
    lastMove: last ? [last.from, last.to] : [],
    arrows,
  });
  $('#board-flip', root).onclick = () => {
    viewer.orientation = opposite(board.orientation);
    board.set({ orientation: viewer.orientation });
  };
  const go = p => {
    viewer.ply = Math.max(0, Math.min(total, p));
    drawViewer(review);
  };
  root
    .querySelectorAll('[data-step]')
    .forEach(b => (b.onclick = () => go({ first: 0, prev: ply - 1, next: ply + 1, last: total }[b.dataset.step])));
  root.querySelectorAll('[data-ply]').forEach(b => (b.onclick = () => go(Number(b.dataset.ply))));
  $('#back-to-list', root).onclick = () => app.navigate('review', { list: true });
  $('#next-mark', root).onclick = () => {
    const next = review.marks.find(m => m.ply > ply) || review.marks[0];
    if (next) go(next.ply);
    else toast('No marked moves in this game.');
  };
  $('#practise-game', root)?.addEventListener('click', () => {
    const first = review.marks.find(m => m.mistakeId && app.state.mistakes.some(x => x.id === m.mistakeId && !x.archived));
    if (first) app.navigate('train', { puzzle: first.mistakeId });
    else toast('These positions were removed from your mistakes.');
  });
  $('#mark-practise', root)?.addEventListener('click', () => app.navigate('train', { puzzle: focus.mistakeId }));
  hydrateEvalGraph(root, 'eval-graph', review.evals, review.moves, i => go(i));
  keyHandler = e => {
    if (e.target.closest('input, textarea, select, [role="slider"]') || e.altKey || e.metaKey || e.ctrlKey) return;
    const map = { ArrowLeft: ply - 1, ArrowRight: ply + 1, Home: 0, End: total };
    if (e.key in map) {
      e.preventDefault();
      go(map[e.key]);
    }
  };
  document.addEventListener('keydown', keyHandler);
}

function momentHTML(review, mark, before, mistake) {
  const move = `${Math.floor(mark.ply / 2) + 1}${mark.ply % 2 ? '…' : '.'} ${review.moves[mark.ply]}${SYMBOL[mark.cls]}`;
  const lead = before
    ? `You are about to play ${move}. The green arrow shows ${esc(mark.bestSan)}.`
    : `${move} was ${mark.cls === 'inaccuracy' ? 'an inaccuracy' : 'a ' + mark.cls}. Better was ${esc(mark.bestSan)}.`;
  return `<div class="moment ${mark.cls}"><div class="eyebrow"><span class="badge ${mark.cls}">${SYMBOL[mark.cls]}</span> ${mark.cls.toUpperCase()} · −${mark.loss}% WINNING CHANCES</div>
    <p>${lead}</p>${mistake ? `<p class="muted">${esc(mistake.explanation)}</p><button type="button" id="mark-practise" class="primary">Practise this position</button>` : ''}</div>`;
}

function moveListHTML(review, ply) {
  let html = '';
  const startBlack = review.startFen.split(' ')[1] === 'b';
  const startNo = Number(review.startFen.split(' ')[5] || 1);
  review.moves.forEach((san, i) => {
    const idx = i + (startBlack ? 1 : 0);
    const no = startNo + Math.floor(idx / 2);
    const mark = review.marks.find(m => m.ply === i);
    const cls = ['move', mark ? mark.cls : '', ply === i + 1 ? 'current' : ''].join(' ');
    if (idx % 2 === 0 || i === 0) html += `<li><span class="move-no">${no}${idx % 2 ? '…' : '.'}</span>`;
    html += `<button type="button" class="${cls}" data-ply="${i + 1}" aria-current="${ply === i + 1}">${esc(san)}${mark ? SYMBOL[mark.cls] : ''}</button>`;
    if (idx % 2 === 1 || i === review.moves.length - 1) html += '</li>';
  });
  return html;
}
