// Small UI primitives shared by every view.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
export function toast(message, ms = 2600) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ---------------------------------------------------------- bottom sheet
let sheetResolve = null;
let closeTimer = null;

export function openSheet(html, { onMount } = {}) {
  const sheet = $('#sheet');
  clearTimeout(closeTimer);        // a sheet opened straight after another closes
  $('#sheetBody').innerHTML = html;
  sheet.hidden = false;
  requestAnimationFrame(() => sheet.classList.add('open'));
  document.body.classList.add('sheet-open');
  if (onMount) onMount($('#sheetBody'));
  return $('#sheetBody');
}

export function closeSheet(value) {
  const sheet = $('#sheet');
  sheet.classList.remove('open');
  document.body.classList.remove('sheet-open');
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => { sheet.hidden = true; $('#sheetBody').innerHTML = ''; }, 220);
  if (sheetResolve) { const r = sheetResolve; sheetResolve = null; r(value); }
}

export const sheetIsOpen = () => !$('#sheet').hidden;

export function ask(title, message, { confirmText = 'OK', danger = false } = {}) {
  return new Promise(resolve => {
    sheetResolve = resolve;
    openSheet(`
      <h2>${esc(title)}</h2>
      <p class="muted">${esc(message)}</p>
      <div class="row gap end">
        <button class="btn ghost" data-sheet="cancel">Cancel</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-sheet="ok">${esc(confirmText)}</button>
      </div>`);
  });
}

export function prompt(title, { value = '', placeholder = '', confirmText = 'Save', type = 'text' } = {}) {
  return new Promise(resolve => {
    sheetResolve = resolve;
    openSheet(`
      <h2>${esc(title)}</h2>
      <input id="promptInput" class="field" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}">
      <div class="row gap end">
        <button class="btn ghost" data-sheet="cancel">Cancel</button>
        <button class="btn primary" data-sheet="prompt-ok">${esc(confirmText)}</button>
      </div>`, {
      onMount(body) {
        const input = body.querySelector('#promptInput');
        setTimeout(() => { input.focus(); input.select(); }, 60);
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter') { e.preventDefault(); closeSheet(input.value.trim() || null); }
        });
      }
    });
  });
}

// Wire the sheet's own buttons once.
export function initSheet() {
  $('#sheetBackdrop').addEventListener('click', () => closeSheet(null));
  $('#sheet').addEventListener('click', e => {
    const btn = e.target.closest('[data-sheet]');
    if (!btn) return;
    const action = btn.dataset.sheet;
    if (action === 'cancel') closeSheet(null);
    else if (action === 'ok') closeSheet(true);
    else if (action === 'prompt-ok') closeSheet($('#promptInput').value.trim() || null);
    else if (action === 'close') closeSheet(null);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && sheetIsOpen()) closeSheet(null);
  });
}

// ------------------------------------------------------------- progress
export function progressSheet(title) {
  openSheet(`
    <h2>${esc(title)}</h2>
    <p id="progressLabel" class="muted">Starting&hellip;</p>
    <div class="bar"><div id="progressFill"></div></div>`);
  return {
    update(label, ratio) {
      const l = $('#progressLabel');
      const f = $('#progressFill');
      if (l) l.textContent = label;
      if (f) f.style.width = Math.round((ratio == null ? 0 : ratio) * 100) + '%';
    },
    done() { closeSheet(null); }
  };
}

export function relTime(ts) {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  if (s < 604800) return Math.round(s / 86400) + ' d ago';
  return new Date(ts).toLocaleDateString();
}

export function debounce(fn, ms = 180) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
