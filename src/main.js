// Entry point: routing, settings, theme, offline support and install prompt.
import { app } from './app-context.js';
import { $, $$, esc, toast, showModal, closeModal, confirmDialog, download } from './ui.js';
import { parseState, defaults, dateKey, RECOVERY_PREFIX } from './state.js';
import { STAGES } from './themes.js';
import { BOARD_THEMES, PIECE_SETS, applyBoardTheme, setPieceSet, pieceUrl } from './appearance.js';
import { configure as configureFeedback, cue } from './sound.js';
import * as train from './pages/train.js';
import * as path from './pages/path.js';
import * as play from './pages/play.js';
import * as review from './pages/review.js';
import * as progress from './pages/progress.js';
import * as drills from './pages/drills.js';
import * as coach from './pages/coach.js';
import * as today from './pages/today.js';
import { activeBlock, continueSession, pauseSession, checkSession, todaysSession, sessionProgress, onSessionChange } from './session.js';
import { blockDone } from './program.js';
import { refreshMastery } from './curriculum.js';
import { syncRatings } from './rating-sync.js';
import { RATING_PERFS } from './ratings.js';
import { goalStatus, PUZZLE_PERF } from './progress-model.js';
import { scheduleDeepAnalysis } from './deep.js';
import { startAutoSync, syncNow } from './queue.js';
import { CONTROLS } from './sync.js';

export const VERSION = '3.0.4';
const PAGES = { today, train, coach, path, play, review, progress, drills };
// Pages without their own tab light up the tab they belong to.
const NAV_AS = { train: 'today', drills: 'today', coach: 'progress' };
// Parameters that are part of a page's address, so reloads and the back button return to them.
const ADDRESS_KEYS = ['lesson', 'drill', 'id'];
const THEME_KEY = 'rankup-theme';
let pendingParams = null;

function currentPage() {
  const name = location.hash.replace(/^#/, '').split('?')[0];
  return PAGES[name] ? name : 'today';
}

function show(name, params = {}) {
  if (app.page && app.page !== name) PAGES[app.page].leave?.();
  app.page = name;
  const nav = NAV_AS[name] || name;
  $$('[data-page]').forEach(a => {
    const active = a.dataset.page === nav;
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const main = $('#main');
  PAGES[name].render(main, params);
  // Animate the freshly rendered page, never <main> itself: an animation on the
  // long-lived container that is interrupted by a re-render (Today refreshing
  // as a reviewed game joins the plan) can leave Chromium hit-testing stale
  // geometry, so taps on the page stop working.
  const page = main.firstElementChild;
  if (page && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    page.animate(
      [
        { opacity: 0, transform: 'translateY(6px)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 170, easing: 'ease-out' },
    );
  }
  updateSidebar();
  updateSessionBar();
  main.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'instant' });
}

app.navigate = (name, params = {}) => {
  closeModal(); // moving to a page always leaves any open dialog behind
  pendingParams = params;
  const query = new URLSearchParams(ADDRESS_KEYS.filter(k => params[k]).map(k => [k, params[k]])).toString();
  const target = name + (query ? '?' + query : '');
  if (location.hash === '#' + target) {
    pendingParams = null;
    show(name, params);
  } else location.hash = target;
};

/** Parameters written into the address, e.g. #train?puzzle=p001 or #train?theme=Tactics. */
function hashParams() {
  const q = location.hash.split('?')[1];
  if (!q) return {};
  const out = {};
  for (const [k, v] of new URLSearchParams(q))
    if (['puzzle', 'theme', 'mode', 'review', 'tags', 'strict', 'limit', 'unit', 'rating', 'due', ...ADDRESS_KEYS].includes(k)) out[k] = v;
  if (out.theme && !out.mode) out.mode = 'daily';
  return out;
}

window.addEventListener('hashchange', () => {
  const params = pendingParams || hashParams();
  pendingParams = null;
  show(currentPage(), params);
});

function updateSidebar() {
  const s = app.state;
  const g = goalStatus(s);
  const bar = $('#goal-bar');
  const text = $('#goal-text');
  if (!g) {
    if (bar) bar.style.width = '0%';
    if (text) text.textContent = '';
    return;
  }
  const span = Math.max(1, s.target.target - s.target.start.rating);
  if (bar) bar.style.width = Math.max(2, Math.min(100, ((g.current - s.target.start.rating) / span) * 100)) + '%';
  if (text) text.textContent = `${s.target.perf === PUZZLE_PERF ? 'Rankup rating' : s.target.perf} ${g.current} → ${s.target.target}`;
}

/** The slim bar that follows you through today's session on every page. */
function updateSessionBar() {
  const el = $('#session-bar');
  if (!el) return;
  const block = activeBlock();
  if (!block || app.page === 'today') {
    el.hidden = true;
    return;
  }
  const s = app.state.session;
  const i = s.blocks.indexOf(block);
  const done = !!block.complete || blockDone(app.state, block);
  const last = !s.blocks.some((b, k) => k !== i && b.status === 'todo');
  el.hidden = false;
  el.style.setProperty(
    '--pct',
    String(Math.round((s.blocks.filter(b => b.status === 'done' || b.status === 'skipped' || b.complete).length / s.blocks.length) * 100)),
  );
  el.innerHTML = `<span class="session-step small">${i + 1} of ${s.blocks.length}</span>
    <strong class="session-title">${esc(block.title)}</strong>
    <button type="button" id="session-next" class="${done ? 'primary' : 'secondary'}">${done ? (last ? 'Finish ✓' : 'Next ›') : 'Skip'}</button>
    <button type="button" id="session-pause" class="icon-button" aria-label="Back to Today">✕</button>`;
  el.classList.toggle('done', done);
  $('#session-next', el).onclick = continueSession;
  $('#session-pause', el).onclick = pauseSession;
}

// Every save may finish a session block: check, then refresh the bar.
{
  const rawSave = app.save.bind(app);
  let checking = false;
  app.save = () => {
    rawSave();
    if (checking) return;
    checking = true;
    try {
      // Lessons and drills finished anywhere count towards the curriculum.
      const mastered = refreshMastery(app.state, dateKey());
      if (mastered.length) {
        rawSave();
        toast(`Unit mastered: ${mastered.map(u => u.title).join(', ')}.`);
      }
      checkSession();
    } finally {
      checking = false;
    }
    updateSessionBar();
    updateSidebar();
  };
}

// ---------- Theme ----------

function applyTheme(choice) {
  if (choice === 'light' || choice === 'dark') document.documentElement.dataset.theme = choice;
  else delete document.documentElement.dataset.theme;
  const dark = choice === 'dark' || (choice !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1a1512' : '#a6521f');
  applyBoardTheme(app.state.settings.board, dark);
}

/** Board colours, pieces, sound and haptics from the saved settings. */
function applySettings() {
  const st = app.state.settings;
  setPieceSet(st.pieces);
  configureFeedback(st);
  applyTheme(themeChoice());
}

function themeChoice() {
  try {
    return localStorage.getItem(THEME_KEY) || 'system';
  } catch {
    return 'system';
  }
}

// ---------- Settings ----------

function openSettings() {
  const s = app.state;
  const recovery = app.recoveryKeys();
  showModal(`<h2>Your training setup</h2>
    <div class="field"><label for="session-goal">Positions per session</label><select id="session-goal"><option value="4">4 · quick focus</option><option value="8">8 · daily session</option><option value="12">12 · deep practice</option></select></div>
    <div class="field"><label for="difficulty-offset">Puzzle difficulty</label><select id="difficulty-offset"><option value="-200">Easier than my rating</option><option value="0">Matched to my rating</option><option value="200">Harder than my rating</option></select></div>
    ${
      s.puzzle.count < 10
        ? `<div class="field"><label for="start-level">Starting level</label><select id="start-level">${STAGES.map(st => `<option value="${st.rating}">${st.label} · ${st.rating}</option>`).join('')}</select><small>Sets your starting puzzle rating. After ten rated puzzles your results take over.</small></div>`
        : ''
    }
    <div class="field"><label for="appearance">Appearance</label><select id="appearance"><option value="system">Match my device</option><option value="light">Light</option><option value="dark">Dark</option></select></div>
    <fieldset class="field"><legend>Board</legend>
      <div class="swatches" role="radiogroup" aria-label="Board colours">${Object.entries(BOARD_THEMES)
        .map(
          ([id, t]) =>
            `<button type="button" role="radio" class="swatch" data-board-theme="${id}" aria-checked="${s.settings.board === id}" aria-label="${esc(t.label)}" title="${esc(t.label)}"><span style="background:${t.light}"></span><span style="background:${t.dark}"></span><span style="background:${t.dark}"></span><span style="background:${t.light}"></span></button>`,
        )
        .join('')}</div>
      <div class="piece-sets" role="radiogroup" aria-label="Pieces">${Object.entries(PIECE_SETS)
        .map(
          ([id, p]) =>
            `<button type="button" role="radio" class="piece-set" data-piece-set="${id}" aria-checked="${s.settings.pieces === id}"><img src="./pieces/${id}/wN.svg" alt=""><img src="./pieces/${id}/bQ.svg" alt=""><span>${esc(p.label)}</span></button>`,
        )
        .join('')}</div>
    </fieldset>
    <div class="checks"><label><input type="checkbox" id="sound-on" ${s.settings.sound ? 'checked' : ''}> Move sounds</label><label><input type="checkbox" id="haptics-on" ${s.settings.haptics ? 'checked' : ''}> Vibration on supported phones</label></div>
    <fieldset class="field"><legend>Your online games</legend>
      <label for="lichess-name">Lichess username</label><input id="lichess-name" maxlength="40" spellcheck="false" autocomplete="off" value="${esc(s.profiles.lichess)}">
      <label for="chesscom-name">Chess.com username</label><input id="chesscom-name" maxlength="40" spellcheck="false" autocomplete="off" value="${esc(s.profiles.chesscom)}">
      <label for="settings-perf">Rating your goal follows</label><select id="settings-perf">${['auto', ...RATING_PERFS].map(p => `<option value="${p}" ${s.settings.perf === p ? 'selected' : ''}>${p === 'auto' ? 'Auto: the one you play most' : p[0].toUpperCase() + p.slice(1)}</option>`).join('')}</select>
      <div class="checks">
        <label><input type="checkbox" id="sync-auto" ${s.sync.auto ? 'checked' : ''}> Import and review my new games automatically</label>
        <label><input type="checkbox" id="sync-rated" ${s.sync.ratedOnly ? 'checked' : ''}> Rated games only</label>
      </div>
      <div class="pill-row small" role="group" aria-label="Time controls to import">${CONTROLS.map(c => `<button type="button" data-control="${c}" class="${s.sync.controls.includes(c) ? 'active' : ''}" aria-pressed="${s.sync.controls.includes(c)}">${c[0].toUpperCase() + c.slice(1)}</button>`).join('')}</div>
      <label for="sync-cap">Games per day, at most</label><select id="sync-cap">${[2, 5, 10, 20].map(n => `<option value="${n}" ${s.sync.dailyCap === n ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <small>Public games only, fetched when the app is open. Games with Lichess analysis review almost instantly; others take Stockfish a minute or two each, in the background.</small>
      <div class="actions"><button type="button" id="sync-now">Check for new games now</button></div>
    </fieldset>
    <div class="checks"><label><input type="checkbox" id="auto-level" ${s.settings.autoLevel ? 'checked' : ''}> Adjust the practice opponent to my results</label></div>
    <h3>Backup</h3>
    <p class="small">Progress is saved in this browser only. Export a backup before changing device or clearing browser data.</p>
    <div class="actions"><button type="button" id="backup">Export progress</button><button type="button" id="restore">Import backup</button><input type="file" id="restore-file" accept=".json,application/json" hidden></div>
    ${recovery.length ? `<div class="status error"><p>Saved data from an earlier session could not be read. A copy was kept so nothing is lost.</p><div class="actions"><button type="button" id="recovery-download">Download unreadable data</button><button type="button" id="recovery-discard">Discard it</button></div></div>` : ''}
    <p id="storage-state" class="small">${app.storageOK ? 'Local storage available.' : 'Local storage unavailable. Progress will not survive a reload; keep a backup.'}</p>
    <div class="actions"><button type="button" id="reset" class="danger">Reset all progress</button></div>
    <hr>
    <p class="small">Rankup ${VERSION} · chess.js (BSD-2-Clause) · Stockfish.js 17.1 lite (GPLv3) · Maia networks (GPLv3) · Lichess puzzles and openings (CC0). <a href="./THIRD-PARTY.md" target="_blank" rel="noopener">Licences and source</a></p>
    <p class="small">Install: on Android, use the browser’s “Install app” or “Add to Home screen”. On iPhone, open in Safari and use Share → Add to Home Screen. The first online visit downloads about 10 MB for offline training. Each human-like opponent level adds about 1.7 MB the first time you play it.</p>`);
  $('#session-goal').value = s.goal;
  $('#difficulty-offset').value = s.difficulty;
  $('#appearance').value = themeChoice();
  if ($('#start-level')) {
    const closest = STAGES.reduce((a, b) => (Math.abs(b.rating - s.puzzle.rating) < Math.abs(a.rating - s.puzzle.rating) ? b : a));
    $('#start-level').value = closest.rating;
    $('#start-level').onchange = e => {
      s.puzzle.rating = Number(e.target.value);
      app.save();
      updateSidebar();
    };
  }
  $('#session-goal').onchange = e => {
    s.goal = Number(e.target.value);
    app.save();
  };
  $('#difficulty-offset').onchange = e => {
    s.difficulty = Number(e.target.value);
    app.save();
  };
  $('#appearance').onchange = e => {
    try {
      if (e.target.value === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, e.target.value);
    } catch {}
    applyTheme(e.target.value);
  };
  const pick = (attr, key) =>
    $$(`#modal [data-${attr}]`).forEach(
      b =>
        (b.onclick = () => {
          s.settings[key] = b.dataset[attr.replace(/-(.)/g, (_, c) => c.toUpperCase())];
          app.save();
          applySettings();
          $$(`#modal [data-${attr}]`).forEach(x => x.setAttribute('aria-checked', String(x === b)));
          redrawBehindModal();
        }),
    );
  pick('board-theme', 'board');
  pick('piece-set', 'pieces');
  $('#sound-on').onchange = e => {
    s.settings.sound = e.target.checked;
    app.save();
    applySettings();
    cue('move');
  };
  $('#haptics-on').onchange = e => {
    s.settings.haptics = e.target.checked;
    app.save();
    applySettings();
    cue('move');
  };
  const saveName = (key, el) =>
    (el.onchange = () => {
      s.profiles[key] = el.value.trim();
      app.save();
    });
  saveName('lichess', $('#lichess-name'));
  saveName('chesscom', $('#chesscom-name'));
  $('#sync-auto').onchange = e => {
    s.sync.auto = e.target.checked;
    app.save();
  };
  $('#sync-rated').onchange = e => {
    s.sync.ratedOnly = e.target.checked;
    app.save();
  };
  $('#sync-cap').onchange = e => {
    s.sync.dailyCap = Number(e.target.value);
    app.save();
  };
  $('#settings-perf').onchange = e => today.followPerf(e.target.value);
  $('#auto-level').onchange = e => {
    s.settings.autoLevel = e.target.checked;
    app.save();
  };
  $$('#modal [data-control]').forEach(
    b =>
      (b.onclick = () => {
        const c = b.dataset.control;
        const on = !s.sync.controls.includes(c);
        s.sync.controls = on ? [...s.sync.controls, c] : s.sync.controls.filter(x => x !== c);
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
        app.save();
      }),
  );
  $('#sync-now').onclick = async e => {
    e.target.disabled = true;
    const names = [s.profiles.lichess, s.profiles.chesscom].filter(Boolean);
    if (!names.length) {
      e.target.disabled = false;
      return toast('Enter a Lichess or Chess.com username first.');
    }
    const { added, errors } = await syncNow({ force: true });
    e.target.disabled = false;
    toast(
      errors.length
        ? errors.join(' ')
        : added
          ? `${added} new ${added === 1 ? 'game' : 'games'} queued for review.`
          : 'No new games since the last check.',
    );
  };
  $('#backup').onclick = () => download(`rankup-progress-${dateKey()}.json`, JSON.stringify(s, null, 1));
  $('#restore').onclick = () => $('#restore-file').click();
  $('#restore-file').onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    let restored;
    try {
      if (f.size > 8e6) throw new Error('too big');
      restored = parseState(await f.text());
    } catch {
      return toast('That file is not a valid Rankup backup.');
    }
    if (
      !(await confirmDialog({
        title: 'Replace this device’s progress?',
        body: 'Your current progress here will be overwritten by the backup.',
        confirm: 'Restore backup',
      }))
    )
      return;
    app.state = restored;
    app.save();
    applySettings();
    closeModal();
    show(currentPage());
    toast('Progress restored.');
  };
  $('#recovery-download')?.addEventListener('click', () => {
    for (const k of recovery) download(`${k}.json`, app.storage.getItem(k));
  });
  $('#recovery-discard')?.addEventListener('click', async () => {
    if (
      !(await confirmDialog({
        title: 'Discard the unreadable data?',
        body: 'Download it first if you might want to recover it.',
        confirm: 'Discard',
        danger: true,
      }))
    )
      return;
    for (const k of recovery) app.storage.removeItem(k);
    closeModal();
  });
  $('#reset').onclick = async () => {
    if (
      !(await confirmDialog({
        title: 'Reset all progress?',
        body: 'Ratings, history, mistakes and reviews on this device are deleted. Export a backup first if you might want them.',
        confirm: 'Reset everything',
        danger: true,
      }))
    )
      return;
    app.state = defaults();
    app.save();
    applySettings();
    closeModal();
    app.navigate('train');
    toast('Progress reset.');
  };
}

/** Swap the pieces on any board behind the settings dialog to the chosen set. */
function redrawBehindModal() {
  $$('#main img[src*="pieces/"]').forEach(img => {
    const m = img.getAttribute('src').match(/([wb])([KQRBNP])\.svg$/);
    if (m) img.src = pieceUrl(m[1], m[2].toLowerCase());
  });
}

// ---------- Offline support and install ----------

function setNetworkLabel(text) {
  const el = $('#offline');
  if (el) el.textContent = text;
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return setNetworkLabel('Offline mode unavailable in this browser');
  const hadController = !!navigator.serviceWorker.controller;
  const offer = worker =>
    toast('A new version of Rankup is ready.', {
      action: { label: 'Update now', onClick: () => worker.postMessage({ type: 'SKIP_WAITING' }) },
    });
  navigator.serviceWorker
    .register('./sw.js')
    .then(reg => {
      if (reg.waiting && hadController) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
        });
      });
      return navigator.serviceWorker.ready;
    })
    .then(() => setNetworkLabel(navigator.onLine ? 'Offline training ready' : 'Offline mode'))
    .catch(() => setNetworkLabel('Offline setup unavailable'));
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
}

function boot() {
  applySettings();
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme(themeChoice()));
  $('#settings').onclick = openSettings;
  app.openSettings = openSettings;
  $('#close-modal').onclick = closeModal;
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    installPrompt = e;
    $('#install').hidden = false;
  });
  $('#install').onclick = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    installPrompt = null;
    $('#install').hidden = true;
  };
  window.addEventListener('offline', () => setNetworkLabel('Offline mode'));
  window.addEventListener('online', () => setNetworkLabel(''));
  registerServiceWorker();
  show(currentPage(), hashParams());
  // Re-check reviewed mistakes with a deeper search once the app has settled.
  scheduleDeepAnalysis(15000);
  startAutoSync();
  // Ratings follow the linked accounts, so the goal tracks itself.
  setTimeout(() => syncRatings().then(r => r.changed && today.refresh()), 3000);
  // A game reviewed in the background can add to today's plan while it is on screen.
  onSessionChange(() => app.page === 'today' && today.refresh());
  if (app.recovered) toast('Saved progress could not be read, so a copy was kept. See Settings to download it.', { duration: 9000 });
  else if (!app.storageOK) toast('This browser is not saving progress (private mode?). Export a backup in Settings.');
}

boot();
