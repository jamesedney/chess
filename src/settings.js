// Settings: who you are online, how the board looks, and your saved data.
import { app } from './app-context.js';
import { $, $$, esc, toast, showModal, closeModal, confirmDialog, download } from './ui.js';
import { parseState, defaults, dateKey, LEGACY_KEY } from './state.js';
import { BOARD_THEMES, PIECE_SETS, applyBoardTheme, setPieceSet, pieceUrl } from './appearance.js';
import { configure as configureFeedback, cue } from './sound.js';
import { syncRatings } from './rating-sync.js';
import { syncNow } from './queue.js';

export const VERSION = '7.0.0';
const THEME_KEY = 'rankup-theme';
/** Set by main.js: shows the browser's install prompt, when it offered one. */
export const install = { prompt: null };

export function themeChoice() {
  try {
    return localStorage.getItem(THEME_KEY) || 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(choice = themeChoice()) {
  if (choice === 'light' || choice === 'dark') document.documentElement.dataset.theme = choice;
  else delete document.documentElement.dataset.theme;
  const dark = choice === 'dark' || (choice !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  // The status bar matches the page: both tags take the chosen theme's colour.
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', dark ? '#262421' : '#f3f1ec'));
  applyBoardTheme(app.state.settings.board, dark);
}

/** Board colours, pieces, sound and haptics from the saved settings. */
export function applySettings() {
  const st = app.state.settings;
  setPieceSet(st.pieces);
  configureFeedback(st);
  applyTheme();
}

/** Swap the pieces on any board behind the dialog to the chosen set. */
function redrawPieces() {
  $$('#main img[src*="pieces/"]').forEach(img => {
    const m = img.getAttribute('src').match(/([wb])([KQRBNP])\.svg$/);
    if (m) img.src = pieceUrl(m[1], m[2].toLowerCase());
  });
}

/** Open the settings sheet. `onChange` runs when something the screens show has changed. */
export function openSettings({ onChange = () => {} } = {}) {
  const s = app.state;
  const recovery = app.recoveryKeys();
  let legacy = false;
  try {
    legacy = !!app.storage?.getItem(LEGACY_KEY);
  } catch {}
  showModal(`<h2 tabindex="-1" autofocus>Settings</h2>
    <fieldset><legend>Your games</legend>
      <label for="chesscom-name">Chess.com username</label><input id="chesscom-name" maxlength="40" spellcheck="false" autocomplete="off" autocapitalize="none" value="${esc(s.profiles.chesscom)}">
      <label for="lichess-name">Lichess username</label><input id="lichess-name" maxlength="40" spellcheck="false" autocomplete="off" autocapitalize="none" value="${esc(s.profiles.lichess)}">
      <p class="small">Public rated games only, read when the app is open. Blitz, rapid and classical games of the last two months are checked for mistakes, losses first.</p>
      <button type="button" id="sync-now" class="btn">Check for new games</button>
    </fieldset>
    <fieldset><legend>Look and sound</legend>
      <label for="appearance">Appearance</label><select id="appearance"><option value="system">Match my device</option><option value="light">Light</option><option value="dark">Dark</option></select>
      <div class="swatches" role="radiogroup" aria-label="Board colours">${Object.entries(BOARD_THEMES)
        .map(
          ([id, t]) =>
            `<button type="button" role="radio" class="swatch" data-board-theme="${id}" aria-checked="${s.settings.board === id}" aria-label="${esc(t.label)}" title="${esc(t.label)}"><span style="background:${t.light}"></span><span style="background:${t.dark}"></span><span style="background:${t.dark}"></span><span style="background:${t.light}"></span></button>`,
        )
        .join('')}</div>
      <div class="piece-sets" role="radiogroup" aria-label="Pieces">${Object.entries(PIECE_SETS)
        .map(
          ([id, p]) =>
            `<button type="button" role="radio" class="piece-set" data-piece-set="${id}" aria-checked="${s.settings.pieces === id}" aria-label="${esc(p.label)}"><img src="./pieces/${id}/wN.svg" alt=""><img src="./pieces/${id}/bQ.svg" alt=""></button>`,
        )
        .join('')}</div>
      <label class="check"><input type="checkbox" id="sound-on" ${s.settings.sound ? 'checked' : ''}> Move sounds</label>
      <label class="check"><input type="checkbox" id="haptics-on" ${s.settings.haptics ? 'checked' : ''}> Vibration</label>
    </fieldset>
    <fieldset><legend>Your data</legend>
      <p class="small" id="storage-state">${app.storageOK ? 'Progress is saved in this browser only. Export a backup before changing device or clearing browser data.' : 'This browser is not saving progress. Export a backup before you close the app.'}</p>
      <div class="actions"><button type="button" id="backup" class="btn">Export</button><button type="button" id="restore" class="btn">Import</button><input type="file" id="restore-file" accept=".json,application/json" hidden></div>
      ${legacy ? `<p class="small">Version 7 keeps far less than earlier versions did. Everything saved before the update is still here until you discard it.</p><div class="actions"><button type="button" id="legacy-download" class="btn">Download pre-7 data</button><button type="button" id="legacy-discard" class="btn">Discard it</button></div>` : ''}
      ${recovery.length ? `<p class="small">Saved data from an earlier session could not be read. A copy was kept so nothing is lost.</p><div class="actions"><button type="button" id="recovery-download" class="btn">Download unreadable data</button><button type="button" id="recovery-discard" class="btn">Discard it</button></div>` : ''}
      <button type="button" id="reset" class="btn danger">Reset all progress</button>
    </fieldset>
    ${install.prompt ? `<button type="button" id="install" class="btn wide">Install Rankup on this device</button>` : ''}
    <p class="small about">Rankup ${VERSION} · chess.js (BSD-2-Clause) · Stockfish.js 17.1 lite (GPLv3) · Maia networks (GPLv3) · Lichess puzzles (CC0). <a href="./THIRD-PARTY.md" target="_blank" rel="noopener">Licences and source</a></p>`);

  // The heading takes the focus, so a phone does not open its keyboard on the first field.
  $('#modal h2')?.focus({ preventScroll: true });
  $('#appearance').value = themeChoice();
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
          redrawPieces();
        }),
    );
  pick('board-theme', 'board');
  pick('piece-set', 'pieces');
  for (const [id, key] of [
    ['sound-on', 'sound'],
    ['haptics-on', 'haptics'],
  ])
    $('#' + id).onchange = e => {
      s.settings[key] = e.target.checked;
      app.save();
      applySettings();
      cue('move');
    };
  const saveName = (key, el) =>
    (el.onchange = () => {
      s.profiles[key] = el.value.trim();
      // A different account: forget which ratings were followed and read the new ones now.
      s.sync.followed = [];
      app.save();
      syncRatings({ force: true }).then(({ errors }) => {
        if (errors.length) toast(errors.join(' '));
        onChange();
      });
      onChange();
    });
  saveName('lichess', $('#lichess-name'));
  saveName('chesscom', $('#chesscom-name'));
  $('#sync-now').onclick = async e => {
    if (!s.profiles.lichess && !s.profiles.chesscom) return toast('Enter a Chess.com or Lichess username first.');
    e.target.disabled = true;
    const [{ added, errors }] = await Promise.all([syncNow({ force: true }), syncRatings({ force: true })]);
    e.target.disabled = false;
    toast(
      errors.length
        ? errors.join(' ')
        : added
          ? `${added} new ${added === 1 ? 'game' : 'games'} to read.`
          : 'No new games since the last check.',
    );
    onChange();
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
    app.navigate('train');
    toast('Progress restored.');
  };
  const copies = (downloadId, discardId, keys, name) => {
    $('#' + downloadId)?.addEventListener('click', () => {
      for (const k of keys) download(name(k), app.storage.getItem(k));
    });
    $('#' + discardId)?.addEventListener('click', async () => {
      if (
        !(await confirmDialog({
          title: 'Discard that data?',
          body: 'Download it first if you might want it. This cannot be undone.',
          confirm: 'Discard',
          danger: true,
        }))
      )
        return;
      for (const k of keys) app.storage.removeItem(k);
      closeModal();
    });
  };
  copies('legacy-download', 'legacy-discard', [LEGACY_KEY], () => `rankup-before-7-${dateKey()}.json`);
  copies('recovery-download', 'recovery-discard', recovery, k => `${k}.json`);
  $('#reset').onclick = async () => {
    if (
      !(await confirmDialog({
        title: 'Reset all progress?',
        body: 'Your rating history, saved positions and accounts on this device are deleted. Export a backup first if you might want them.',
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
  $('#install')?.addEventListener('click', async e => {
    await install.prompt?.prompt();
    install.prompt = null;
    e.target.remove();
  });
}
