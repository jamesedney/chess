// DOM helpers: escaping, toasts, dialogs and downloads.
import { pieceUrl } from './appearance.js';
/** @type {(sel: string, root?: ParentNode) => any} */
export const $ = (sel, root = document) => root.querySelector(sel);
/** @type {(sel: string, root?: ParentNode) => any[]} */
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const plural = (n, word, many = word + 's') => `${n} ${n === 1 ? word : many}`;

let toastTimer;

function hideToast(el) {
  el.classList.remove('show');
  el.onclick = null;
}

/**
 * While a modal dialog is open everything outside it is inert, so a toast
 * shown then would be unreadable and untappable. Each open dialog therefore
 * gets its own toast element, created once and never moved: moving a node in
 * or out of a closing modal dialog can leave Chromium treating the page as
 * inert, so taps stop working until another dialog opens.
 */
function toastElement() {
  const dialog = document.querySelector('dialog[open]');
  if (!dialog) return $('#toast');
  let el = dialog.querySelector(':scope > .toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    dialog.append(el);
  }
  return el;
}
if (typeof document !== 'undefined')
  document.addEventListener(
    'close',
    e => {
      const el = /** @type {Element} */ (e.target).querySelector?.(':scope > .toast');
      if (el) hideToast(el);
    },
    true,
  );

/**
 * Show a short status message, optionally with one action. A toast with an
 * action stays longer and the whole toast is tappable, not only its button.
 */
/**
 * A short message at the bottom of the screen. With an action, tapping it runs
 * the action; the close button always dismisses it without doing anything.
 */
export function toast(text, { action = null, duration = 4500 } = {}) {
  const el = toastElement();
  el.innerHTML = `<span>${esc(text)}</span>${action ? `<button type="button" class="primary toast-action">${esc(action.label)}</button>` : ''}<button type="button" class="toast-close" aria-label="Dismiss"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`;
  el.classList.toggle('actionable', !!action);
  el.onclick = e => {
    if (/** @type {Element} */ (e.target).closest('.toast-close')) return hideToast(el);
    if (!action) return;
    hideToast(el);
    action.onClick();
  };
  el.classList.add('show');
  clearTimeout(toastTimer);
  for (const other of $$('.toast.show')) if (other !== el) hideToast(other);
  toastTimer = setTimeout(() => hideToast(el), action ? Math.max(duration * 2, 10000) : duration);
}

/** Dismiss whatever toast is showing. */
export function dismissToast() {
  $$('.toast.show').forEach(hideToast);
}

/** Open the shared modal dialog. Returns the content element. */
export function showModal(html, { onClose = null, closable = true } = {}) {
  const dialog = $('#modal');
  $('#modal-content').innerHTML = html;
  $('#close-modal').hidden = !closable;
  dialog.oncancel = closable ? null : e => e.preventDefault();
  dialog.onclose = () => {
    dialog.onclose = null;
    onClose?.();
  };
  if (!dialog.open) dialog.showModal();
  return $('#modal-content');
}

export function closeModal() {
  if ($('#modal').open) $('#modal').close();
}

/** Promise-based confirmation that works in installed (standalone) apps. */
export function confirmDialog({ title, body = '', confirm = 'Continue', cancel = 'Cancel', danger = false }) {
  return new Promise(resolve => {
    const dialog = $('#confirm');
    dialog.innerHTML = `<h2>${esc(title)}</h2>${body ? `<p>${esc(body)}</p>` : ''}<div class="actions"><button type="button" class="${danger ? 'danger' : 'primary'}" data-answer="yes">${esc(confirm)}</button><button type="button" data-answer="no">${esc(cancel)}</button></div>`;
    let answered = false;
    const finish = value => {
      if (answered) return;
      answered = true;
      if (dialog.open) dialog.close();
      resolve(value);
    };
    dialog.querySelectorAll('[data-answer]').forEach(b => (b.onclick = () => finish(b.dataset.answer === 'yes')));
    dialog.oncancel = () => finish(false);
    dialog.onclose = () => finish(false);
    dialog.showModal();
    dialog.querySelector('[data-answer="yes"]').focus();
  });
}

export function choosePromotion(color = 'w') {
  return new Promise(resolve => {
    const dialog = $('#confirm');
    dialog.innerHTML = `<h2>Promote your pawn</h2><p>Choose the piece your pawn becomes.</p><div class="promotion">${['q', 'r', 'n', 'b']
      .map(
        p =>
          `<button type="button" data-promote="${p}" aria-label="${{ q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' }[p]}"><img src="${pieceUrl(color, p)}" alt=""></button>`,
      )
      .join('')}</div>`;
    let done = false;
    const finish = p => {
      if (done) return;
      done = true;
      if (dialog.open) dialog.close();
      resolve(p);
    };
    dialog.querySelectorAll('[data-promote]').forEach(b => (b.onclick = () => finish(b.dataset.promote)));
    dialog.oncancel = e => {
      e.preventDefault();
      finish('q');
    };
    dialog.onclose = () => finish('q');
    dialog.showModal();
  });
}

export function download(name, data, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Fade a status element in after its text changes, unless motion is reduced. */
export function settle(el) {
  if (!el || typeof el.animate !== 'function') return;
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  el.animate(
    [
      { opacity: 0.35, transform: 'translateY(3px)' },
      { opacity: 1, transform: 'none' },
    ],
    { duration: 180, easing: 'ease-out' },
  );
}

export function formatDate(key) {
  if (!key) return '';
  const d = new Date(key.length === 10 ? key + 'T12:00:00' : key);
  return isNaN(d.getTime()) ? key : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** A page heading: just the title. The eyebrow and subtitle arguments are accepted for callers but no longer shown. */
export function pageHead(eyebrow, title, sub = '', right = '') {
  return `<div class="page-head"><h1>${title}</h1>${right}</div>`;
}
