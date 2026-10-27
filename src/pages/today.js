// Today: the home screen. Your goal, where you are in the curriculum, and one
// button that runs today's session. New players get a one-step setup.
import { app } from '../app-context.js';
import { $, esc, plural, formatDate, toast } from '../ui.js';
import { todaysSession, startBlock, sessionProgress, checkSession, startReset } from '../session.js';
import { goalStatus, goalSeries, updateGoal, PUZZLE_PERF } from '../progress-model.js';
import { pathSummary, place, unitById, unitStatus } from '../curriculum.js';
import { syncRatings } from '../rating-sync.js';
import { RATING_PERFS } from '../ratings.js';
import { sparkline } from '../charts.js';
import { syncNow, lastSyncAt } from '../queue.js';
import { dateKey, streaks } from '../state.js';
import { STAGES } from '../themes.js';
import { streakMode, diagnoseStreak, LEAKS, MIN_COUNTED } from '../leak.js';
import { stopState, tiltProfile, ruleLine } from '../tilt.js';
import { mainControl, rowsBetween } from '../ledger.js';
import { strugglingLines } from '../opening-practice.js';
import { dueCards } from '../repertoire.js';

let root = null;
let setup = { step: 'account', site: 'lichess', name: '', busy: false, error: '' };

const PERF_LABEL = p => (p === 'auto' ? 'Auto' : p[0].toUpperCase() + p.slice(1));
const perfOptions = current =>
  ['auto', ...RATING_PERFS].map(p => `<option value="${p}" ${current === p ? 'selected' : ''}>${PERF_LABEL(p)}</option>`).join('');

/**
 * Follow a different time control: refetch ratings and move the goal to it.
 * Says so when the account has no games in it.
 */
export async function followPerf(perf) {
  const s = app.state;
  s.settings.perf = perf;
  app.save();
  if (!s.profiles.lichess && !s.profiles.chesscom) return;
  await syncRatings({ force: true });
  const followed = s.sync.followed || [];
  if (perf !== 'auto' && followed.length && !followed.some(p => p.endsWith(` ${perf}`)))
    toast(`No ${perf} games on your account yet, so the goal follows ${followed[0]}.`);
  else if (s.target) toast(`Your goal now follows ${s.target.perf}.`);
  s.session = null;
  refresh();
}

const LEVELS = [
  { label: 'Just learning', detail: 'I know how the pieces move', rating: 600 },
  { label: 'Casual', detail: 'I play now and then', rating: 900 },
  { label: 'Club player', detail: 'Around 1200 online', rating: 1200 },
  { label: 'Strong', detail: '1500 or more online', rating: 1500 },
];

export function render(main) {
  root = main;
  if (!app.state.onboarded) return drawSetup();
  ensurePlan();
  draw();
}

/** Place the curriculum and set a goal the first time, from the best rating known. */
function ensurePlan() {
  const s = app.state;
  if (!s.curriculum.placed) {
    const real = s.ratings.at(-1)?.rating;
    place(s, real || s.puzzle.rating, dateKey());
  }
  updateGoal(s);
  checkSession({ settle: true });
  app.save();
}

// ---------- Setup ----------

function drawSetup() {
  const step = setup.step;
  root.innerHTML = `<div class="focus today setup">
    <h1>Set up your plan</h1>
    <p class="muted">Your username is enough. Rankup reads your rating and games, then plans every session.</p>
    ${
      step === 'account'
        ? `<form id="setup-form" class="panel">
            <div class="segmented" role="group" aria-label="Where you play">
              <button type="button" data-site="lichess" class="${setup.site === 'lichess' ? 'active' : ''}" aria-pressed="${setup.site === 'lichess'}">Lichess</button>
              <button type="button" data-site="chesscom" class="${setup.site === 'chesscom' ? 'active' : ''}" aria-pressed="${setup.site === 'chesscom'}">Chess.com</button>
            </div>
            <div class="field"><label for="setup-name">Username</label><input id="setup-name" autocomplete="username" spellcheck="false" maxlength="40" placeholder="Your username" value="${esc(setup.name)}"></div>
            <div class="field"><span class="field-label" id="perf-label">Time control</span>
              <div class="segmented" role="group" aria-labelledby="perf-label">${['auto', ...RATING_PERFS]
                .map(
                  p =>
                    `<button type="button" data-perf="${p}" class="${app.state.settings.perf === p ? 'active' : ''}" aria-pressed="${app.state.settings.perf === p}">${PERF_LABEL(p)}</button>`,
                )
                .join('')}</div>
            </div>
            ${setup.error ? `<p class="status error">${esc(setup.error)}</p>` : ''}
            <button type="submit" class="primary big" ${setup.busy ? 'disabled' : ''}>${setup.busy ? 'Reading your games…' : 'Start'}</button>
            <p class="small">Only your public profile is read. Nothing leaves your device.</p>
          </form>
          <p class="center"><button type="button" class="link" id="no-account">I don’t play online</button></p>`
        : `<div class="panel">
            <h2>How strong are you, roughly?</h2>
            <div class="choices" role="group" aria-label="Your level">${LEVELS.map((l, i) => `<button type="button" class="choice" data-level="${i}"><strong>${esc(l.label)}</strong><br><span class="small">${esc(l.detail)}</span></button>`).join('')}</div>
            <p class="small">A first guess is enough. Your puzzles set your real level within a few sessions.</p>
          </div>
          <p class="center"><button type="button" class="link" id="back-account">Link an account instead</button></p>`
    }
  </div>`;
  $('#setup-name', root)?.addEventListener('input', e => (setup.name = e.target.value));
  root.querySelectorAll('[data-site]').forEach(
    b =>
      (b.onclick = () => {
        setup.site = b.dataset.site;
        drawSetup();
      }),
  );
  root.querySelectorAll('[data-perf]').forEach(
    b =>
      (b.onclick = () => {
        app.state.settings.perf = b.dataset.perf;
        app.save();
        drawSetup();
      }),
  );
  $('#setup-form', root)?.addEventListener('submit', e => {
    e.preventDefault();
    linkAccount($('#setup-name').value.trim());
  });
  $('#no-account', root)?.addEventListener('click', () => {
    setup = { ...setup, step: 'level', error: '' };
    drawSetup();
  });
  $('#back-account', root)?.addEventListener('click', () => {
    setup = { ...setup, step: 'account', error: '' };
    drawSetup();
  });
  root.querySelectorAll('[data-level]').forEach(b => (b.onclick = () => finishSetup(LEVELS[Number(b.dataset.level)].rating)));
}

async function linkAccount(name) {
  if (!/^[A-Za-z0-9_-]{2,40}$/.test(name)) {
    setup.error = 'Enter your username: letters, numbers, - and _ only.';
    return drawSetup();
  }
  setup = { ...setup, busy: true, error: '' };
  drawSetup();
  const s = app.state;
  s.profiles[setup.site] = name;
  const { errors } = await syncRatings({ force: true });
  setup.busy = false;
  const real = s.ratings.at(-1);
  if (!real) {
    s.profiles[setup.site] = '';
    setup.error = errors[0] || 'No rapid, blitz or classical rating found on that account. Choose your level instead.';
    return drawSetup();
  }
  finishSetup(real.rating);
  syncNow({ force: true }).catch(() => {});
}

/** Seed the puzzle and skill ratings, place the curriculum and set the goal. */
function finishSetup(rating) {
  const s = app.state;
  const seed = Math.max(STAGES[0].rating - 200, Math.min(2200, rating));
  if (s.puzzle.count < 10) s.puzzle.rating = seed;
  for (const k of Object.keys(s.skills)) if (!s.skills[k].count) s.skills[k] = { rating: seed, count: 0 };
  place(s, rating, dateKey());
  s.onboarded = true;
  s.session = null;
  updateGoal(s);
  app.save();
  draw();
}

// ---------- Today ----------

/** "just now", "12 min ago", "3 h ago" or a date. */
function ago(time, now = Date.now()) {
  const min = Math.round((now - time) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.round(min / 60)} h ago`;
  return formatDate(new Date(time).toISOString().slice(0, 10));
}

/** The change over the last two weeks: { delta, since } or null with too little history. */
function recentChange(series, current, now = new Date()) {
  if (series.length < 2) return null;
  const cutoff = dateKey(new Date(now.getTime() - 14 * 86400000));
  const base = series.filter(p => p.date <= cutoff).at(-1) || series[0];
  if (base === series.at(-1)) return null;
  return { delta: current - base.rating, since: base.date <= cutoff ? '14 days' : `since ${formatDate(base.date)}` };
}

function goalHTML() {
  const s = app.state;
  const g = goalStatus(s);
  if (!g) return '';
  const t = s.target;
  const series = goalSeries(s);
  const label = t.perf === PUZZLE_PERF ? 'Rankup rating' : t.perf;
  const change = recentChange(series, g.current);
  const status =
    g.status === 'reached'
      ? 'Target reached'
      : g.status === 'on-track'
        ? `On track · ${g.projected}`
        : g.weeksBehind
          ? `${plural(g.weeksBehind, 'week')} behind`
          : 'Behind';
  return `<section class="goal-card" aria-label="Your goal">
    <div class="goal-top">${perfIcon(t.perf)}<span class="small">${esc(label)}${t.perf !== PUZZLE_PERF && s.sync.ratingsAt ? ` · updated ${esc(ago(s.sync.ratingsAt))}` : ''}</span></div>
    <div class="hero">
      <div class="goal-numbers"><strong>${g.current}</strong></div>
      <div class="hero-side">
        ${change ? `<span><span class="hero-delta ${change.delta > 0 ? 'up' : ''}">${change.delta > 0 ? '+' : change.delta < 0 ? '−' : '±'}${Math.abs(change.delta)}</span> ${esc(change.since)}</span>` : ''}
        <span>Goal ${t.target} · ${esc(formatDate(t.by))}</span>
        <span class="goal-status ${g.status}">${esc(status)}</span>
      </div>
    </div>
    ${sparkline(series, { target: t.target })}
  </section>`;
}

// ---------- The stop line and the streak ----------

/** "21:42", the local time of a timestamp. */
const clockTime = ms => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** The STOP card: a loss in the last 20 minutes, the reset button (or the reset already done) and when the ledger was last synced. */
function stopHTML(stop) {
  const synced = lastSyncAt();
  const action = stop.resetDone
    ? `<p class="small reset-done">Reset done ${esc(ago(stop.resetDone))}. Play one game, then come back.</p>`
    : '<button type="button" id="stop-reset" class="primary big">Reset · 4 min</button>';
  return `<section class="stop-card" aria-label="Stop">
    <h2>STOP.</h2>
    <p>${esc(stop.text)}</p>
    ${action}
    ${synced ? `<p class="small">as of your last sync, ${clockTime(synced)}</p>` : ''}
  </section>`;
}

/** "3 games, 1–2": today's games as wins–losses. */
function tonightScore(ledger, games) {
  const key = dateKey();
  let wins = 0;
  let losses = 0;
  for (const r of ledger) {
    if (dateKey(new Date(r.t)) !== key) continue;
    if (r.r === 1) wins++;
    else if (r.r === 0) losses++;
  }
  return `${plural(games, 'game')}, ${wins}–${losses}`;
}

/**
 * Under the Today header: the play rule once the ledger holds ten games of
 * the main control (the first time it shows, the stop line's date is set),
 * what the verdicts say, and tonight's games. After two losses in a row the
 * tonight line is a bordered one that says what changes.
 */
function ruleHTML(stop) {
  const s = app.state;
  const ledger = s.ledger || [];
  const profile = tiltProfile(ledger);
  const parts = [];
  const tonight = stop.tonight && !stop.live;
  if (tonight) {
    const first = stop.text.split(/(?<=\.)\s/)[0];
    parts.push(
      `<p class="rule-line tonight">Tonight: ${esc(tonightScore(ledger, profile.today.games))}. ${esc(first)} Reset first; no game block today.</p>`,
    );
  }
  const control = mainControl(ledger);
  if (!control || rowsBetween(ledger, 0, Infinity, { control }).length < 10) return parts.join('');
  if (!s.stop) s.stop = { since: null, resets: [] };
  if (!s.stop.since) {
    s.stop.since = dateKey();
    app.save();
  }
  parts.push(`<p class="rule-line small">${esc(ruleLine(profile))}${profile.rule.default ? ' · default' : ''}</p>`);
  for (const line of profile.lines) parts.push(`<p class="small verdict-line">${esc(line)}</p>`);
  if (!tonight && profile.today.games >= 1)
    parts.push(`<p class="small tonight-line">Tonight: ${esc(tonightScore(ledger, profile.today.games))}.</p>`);
  return parts.join('');
}

/** The streak: how many of the last ten were lost and the leak that started most of the losses, with its habit. */
function leakHTML(d) {
  const lead = `<strong>Losing ${d.lost10} of your last ${d.games10}.</strong>`;
  let body;
  if (d.leak)
    body =
      ` ${d.counts[d.leak]} of them began with ${esc(d.label || LEAKS[d.leak].label)}. ` +
      `<span class="small">Habit: ${esc(d.habit || LEAKS[d.leak].habit)}</span>`;
  else if (d.counted < MIN_COUNTED) body = ` ${d.counted} of them read so far: the leak appears at ${MIN_COUNTED}.`;
  else body = ` ${d.counted} of them read: no one leak started enough of them yet.`;
  return `<section aria-labelledby="streak-head" class="streak-card">
    <div class="section-rule"><span id="streak-head">The streak</span><span>last 10 games</span></div>
    <p class="leak-line">${lead}${body}</p>
  </section>`;
}

/**
 * Remember the streak being worked on while streak mode is on; when it ends,
 * say so once with the leak's count then and now.
 */
function trackStreak(on, d) {
  const s = app.state;
  if (on) {
    const next = { leak: d.leak, count: d.leak ? d.counts[d.leak] : 0, counted: d.counted };
    if (!s.streak) {
      s.streak = { since: dateKey(), ...next };
      app.save();
    } else if (s.streak.leak !== next.leak || s.streak.count !== next.count || s.streak.counted !== next.counted) {
      Object.assign(s.streak, next);
      app.save();
    }
    return;
  }
  if (!s.streak) return;
  const was = s.streak;
  let text = `Streak over: ${d.lost10} of your last ${d.games10}.`;
  if (d.counted >= 3 && was.leak)
    text += ` Losses that began with the leak: ${was.count} of ${was.counted} → ${d.counts[was.leak]} of ${d.counted}.`;
  s.streak = null;
  app.save();
  toast(text, { duration: 9000 });
}

// ---------- Ratings and drills ----------

/** Flat icons for each time control and for puzzles; colours come from the stylesheet. */
const ICONS = {
  bullet:
    '<path class="fill-gold" d="M5.5 18.5 15 9l3.6-1.1-1.1 3.6-9.5 9.5z"/><path class="stroke-muted" d="M3.5 15.5l-1.5 1.5M6.5 20.5 5 22"/>',
  blitz: '<path class="fill-gold" d="M13.5 2 4.5 13.5h6.5l-1.5 8.5 9-11.5h-6.5z"/>',
  rapid:
    '<circle class="fill-green" cx="12" cy="13.5" r="8"/><circle class="fill-face" cx="12" cy="13.5" r="5.6"/><path class="stroke-dark" d="M12 13.5V10"/><rect class="fill-green" x="10" y="2.5" width="4" height="3" rx="1"/>',
  classical:
    '<path class="fill-blue" d="M6.5 3h11v3.5l-4 5.5 4 5.5V21h-11v-3.5l4-5.5-4-5.5z"/><path class="fill-face" d="M9 18.5h6L12 15z"/>',
  puzzle: '<path class="fill-blue" d="M4 7h4a2.5 2.5 0 1 1 5 0h4v4a2.5 2.5 0 1 1 0 5v4H4v-4.5a2.5 2.5 0 1 0 0-4.5z"/>',
};

/** The icon for a rating label such as "Lichess blitz", or the puzzle icon. */
function perfIcon(perf) {
  const kind = Object.keys(ICONS).find(k => perf.toLowerCase().endsWith(k)) || 'puzzle';
  return `<svg class="perf-icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[kind]}</svg>`;
}

/**
 * Your other ratings beside the goal's: every time control on the same site,
 * from the last sync, then your Rankup puzzle rating.
 */
function ratingTiles() {
  const s = app.state;
  const followed = s.target?.perf || '';
  const site = followed.split(' ')[0];
  const known = { ...Object.fromEntries(s.ratings.map(r => [r.platform, r.rating])), ...(s.sync.perfs || {}) };
  const order = ['bullet', 'blitz', 'rapid', 'classical'];
  const tiles = Object.entries(known)
    .filter(([perf]) => perf !== followed && perf.startsWith(`${site} `) && order.includes(perf.split(' ')[1]))
    .sort((a, b) => order.indexOf(a[0].split(' ')[1]) - order.indexOf(b[0].split(' ')[1]))
    .map(([perf, rating]) => ({ perf, label: PERF_LABEL(perf.split(' ')[1]), rating }));
  if (followed !== PUZZLE_PERF) tiles.push({ perf: 'puzzle', label: 'Puzzles', rating: s.puzzle.rating });
  // One tile on its own looks like a mistake: the row waits for a sync that brings the rest.
  if (tiles.length < 2) return '';
  return `<section aria-label="Your other ratings" class="rating-tiles">${tiles
    .map(t => `<div class="rating-tile">${perfIcon(t.perf)}<strong>${t.rating}</strong><span>${esc(t.label)}</span></div>`)
    .join('')}</section>`;
}

/** Shortcuts to the drills, with what is waiting in each. */
function drillsHTML() {
  const s = app.state;
  const weak = strugglingLines(s.reviews);
  const due = dueCards(s).length;
  const cards = [
    weak.length && { go: 'openings', title: 'Weak openings', detail: `${plural(weak.length, 'line')} to practise` },
    due && { go: 'repertoire', title: 'Your repertoire', detail: `${due} due` },
    { go: 'endgames', title: 'Endgames', detail: 'vs Stockfish' },
    { go: 'checks', title: 'Find every check', detail: 'Calculation' },
  ].filter(Boolean);
  return `<section aria-labelledby="drills-head">
    <div class="section-head"><h2 id="drills-head">Drills</h2><a href="#train">All training</a></div>
    <div class="drill-cards">${cards
      .slice(0, 4)
      .map(
        c =>
          `<button type="button" class="drill-card" data-drill="${c.go}"><strong>${esc(c.title)}</strong><span>${esc(c.detail)}</span></button>`,
      )
      .join('')}</div>
  </section>`;
}

function draw() {
  if (!root || app.page !== 'today') return;
  const s = app.state;
  const session = todaysSession();
  const prog = sessionProgress(session);
  const path = pathSummary(s);
  const unit = unitById(session.unit);
  const unitPct = unit ? Math.round(unitStatus(s, unit).progress * 100) : 0;
  const streak = streaks(s.days);
  const firstTodo = session.blocks.findIndex(b => b.status === 'todo' || b.status === 'active');
  const label = prog.complete ? 'Done for today' : prog.done ? 'Continue' : 'Start today’s session';
  const stop = stopState(s);
  const inStreak = streakMode(s);
  const diagnosis = inStreak || s.streak ? diagnoseStreak(s) : null;
  trackStreak(inStreak, diagnosis);
  const current = session.blocks[firstTodo];
  const pct = Math.round((prog.done / Math.max(1, session.blocks.length)) * 100);
  root.innerHTML = `<div class="focus today">
    ${stop.live ? stopHTML(stop) : ''}
    <section class="session-hero" aria-labelledby="today-head">
      <span class="eyebrow" id="today-head">Today’s session · ${prog.complete ? 'all done' : `${prog.done} of ${session.blocks.length} done · ${prog.minutesLeft ?? session.minutes} min`}</span>
      <h2>${esc(prog.complete ? 'Done for today' : current?.title || 'Today’s session')}</h2>
      <div class="hero-track" role="img" aria-label="${pct}% done"><span style="width:${pct}%"></span></div>
      <button type="button" id="start-session" class="gold" ${prog.complete ? 'disabled' : ''}><span>${esc(label)}</span></button>
      <svg class="hero-knight" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 21h11l-1-3c2-1 3-4 3-7 0-5-4-8-8-8l-1 2-3 1-3 5 2 1 2-1 1 2-4 5z"/></svg>
    </section>
    ${inStreak ? leakHTML(diagnosis) : ''}
    ${goalHTML()}
    ${ratingTiles()}
    <section aria-labelledby="plan-head">
      <div class="section-head"><h2 id="plan-head">Today’s plan</h2><span>${plural(session.blocks.length, 'block')}</span></div>
      ${ruleHTML(stop)}
      <ol class="agenda">${session.blocks
        .map(
          (b, i) =>
            `<li class="agenda-item ${b.status}${i === firstTodo && !prog.complete ? ' current' : ''}"><button type="button" data-block="${i}" ${b.status === 'done' ? 'aria-label="' + esc(b.title) + ', done"' : ''}>
              <span class="agenda-mark" aria-hidden="true">${b.status === 'done' ? '✓' : i + 1}</span>
              <span class="agenda-text"><strong>${esc(b.title)}</strong><span class="small">${esc(b.detail)}</span></span>
              <span class="small agenda-time">${Math.max(1, Math.round(b.est))} min</span>
            </button></li>`,
        )
        .join('')}</ol>
    </section>
    <p class="level-line"><strong>${esc(path.band.label)}</strong> · ${path.bandDone} of ${path.bandTotal} units${unit ? ` · now: ${esc(unit.title)} (${unitPct}%)` : ''}</p>
    ${prog.complete ? `<p class="status success">Session complete. ${streak.current > 1 ? `${streak.current}-day streak. ` : ''}Tomorrow’s plan builds on today.</p><div class="actions center"><button type="button" id="more">Train more</button></div>` : ''}
    ${drillsHTML()}
    <div class="today-foot small">
      <label for="minutes">Daily time</label>
      <select id="minutes">${[10, 20, 30, 45, 60].map(m => `<option value="${m}" ${s.minutes === m ? 'selected' : ''}>${m} min</option>`).join('')}</select>
      ${s.profiles.lichess || s.profiles.chesscom ? `<span>·</span><label for="follow-perf">Rating</label><select id="follow-perf">${perfOptions(s.settings.perf)}</select>` : ''}
      <span>·</span><a href="#path">Your path</a><span>·</span><a href="#coach">Coach</a>
    </div>
    <button type="button" id="play-now" class="play-cta">Play</button>
  </div>`;
  $('#play-now', root).onclick = () => app.navigate('play');
  root.querySelectorAll('[data-drill]').forEach(b => (b.onclick = () => app.navigate('drills', { drill: b.dataset.drill })));
  $('#start-session', root).onclick = () => startBlock(firstTodo);
  $('#stop-reset', root)?.addEventListener('click', () => startReset());
  root.querySelectorAll('[data-block]').forEach(b => (b.onclick = () => startBlock(Number(b.dataset.block))));
  $('#more', root)?.addEventListener('click', () => {
    s.session = null;
    todaysSession({ rebuild: true });
    toast('Here is another session.');
    draw();
  });
  $('#follow-perf', root)?.addEventListener('change', e => followPerf(e.target.value));
  $('#minutes', root).onchange = e => {
    s.minutes = Number(e.target.value);
    if (s.target) s.target.minutes = s.minutes;
    // Rebuild today's plan for the new time, keeping finished blocks.
    const done = new Set(s.session?.blocks.filter(b => b.status === 'done').map(b => b.id) || []);
    s.session = null;
    const fresh = todaysSession({ rebuild: true });
    for (const b of fresh.blocks) if (done.has(b.id)) b.status = 'done';
    app.save();
    draw();
  };
}

/** Called by main.js when sync or ratings change, to refresh the numbers. */
export function refresh() {
  if (app.page === 'today' && app.state.onboarded) draw();
}

export const title = 'Today';
