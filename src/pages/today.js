// Today: the home screen. Your goal, where you are in the curriculum, and one
// button that runs today's session. New players get a one-step setup.
import { app } from '../app-context.js';
import { $, esc, plural, formatDate, toast } from '../ui.js';
import { todaysSession, startBlock, sessionProgress, checkSession } from '../session.js';
import { goalStatus, updateGoal, PUZZLE_PERF } from '../progress-model.js';
import { pathSummary, place, unitById, unitStatus } from '../curriculum.js';
import { syncRatings } from '../rating-sync.js';
import { RATING_PERFS } from '../ratings.js';
import { syncNow } from '../queue.js';
import { dateKey, streaks } from '../state.js';
import { STAGES } from '../themes.js';

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

function goalHTML() {
  const s = app.state;
  const g = goalStatus(s);
  if (!g) return '';
  const t = s.target;
  const span = Math.max(1, t.target - t.start.rating);
  const pct = Math.max(2, Math.min(100, ((g.current - t.start.rating) / span) * 100));
  const label = t.perf === PUZZLE_PERF ? 'Rankup rating' : t.perf;
  const status =
    g.status === 'reached'
      ? 'Target reached'
      : g.status === 'on-track'
        ? `On track: projected ${g.projected}`
        : g.weeksBehind
          ? `About ${plural(g.weeksBehind, 'week')} behind: today’s plan pushes harder`
          : 'Behind: today’s plan pushes harder';
  return `<section class="goal-card" aria-label="Your goal">
    <div class="goal-top"><span class="small">${esc(label)}${t.perf !== PUZZLE_PERF && s.sync.ratingsAt ? ` · updated ${esc(ago(s.sync.ratingsAt))}` : ''}</span><span class="small">by ${esc(formatDate(t.by))}</span></div>
    <div class="goal-numbers"><strong>${g.current}</strong><span aria-hidden="true">→</span><strong>${t.target}</strong></div>
    <div class="goal-track" role="progressbar" aria-valuemin="${t.start.rating}" aria-valuemax="${t.target}" aria-valuenow="${g.current}" aria-label="Progress to ${t.target}"><span style="width:${pct}%"></span></div>
    <p class="small goal-status ${g.status}">${esc(status)}</p>
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
  const label = prog.complete
    ? 'Done for today'
    : prog.done
      ? `Continue · ${prog.minutesLeft} min left`
      : `Start today’s session · ${session.minutes} min`;
  root.innerHTML = `<div class="focus today">
    ${goalHTML()}
    <p class="level-line"><strong>${esc(path.band.label)}</strong> · ${path.bandDone} of ${path.bandTotal} units${unit ? ` · now: ${esc(unit.title)} (${unitPct}%)` : ''}</p>
    <button type="button" id="start-session" class="primary big" ${prog.complete ? 'disabled' : ''}>${esc(label)}</button>
    <ol class="agenda">${session.blocks
      .map(
        (b, i) =>
          `<li class="agenda-item ${b.status}"><button type="button" data-block="${i}" ${b.status === 'done' ? 'aria-label="' + esc(b.title) + ', done"' : ''}>
            <span class="agenda-mark" aria-hidden="true">${b.status === 'done' ? '✓' : b.status === 'skipped' ? '–' : i + 1}</span>
            <span class="agenda-text"><strong>${esc(b.title)}</strong><span class="small">${esc(b.detail)}</span></span>
            <span class="small agenda-time">${Math.max(1, Math.round(b.est))} min</span>
          </button></li>`,
      )
      .join('')}</ol>
    ${prog.complete ? `<p class="status success">Session complete. ${streak.current > 1 ? `${streak.current}-day streak. ` : ''}Tomorrow’s plan builds on today.</p><div class="actions center"><button type="button" id="more">Train more</button></div>` : ''}
    <div class="today-foot small">
      <label for="minutes">Daily time</label>
      <select id="minutes">${[10, 20, 30, 45, 60].map(m => `<option value="${m}" ${s.minutes === m ? 'selected' : ''}>${m} min</option>`).join('')}</select>
      ${s.profiles.lichess || s.profiles.chesscom ? `<span>·</span><label for="follow-perf">Rating</label><select id="follow-perf">${perfOptions(s.settings.perf)}</select>` : ''}
      <span>·</span><a href="#path">Your path</a><span>·</span><a href="#coach">Coach</a>
    </div>
  </div>`;
  $('#start-session', root).onclick = () => startBlock(firstTodo);
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
