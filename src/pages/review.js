// Review a game: import (paste, file, Lichess, Chess.com), analyse, view, and
// manage the personal mistake bank that the analysis fills.
import { Chess } from '../../vendor/chess.js';
import { app } from '../app-context.js';
import { engine } from '../engine.js';
import { BoardView } from '../board.js';
import { $, esc, pageHead, confirmDialog, toast, plural, formatDate } from '../ui.js';
import { splitPgn, describeGame, detectColour, readHeaders } from '../pgn.js';
import { opposite } from '../chess-utils.js';
import { formatScore } from '../evaluation.js';
import { archiveMistake, deleteMistake } from '../mistakes.js';
import { evalGraph, hydrateEvalGraph } from '../charts.js';
import { moveTime, timeSummary, formatClock } from '../clocks.js';
import { openingStats } from '../openings.js';
import { analyseGame as runAnalysis, MAX_PLIES, MATE_EVAL } from '../analyse.js';
import { scheduleDeepAnalysis } from '../deep.js';
import { enqueue, remove as dequeue, snapshot as queueSnapshot, subscribe as watchQueue, syncNow } from '../queue.js';
import { gameKey } from '../sync.js';

export { MAX_PLIES, MATE_EVAL };
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
let unwatch = null;

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
  if (!unwatch)
    unwatch = watchQueue(() => {
      const el = $('#queue-panel');
      if (el && app.page === 'review') {
        el.innerHTML = queueHTML();
        wireQueue();
      }
    });
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
        <div id="queue-panel">${queueHTML()}</div>
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
    ${openingsHTML()}
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
  wireQueue();
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
    <p class="small">${plural(picker.games.length, 'game')} found. Choose one, or <button type="button" class="link" id="analyse-all">queue them all</button> for background review.</p>
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
  $('#analyse-all', root)?.addEventListener('click', () => {
    const names = usernames();
    const items = picker.games.map(pgn => ({
      pgn,
      colour: detectColour(pgn, names) || draft.colour,
      source: picker.source,
      key: gameKey(pgn),
      added: Date.now(),
    }));
    const added = enqueue(items);
    picker = null;
    selected = null;
    draw();
    toast(
      added
        ? `${added} ${added === 1 ? 'game' : 'games'} queued. They are reviewed in the background while you train.`
        : 'Those games are already queued or reviewed.',
    );
  });
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
  const url = `https://lichess.org/api/games/user/${encodeURIComponent(username)}?max=20&moves=true&tags=true&clocks=true&evals=false&opening=true`;
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

async function analyseGame(pgn, colour) {
  const token = ++analysis.token;
  analysis.running = true;
  draw();
  try {
    const { review, found, duplicate } = await runAnalysis(pgn, {
      colour,
      onProgress: setStatus,
      isCancelled: () => token !== analysis.token,
    });
    if (duplicate) {
      analysis.running = false;
      analysis.status = '';
      toast('You have already reviewed this game. Opening it.');
      return app.navigate('review', { review: review.id, ply: 0 });
    }
    analysis.status = `${review.complete ? 'Review complete' : 'Stopped'}. ${plural(found, 'practice position')} saved.`;
    analysis.running = false;
    selected = null;
    picker = null;
    if (app.page === 'review') app.navigate('review', { review: review.id, ply: firstMarkPly(review) });
    else toast('Your game review is ready under Review a game.');
    scheduleDeepAnalysis();
  } catch (e) {
    analysis.running = false;
    setStatus(e.message || 'Analysis failed. Try again.');
    draw();
  }
}

function firstMarkPly(review) {
  const live = review.marks.filter(x => !x.cleared);
  const m = live.find(x => x.cls !== 'inaccuracy') || live[0];
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
      const counts = ['blunder', 'mistake', 'inaccuracy'].map(c => r.marks.filter(m => m.cls === c && !m.cleared).length);
      const time = timeSummary(r);
      return `<div class="review-item"><div><strong>${esc(r.white)} – ${esc(r.black)}</strong><p>${esc([r.result, formatDate(r.date), `you: ${r.colour === 'w' ? 'White' : 'Black'}`, r.opening?.name].filter(Boolean).join(' · '))}<br>${counts[0]} blunders · ${counts[1]} mistakes · ${counts[2]} inaccuracies${r.complete ? '' : ' · partial'}${time.rushed ? ` · ${time.rushed} rushed` : ''}</p></div>
        <div class="item-actions"><button type="button" data-open="${esc(r.id)}">Open</button><button type="button" class="icon-button" data-delete-review="${esc(r.id)}" aria-label="Delete review of ${esc(r.white)} – ${esc(r.black)}">✕</button></div></div>`;
    })
    .join('');
}

function queueHTML() {
  const q = queueSnapshot();
  const linked = usernames().length > 0;
  if (!q.pending && !q.current && !q.syncing) {
    return linked && app.state.sync.auto
      ? `<p class="small muted">New games on your linked ${usernames().length === 2 ? 'accounts are' : 'account is'} imported and reviewed automatically while Rankup is open. <button type="button" class="link" id="queue-sync">Check now</button></p>`
      : '';
  }
  return `<div class="queue" aria-live="polite">
    ${q.syncing ? '<p class="small">Checking your accounts for new games…</p>' : ''}
    ${q.current ? `<p class="small"><strong>Reviewing ${esc(q.current.label)}</strong><br>${esc(q.current.progress)}</p>` : ''}
    ${q.items
      .filter(i => i.key !== q.current?.key)
      .map(
        i =>
          `<p class="small queue-item">Waiting: ${esc(i.label)} <button type="button" class="icon-button" data-dequeue="${esc(i.key)}" aria-label="Remove ${esc(i.label)} from the queue">✕</button></p>`,
      )
      .join('')}
  </div>`;
}

function wireQueue() {
  root.querySelectorAll('[data-dequeue]').forEach(b => (b.onclick = () => dequeue(b.dataset.dequeue)));
  $('#queue-sync', root)?.addEventListener('click', async () => {
    const { added, errors } = await syncNow({ force: true });
    toast(
      errors.length
        ? errors.join(' ')
        : added
          ? `${added} new ${added === 1 ? 'game' : 'games'} queued.`
          : 'No new games since the last check.',
    );
  });
}

function openingsHTML() {
  const stats = openingStats(app.state.reviews);
  if (!stats.length) return '';
  return `<section class="panel">
    <div class="eyebrow">YOUR OPENINGS</div>
    <h2>How your openings are going</h2>
    <p class="small">From the games you have reviewed, grouped by opening. Score counts a win as 1 and a draw as ½. A handful of games is not a verdict.</p>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th scope="col">Opening</th><th scope="col">Games</th><th scope="col">W / D / L</th><th scope="col">Score</th><th scope="col">Mistakes per game</th></tr></thead>
      <tbody>${stats
        .slice(0, 12)
        .map(
          o =>
            `<tr><th scope="row">${esc(o.family)}</th><td>${o.games}</td><td>${o.wins} / ${o.draws} / ${o.losses}</td><td>${o.score === null ? '–' : o.score + '%'}</td><td>${(o.errors / o.games).toFixed(1)}</td></tr>`,
        )
        .join('')}</tbody>
    </table></div>
  </section>`;
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
            ? `<button type="button" data-restore="${esc(p.id)}">Restore</button><button type="button" class="danger" data-forget="${esc(p.id)}">Delete</button>`
            : `<button type="button" data-practise="${esc(p.id)}">Practise</button>${origin ? `<button type="button" data-view="${esc(origin.id)}" data-ply="${Number(p.source.ply) || 0}">View in game</button>` : ''}<button type="button" class="icon-button" data-archive="${esc(p.id)}" aria-label="Remove ${esc(p.title)} from my mistakes">✕</button>`
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
  // Every redraw replaces the keyboard handler; never stack them.
  leave();
  const { fens, verbose } = positions(review);
  const total = review.moves.length;
  const ply = Math.max(0, Math.min(total, viewer.ply));
  viewer.ply = ply;
  const marks = review.marks.filter(m => !m.cleared);
  const markAt = marks.find(m => m.ply === ply); // the reviewed side is about to move here
  const markJust = marks.find(m => m.ply === ply - 1); // the move just played
  const clearedJust = review.marks.find(m => m.cleared && m.ply === ply - 1);
  const timeJust = ply > 0 ? moveTime(review, ply - 1) : null;
  const ev = review.evals[ply];
  const whiteShare =
    ev === null || ev === undefined ? 50 : 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * Math.max(-1000, Math.min(1000, ev)))) - 1);
  const labels = review.moves.map((_, i) => plyLabel(review, i));
  const moveLabel = ply === 0 ? 'Start position' : labels[ply - 1];
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
          ${evalGraph('eval-graph', review.evals, marks, { current: ply })}
          ${review.opening ? `<p class="small opening-line"><strong>${esc(review.opening.eco)}</strong> ${esc(review.opening.name)}</p>` : ''}
          ${timeJust ? `<p class="small clock-line">${esc(labels[ply - 1])}: ${formatSpent(timeJust.spent)} spent with ${formatClock(timeJust.left)} on the clock${timeJust.trouble ? ' · time trouble' : ''}</p>` : ''}
          ${clearedJust ? `<p class="status">A deeper engine check found ${esc(labels[ply - 1])} was fine. It is no longer marked.</p>` : ''}
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
    const next = marks.find(m => m.ply > ply) || marks[0];
    if (next) go(next.ply);
    else toast('No marked moves in this game.');
  };
  $('#practise-game', root)?.addEventListener('click', () => {
    const first = review.marks.find(m => m.mistakeId && app.state.mistakes.some(x => x.id === m.mistakeId && !x.archived));
    if (first) app.navigate('train', { puzzle: first.mistakeId });
    else toast('These positions were removed from your mistakes.');
  });
  $('#mark-practise', root)?.addEventListener('click', () => app.navigate('train', { puzzle: focus.mistakeId }));
  hydrateEvalGraph(root, 'eval-graph', review.evals, labels, i => go(i));
  keyHandler = e => {
    if (app.page !== 'review') return;
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
  const move = `${plyLabel(review, mark.ply)}${SYMBOL[mark.cls]}`;
  const lead = before
    ? `You are about to play ${move}. The green arrow shows ${esc(mark.bestSan)}.`
    : `${move} was ${mark.cls === 'inaccuracy' ? 'an inaccuracy' : 'a ' + mark.cls}. Better was ${esc(mark.bestSan)}.`;
  const t = moveTime(review, mark.ply);
  const timing = t
    ? t.rushed
      ? ` You spent ${formatSpent(t.spent)} on it: a critical moment played quickly.`
      : t.trouble
        ? ` You had ${formatClock(t.left)} left: time trouble.`
        : ` You spent ${formatSpent(t.spent)} on it.`
    : '';
  return `<div class="moment ${mark.cls}"><div class="eyebrow"><span class="badge ${mark.cls}">${SYMBOL[mark.cls]}</span> ${mark.cls.toUpperCase()} · −${mark.loss}% WINNING CHANCES${mark.deep ? ' · DEEP CHECKED' : ''}</div>
    <p>${lead}${esc(timing)}</p>${mistake ? `<p class="muted">${esc(mistake.explanation)}</p><button type="button" id="mark-practise" class="primary">Practise this position</button>` : ''}</div>`;
}

function formatSpent(s) {
  return s < 60 ? `${s < 10 ? s.toFixed(1).replace(/\.0$/, '') : Math.round(s)}s` : formatClock(s);
}

/** "20… Nf6" for move index i, honouring games that start from a position. */
export function plyLabel(review, i) {
  const [, turn, , , , full] = review.startFen.split(' ');
  const idx = i + (turn === 'b' ? 1 : 0);
  const no = Number(full || 1) + Math.floor(idx / 2);
  return `${no}${idx % 2 ? '…' : '.'} ${review.moves[i]}`;
}

function moveListHTML(review, ply) {
  let html = '';
  const startBlack = review.startFen.split(' ')[1] === 'b';
  const startNo = Number(review.startFen.split(' ')[5] || 1);
  review.moves.forEach((san, i) => {
    const idx = i + (startBlack ? 1 : 0);
    const no = startNo + Math.floor(idx / 2);
    const mark = review.marks.find(m => m.ply === i && !m.cleared);
    const cls = ['move', mark ? mark.cls : '', ply === i + 1 ? 'current' : ''].join(' ');
    if (idx % 2 === 0 || i === 0) html += `<li><span class="move-no">${no}${idx % 2 ? '…' : '.'}</span>`;
    html += `<button type="button" class="${cls}" data-ply="${i + 1}" aria-current="${ply === i + 1}">${esc(san)}${mark ? SYMBOL[mark.cls] : ''}</button>`;
    if (idx % 2 === 1 || i === review.moves.length - 1) html += '</li>';
  });
  return html;
}
