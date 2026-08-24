// Shell: routing, the box list, and search across everything.
import * as db from './db.js';
import * as store from './store.js';
import * as searchLib from './search.js';
import * as photosLib from './photos.js';
import * as od from './onedrive.js';
import * as sync from './sync.js';
import * as boxView from './box-view.js';
import * as views from './views.js';
import { $, $$, esc, toast, initSheet, debounce, relTime, prompt } from './ui.js';

const state = {
  boxes: [],
  locations: [],
  photoCounts: {},
  thumbs: {},          // boxId -> first photo, for the list
  query: '',
  placeFilter: null
};

// ------------------------------------------------------------- data
async function reload() {
  const [boxes, locations, photos] = await Promise.all([
    store.allBoxes(), store.allLocations(), store.allPhotos()
  ]);
  state.boxes = boxes;
  state.locations = locations;
  state.photoCounts = {};
  state.thumbs = {};
  for (const p of photos) {
    state.photoCounts[p.boxId] = (state.photoCounts[p.boxId] || 0) + 1;
    if (!state.thumbs[p.boxId] || p.createdAt < state.thumbs[p.boxId].createdAt) {
      state.thumbs[p.boxId] = p;
    }
  }
  searchLib.build(boxes, locations);
}

const locName = (id) => {
  const l = state.locations.find(x => x.id === id);
  return l ? l.name : '';
};

// ------------------------------------------------------------ routing
function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '') || 'boxes';
  const [path, qs] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  // Anything unrecognised (an old bookmark, a stale home-screen shortcut)
  // lands on the box list rather than a blank screen.
  const name = VIEWS.has(parts[0]) ? parts[0] : 'boxes';
  return { name, arg: parts[1] || null, params: new URLSearchParams(qs || '') };
}

const VIEWS = new Set(['boxes', 'box', 'locations', 'settings']);

async function route() {
  const { name, arg, params } = parseRoute();
  const view = $('#view');
  const back = $('#backBtn');

  $$('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === name));
  document.body.dataset.route = name;
  back.hidden = name !== 'box';
  $('#fab').hidden = !(name === 'boxes' || name === 'locations');

  if (state.query && name !== 'box') {
    $('#title').textContent = 'Search';
    return renderSearch(view);
  }

  switch (name) {
    case 'box': {
      $('#title').textContent = 'Box';
      const box = await boxView.render(view, arg, { onChange: onDataChanged });
      if (box) $('#title').textContent = 'Box ' + box.number;
      break;
    }
    case 'locations':
      $('#title').textContent = 'Places';
      await views.renderLocations(view, { onChange: onDataChanged });
      break;
    case 'settings':
      $('#title').textContent = 'Settings';
      await views.renderSettings(view, { onChange: onDataChanged });
      break;
    default:
      state.placeFilter = params.has('place') ? params.get('place') : null;
      $('#title').textContent = 'Shed Tracker';
      renderBoxes(view);
  }
  view.scrollTop = 0;
}

async function onDataChanged() {
  await reload();
  updateSyncBadge();
}

// -------------------------------------------------------- boxes list
function renderBoxes(container) {
  let boxes = state.boxes;
  let heading = '';

  if (state.placeFilter !== null) {
    boxes = boxes.filter(b => (b.locationId || '') === state.placeFilter);
    heading = state.placeFilter
      ? `<p class="lede">Boxes in <strong>${esc(locName(state.placeFilter))}</strong> &middot;
         <a href="#/boxes">show all</a></p>`
      : '<p class="lede">Boxes with no place yet &middot; <a href="#/boxes">show all</a></p>';
  }

  if (!state.boxes.length) {
    container.innerHTML = `
      <div class="welcome">
        <div class="sticker big">1</div>
        <h2>Start with box 1</h2>
        <p>Number the tub with a black marker on a yellow sticker, then add it here.
           Photograph what goes in as you pack, list what matters, and note which
           container it ends up in.</p>
        <button class="btn primary" data-action="new-box">Add box 1</button>
      </div>`;
    container.onclick = (e) => { if (e.target.closest('[data-action=new-box]')) newBox(); };
    return;
  }

  container.innerHTML = heading + `
    <ul class="list boxes">
      ${boxes.map(b => boxCard(b)).join('') || '<li class="empty">Nothing here yet.</li>'}
    </ul>
    <p class="muted small center">${state.boxes.length} box(es) &middot;
      ${state.boxes.reduce((n, b) => n + b.items.length, 0)} items listed</p>`;

  container.onclick = (e) => {
    const card = e.target.closest('[data-box]');
    if (card) location.hash = '#/box/' + card.dataset.box;
  };
}

function boxCard(b, extraHtml = '') {
  const thumb = state.thumbs[b.id];
  const place = locName(b.locationId);
  const count = state.photoCounts[b.id] || 0;
  return `
    <li class="row-item box-card" data-box="${b.id}">
      <div class="sticker">${b.number}</div>
      <div class="grow">
        <strong>${esc(b.name || 'Box ' + b.number)}</strong>
        <div class="muted small">
          ${place ? esc(place) : '<em>no place yet</em>'}${b.position ? ' &middot; ' + esc(b.position) : ''}
        </div>
        <div class="muted small">${b.items.length} item(s)${count ? ' &middot; ' + count + ' photo(s)' : ''}
          &middot; <span class="status-dot ${b.status}"></span>${b.status}</div>
        ${extraHtml}
      </div>
      ${thumb ? `<img class="mini" src="${photosLib.objectUrl(thumb.thumb || thumb.blob, 'th_' + thumb.id)}" alt="">` : ''}
    </li>`;
}

// ------------------------------------------------------------ search
function renderSearch(container) {
  const q = state.query;
  const results = searchLib.search(q);

  if (!results.length) {
    container.innerHTML = `
      <p class="empty">Nothing matches &ldquo;${esc(q)}&rdquo;.</p>
      <p class="muted small center">Search looks through box numbers, names, contents,
        tags, notes, scanned text and places.</p>`;
    return;
  }

  container.innerHTML = `
    <p class="lede">${results.length} box(es) match &ldquo;${esc(q)}&rdquo;</p>
    <ul class="list boxes">
      ${results.map(r => {
        const hits = searchLib.matchingItems(r.box, q).slice(0, 4);
        const found = hits.length
          ? `<div class="found">${hits.map(i => searchLib.highlight(i.text, q)).join(' &middot; ')}</div>`
          : '';
        const where = r.loc
          ? `<div class="where">&#9873; ${esc(r.loc.name)}${r.box.position ? ' &middot; ' + esc(r.box.position) : ''}</div>`
          : '<div class="where muted">not stored anywhere yet</div>';
        return boxCard(r.box, found + where);
      }).join('')}
    </ul>`;

  container.onclick = (e) => {
    const card = e.target.closest('[data-box]');
    if (card) location.hash = '#/box/' + card.dataset.box;
  };
}

// ------------------------------------------------------------ actions
async function newBox() {
  const suggested = await store.nextNumber();
  const answer = await prompt('New box number', {
    value: String(suggested),
    type: 'number',
    confirmText: 'Create'
  });
  if (!answer) return;

  const number = parseInt(answer, 10);
  if (!Number.isFinite(number) || number < 1) return toast('That is not a box number');

  const existing = await store.findByNumber(number);
  if (existing) { location.hash = '#/box/' + existing.id; return toast('Box ' + number + ' already exists'); }

  const box = store.newBox(number);
  // Most tubs get packed in the same place as the last one; carry it over.
  const last = state.boxes[state.boxes.length - 1];
  if (last && last.locationId) box.locationId = last.locationId;

  await store.saveBox(box);
  await onDataChanged();
  location.hash = '#/box/' + box.id;
}

async function updateSyncBadge() {
  const st = await sync.status();
  const btn = $('#syncBtn');
  btn.classList.toggle('pending', st.signedIn && st.pending > 0);
  btn.classList.toggle('off', !st.signedIn);
  btn.title = st.signedIn
    ? (st.pending ? st.pending + ' photo(s) waiting · last sync ' + relTime(st.lastSync)
                  : 'Backed up ' + relTime(st.lastSync))
    : 'OneDrive not connected';
}

async function quickSync() {
  const st = await sync.status();
  if (!st.signedIn) { location.hash = '#/settings'; return toast('Connect OneDrive first'); }
  if (sync.isRunning()) return toast('Already syncing');

  const btn = $('#syncBtn');
  btn.classList.add('spinning');
  try {
    const r = await sync.push(({ phase, done, total }) => {
      btn.title = phase === 'photos' ? `Uploading ${done}/${total}` : 'Writing index';
    });
    toast(`Backed up · ${r.uploaded} photo(s)` + (r.failed ? `, ${r.failed} failed` : ''));
  } catch (e) {
    toast(e.message);
  } finally {
    btn.classList.remove('spinning');
    updateSyncBadge();
  }
}

// -------------------------------------------------------------- boot
function wireChrome() {
  const q = $('#q');
  const clear = $('#clearQ');

  const runSearch = debounce(() => {
    state.query = q.value.trim();
    clear.hidden = !state.query;
    if (state.query && parseRoute().name === 'box') location.hash = '#/boxes';
    else route();
  }, 160);

  q.addEventListener('input', runSearch);
  q.addEventListener('search', runSearch);
  clear.addEventListener('click', () => { q.value = ''; state.query = ''; clear.hidden = true; route(); });

  $('#backBtn').addEventListener('click', () => history.back());
  $('#syncBtn').addEventListener('click', quickSync);

  $('#fab').addEventListener('click', () => {
    if (parseRoute().name === 'locations') views.newLocationFlow(async () => { await onDataChanged(); route(); });
    else newBox();
  });

  window.addEventListener('hashchange', route);
  window.addEventListener('online', updateSyncBadge);
}

async function boot() {
  initSheet();
  wireChrome();
  db.persist();

  try {
    const account = await od.handleRedirect();
    if (account) toast('Connected to OneDrive as ' + (account.name || account.email));
  } catch (e) {
    toast('OneDrive sign-in failed: ' + e.message);
  }

  await reload();
  await route();
  updateSyncBadge();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
  }
}

boot();
