// You: your real rating and whether it is moving. Nothing else is measured at
// you. The first visit asks for the name you play under, which is all the
// setting up there is.
import { app } from '../app-context.js';
import { $, esc, toast } from '../ui.js';
import { mainRating, trend } from '../ratings.js';
import { ownCounts } from '../srs.js';
import { syncRatings } from '../rating-sync.js';
import { syncNow, snapshot, subscribe } from '../queue.js';
import { openSettings } from '../settings.js';

let root = null;
let unsubscribe = null;

export function render(main) {
  root = main;
  unsubscribe?.();
  unsubscribe = subscribe(() => app.page === 'you' && drawFacts());
  draw();
}

export function leave() {
  unsubscribe?.();
  unsubscribe = null;
}

/** Redraw after a rating sync, when the screen is showing. */
export function refresh() {
  if (app.page === 'you' && root) draw();
}

const linked = () => !!(app.state.profiles.lichess || app.state.profiles.chesscom);

function draw() {
  root.innerHTML = `<section class="screen you">
    ${linked() ? ratingHTML() : connectHTML()}
    <dl class="facts" id="y-facts"></dl>
    <button type="button" id="y-settings" class="row-button">Settings<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>
  </section>`;
  drawFacts();
  $('#y-settings', root).onclick = () => openSettings({ onChange: () => refresh() });
  const form = $('#y-connect', root);
  if (form) form.onsubmit = connect;
}

/** The one piece of setting up: the name you play under. */
function connectHTML() {
  return `<form id="y-connect" class="connect">
    <h1>Train on your own games</h1>
    <p>Add the name you play under. Rankup reads your public games, finds the moves that cost you, and turns each into a position to solve.</p>
    <label for="y-chesscom">Chess.com username</label>
    <input id="y-chesscom" maxlength="40" spellcheck="false" autocomplete="off" autocapitalize="none">
    <label for="y-lichess">Lichess username</label>
    <input id="y-lichess" maxlength="40" spellcheck="false" autocomplete="off" autocapitalize="none">
    <button type="submit" class="btn primary wide">Connect</button>
  </form>`;
}

async function connect(e) {
  e.preventDefault();
  const s = app.state;
  const chesscom = $('#y-chesscom', root).value.trim();
  const lichess = $('#y-lichess', root).value.trim();
  if (!chesscom && !lichess) return toast('Enter the name you play under on either site.');
  s.profiles = { chesscom, lichess };
  s.sync.followed = [];
  app.save();
  draw();
  const [games, ratings] = await Promise.all([syncNow({ force: true }), syncRatings({ force: true })]);
  const errors = [...new Set([...games.errors, ...ratings.errors])];
  if (errors.length) toast(errors.join(' '));
  refresh();
}

/** "Chess.com blitz" big, with the change over 30 days and a line of the last few months. */
function ratingHTML() {
  const main = mainRating(app.state);
  if (!main)
    return `<div class="hero"><span class="label">Your rating</span><div class="big muted">…</div><p class="trend">Reading it from your account.</p></div>`;
  const t = trend(main.series);
  const others = Object.entries(app.state.sync.perfs || {})
    .filter(([perf]) => perf !== main.perf)
    .map(([perf, rating]) => `<span>${esc(perf)} <strong>${rating}</strong></span>`)
    .join('');
  const arrow = !t ? '' : t.change > 0 ? '▲' : t.change < 0 ? '▼' : '•';
  const tone = !t || !t.change ? 'flat' : t.change > 0 ? 'up' : 'down';
  const since = t ? Math.max(1, Math.round((Date.now() - new Date(t.from + 'T12:00:00').getTime()) / 86400000)) : 0;
  return `<div class="hero">
    <span class="label">${esc(main.perf)}</span>
    <div class="big" id="y-rating">${main.rating}</div>
    ${t ? `<p class="trend ${tone}" id="y-trend"><span aria-hidden="true">${arrow}</span> ${t.change ? Math.abs(t.change) + (t.change > 0 ? ' up' : ' down') : 'Level'} over ${since === 1 ? 'the last day' : `${Math.min(since, 30)} days`}</p>` : `<p class="trend flat" id="y-trend">Its movement shows here once there are a few days of games.</p>`}
    ${sparkline(main.series)}
    ${others ? `<div class="others">${others}</div>` : ''}
  </div>`;
}

/** A line of the series' last 90 days: no axes, the last point marked. */
export function sparkline(series, days = 90) {
  const cut = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const pts = series.filter(p => p.date >= cut);
  if (pts.length < 3) return '';
  const lo = Math.min(...pts.map(p => p.rating));
  const hi = Math.max(...pts.map(p => p.rating));
  const span = Math.max(hi - lo, 20);
  const t0 = new Date(pts[0].date).getTime();
  const t1 = Math.max(new Date(pts.at(-1).date).getTime(), t0 + 86400000);
  const xy = p => [((new Date(p.date).getTime() - t0) / (t1 - t0)) * 296 + 2, 62 - ((p.rating - lo) / span) * 54];
  const path = pts
    .map(
      (p, i) =>
        `${i ? 'L' : 'M'}${xy(p)
          .map(n => n.toFixed(1))
          .join(' ')}`,
    )
    .join('');
  const [lx, ly] = xy(pts.at(-1));
  return `<svg class="spark" viewBox="0 0 300 70" preserveAspectRatio="none" role="img" aria-label="Rating over the last ${days} days: from ${pts[0].rating} to ${pts.at(-1).rating}"><path class="area" d="${path}L${lx.toFixed(1)} 70L2 70Z"/><path class="line" d="${path}"/><circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="3.5"/></svg>`;
}

/** What the app holds for you, in three lines at most. */
function drawFacts() {
  const el = $('#y-facts', root);
  if (!el) return;
  const s = app.state;
  const { waiting, solved } = ownCounts(s.mistakes, s.records);
  const q = snapshot();
  const rows = [];
  if (waiting + solved) rows.push(['From your games', `${waiting} to fix · ${solved} solved`]);
  else if (linked()) rows.push(['From your games', q.pending || q.syncing ? 'Being read now' : 'No mistakes found yet']);
  rows.push(['Puzzle rating', String(s.puzzle.rating)]);
  if (q.pending) rows.push(['Reading your games', `${q.pending} to go`]);
  el.innerHTML = rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
}
