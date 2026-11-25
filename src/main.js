// Entry point: the three screens, the theme, offline support and the
// background work that reads your games.
import { app } from './app-context.js';
import { $, $$, toast, closeModal } from './ui.js';
import * as train from './pages/train.js';
import * as play from './pages/play.js';
import * as you from './pages/you.js';
import { VERSION, applySettings, applyTheme, install } from './settings.js';
import { startRatingSync, onRatingsChange } from './rating-sync.js';
import { scheduleDeepAnalysis } from './deep.js';
import { startAutoSync } from './queue.js';

export { VERSION };
const PAGES = { train, play, you };
// Addresses from before 7.0 still open the app on the nearest screen.
const OLD = { progress: 'you', coach: 'you' };
let pendingParams = null;

function currentPage() {
  const name = location.hash.replace(/^#/, '').split('?')[0];
  return PAGES[name] ? name : OLD[name] || 'train';
}

function show(name, params = {}) {
  if (app.page && app.page !== name) PAGES[app.page].leave?.();
  app.page = name;
  $$('[data-page]').forEach(a => {
    const active = a.dataset.page === name;
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const main = $('#main');
  PAGES[name].render(main, params);
  main.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'instant' });
}

app.navigate = (name, params = {}) => {
  closeModal(); // moving to a screen always leaves any open dialog behind
  if (location.hash === '#' + name) show(name, params);
  else {
    pendingParams = params;
    location.hash = name;
  }
};

window.addEventListener('hashchange', () => {
  const params = pendingParams || {};
  pendingParams = null;
  show(currentPage(), params);
});

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
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
    })
    .catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
}

function boot() {
  applySettings();
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme());
  $('#close-modal').onclick = closeModal;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    install.prompt = e;
  });
  registerServiceWorker();
  show(currentPage());
  // Your games are read, and saved positions double-checked, while the app is open.
  startAutoSync();
  startRatingSync();
  scheduleDeepAnalysis(15000);
  onRatingsChange(() => you.refresh());
  if (app.restored) toast('Your progress is back. An update had set it aside by mistake.', { duration: 9000 });
  else if (app.recovered) toast('Saved progress could not be read, so a copy was kept. See Settings to download it.', { duration: 9000 });
  else if (!app.storageOK) toast('This browser is not saving progress (private mode?). Export a backup in Settings.');
}

boot();
