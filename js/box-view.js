// The screen you spend the whole move in: one tub, its photos and its contents.
import * as store from './store.js';
import * as photosLib from './photos.js';
import * as vision from './vision.js';
import * as voice from './voice.js';
import * as search from './search.js';
import { $, $$, esc, toast, openSheet, closeSheet, ask, progressSheet } from './ui.js';

let box = null;
let photos = [];
let locations = [];
let onChange = () => {};

export async function render(container, boxId, opts = {}) {
  onChange = opts.onChange || (() => {});
  box = await store.getBox(boxId);
  if (!box) { container.innerHTML = '<p class="empty">That box no longer exists.</p>'; return null; }
  [photos, locations] = await Promise.all([store.photosFor(boxId), store.allLocations()]);
  photos.sort((a, b) => a.createdAt - b.createdAt);
  paint(container);
  return box;
}

function paint(container) {
  const loc = locations.find(l => l.id === box.locationId);

  container.innerHTML = `
  <div class="box-detail">
    <div class="box-head">
      <div class="sticker big">${box.number}</div>
      <input class="field flush name" data-field="name" value="${esc(box.name)}"
             placeholder="Name this box (optional)" maxlength="60">
    </div>

    <section class="card">
      <h3>Where is it?</h3>
      <div class="row gap">
        <select class="field" data-field="locationId">
          <option value="">&mdash; not stored yet &mdash;</option>
          ${locations.map(l => `
            <option value="${l.id}" ${l.id === box.locationId ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}
        </select>
        <button class="btn ghost small" data-action="new-location">New</button>
      </div>
      <input class="field" data-field="position" value="${esc(box.position || '')}"
             placeholder="Where in there? e.g. back wall, stack 3, second from top">
      ${loc ? `<p class="muted small">Currently in <strong>${esc(loc.name)}</strong>${box.position ? ' &middot; ' + esc(box.position) : ''}</p>` : ''}
    </section>

    <section class="card">
      <div class="row between">
        <h3>Photos <span class="count">${photos.length}</span></h3>
        <div class="row gap">
          <button class="btn small" data-action="take-photo">Camera</button>
          <button class="btn ghost small" data-action="pick-photo">Gallery</button>
        </div>
      </div>
      <div class="photo-strip">
        ${photos.map(p => `
          <button class="thumb ${p.scanned ? 'scanned' : ''}" data-photo="${p.id}">
            <img src="${photosLib.objectUrl(p.thumb || p.blob, 'th_' + p.id)}" alt="">
            ${p.uploadedAt ? '<span class="badge up" title="Backed up">&#10003;</span>' : ''}
          </button>`).join('') || '<p class="empty small">No photos yet. Snap the tub before you put the lid on.</p>'}
      </div>
      ${photos.some(p => !p.scanned) ? `
        <button class="btn wide" data-action="scan">
          Scan ${photos.filter(p => !p.scanned).length} photo(s) for keywords
        </button>` : (photos.length ? '<p class="muted small">All photos scanned.</p>' : '')}
    </section>

    <section class="card">
      <div class="row between">
        <h3>Contents <span class="count">${box.items.length}</span></h3>
        ${voice.supported() ? '<button class="btn small" data-action="dictate">Dictate</button>' : ''}
      </div>
      <form class="row gap" data-action="add-item-form">
        <input class="field" id="itemInput" placeholder="Add an item&hellip;" autocomplete="off" enterkeyhint="done">
        <button class="btn primary small" type="submit">Add</button>
      </form>
      <ul class="items">
        ${box.items.map(i => `
          <li>
            <span class="src ${esc(i.source)}" title="${esc(sourceLabel(i.source))}"></span>
            <span class="txt">${esc(i.text)}</span>
            <button class="icon-btn tiny" data-remove-item="${i.id}" aria-label="Remove">&times;</button>
          </li>`).join('') || '<li class="empty small">Nothing listed yet.</li>'}
      </ul>
    </section>

    <section class="card">
      <h3>Tags</h3>
      <div class="chips">
        ${(box.tags || []).map(t => `
          <button class="chip tag" data-remove-tag="${esc(t)}">${esc(t)} <span>&times;</span></button>`).join('')}
        <button class="chip add" data-action="add-tag">+ tag</button>
      </div>
    </section>

    <section class="card">
      <h3>Notes</h3>
      <textarea class="field" data-field="notes" rows="3"
        placeholder="Anything you will want to know later&hellip;">${esc(box.notes || '')}</textarea>
    </section>

    ${box.ocrText ? `
    <details class="card">
      <summary>Text scanned out of photos</summary>
      <pre class="ocr">${esc(box.ocrText)}</pre>
    </details>` : ''}

    <button class="btn danger wide" data-action="delete-box">Delete box ${box.number}</button>
  </div>`;

  bind(container);
}

const sourceLabel = (s) => ({
  manual: 'Typed', voice: 'Dictated', ocr: 'Read from a photo', label: 'Recognised in a photo'
}[s] || 'Added');

function bind(container) {
  container.addEventListener('input', async (e) => {
    const field = e.target.dataset.field;
    if (!field) return;
    box[field] = field === 'locationId' ? (e.target.value || null) : e.target.value;
    await save({ repaint: false });
  });

  container.addEventListener('change', async (e) => {
    if (e.target.dataset.field === 'locationId') {
      box.locationId = e.target.value || null;
      await save();
    }
  });

  container.addEventListener('click', async (e) => {
    const t = e.target;

    const rm = t.closest('[data-remove-item]');
    if (rm) { store.removeItem(box, rm.dataset.removeItem); return save(); }

    const rmTag = t.closest('[data-remove-tag]');
    if (rmTag) { box.tags = box.tags.filter(x => x !== rmTag.dataset.removeTag); return save(); }

    const ph = t.closest('[data-photo]');
    if (ph) return viewPhoto(ph.dataset.photo);

    const action = t.closest('[data-action]');
    if (!action) return;
    switch (action.dataset.action) {
      case 'take-photo':   return addPhotos({ capture: true });
      case 'pick-photo':   return addPhotos({ capture: false });
      case 'scan':         return scanPhotos();
      case 'dictate':      return dictate();
      case 'add-tag':      return addTag();
      case 'new-location': return newLocation();
      case 'delete-box':   return deleteBox();
    }
  });

  container.addEventListener('submit', async (e) => {
    if (e.target.dataset.action !== 'add-item-form') return;
    e.preventDefault();
    const input = $('#itemInput', container);
    const text = input.value;
    if (!text.trim()) return;
    store.addItems(box, splitTyped(text), 'manual');
    input.value = '';
    await save();
    setTimeout(() => $('#itemInput', container) && $('#itemInput', container).focus(), 30);
  });
}

// Typing "kettle, toaster, jug" should make three items, not one.
const splitTyped = (text) => text.split(/[,;\n]+/);

async function save({ repaint = true } = {}) {
  await store.saveBox(box);
  onChange();
  if (repaint) paint($('#view'));
}

// ------------------------------------------------------------- photos
async function addPhotos({ capture }) {
  const files = await photosLib.pickFiles({ multiple: !capture, capture });
  if (!files.length) return;

  const p = progressSheet('Saving photos');
  let n = 0;
  for (const file of files) {
    try { await photosLib.addPhoto(box.id, file); } catch (_) { toast('One photo could not be read'); }
    p.update(`Saved ${++n} of ${files.length}`, n / files.length);
  }
  p.done();

  photos = (await store.photosFor(box.id)).sort((a, b) => a.createdAt - b.createdAt);
  onChange();
  paint($('#view'));
  toast(files.length === 1 ? 'Photo added' : files.length + ' photos added');
}

function viewPhoto(photoId) {
  const photo = photos.find(p => p.id === photoId);
  if (!photo) return;
  openSheet(`
    <div class="photo-view">
      <img src="${photosLib.objectUrl(photo.blob, 'full_' + photo.id)}" alt="">
      ${photo.labels && photo.labels.length ? `
        <p class="muted small">Recognised: ${photo.labels.map(l => esc(l.text || l)).join(', ')}</p>` : ''}
      <div class="row gap end">
        <button class="btn ghost" data-photo-action="delete">Delete photo</button>
        <button class="btn" data-photo-action="rescan">Scan again</button>
        <button class="btn primary" data-sheet="close">Done</button>
      </div>
    </div>`, {
    onMount(body) {
      body.addEventListener('click', async (e) => {
        const a = e.target.closest('[data-photo-action]');
        if (!a) return;
        if (a.dataset.photoAction === 'delete') {
          closeSheet(null);
          if (!(await ask('Delete photo?', 'This removes it from the phone. A copy already backed up to OneDrive stays there.', { confirmText: 'Delete', danger: true }))) return;
          await store.deletePhoto(photo.id);
          photos = photos.filter(p => p.id !== photo.id);
          onChange();
          paint($('#view'));
        } else {
          closeSheet(null);
          photo.scanned = false;
          await store.savePhoto(photo);
          await scanPhotos([photo]);
        }
      });
    }
  });
}

// ------------------------------------------------- keywords out of photos
async function scanPhotos(subset) {
  const todo = subset || photos.filter(p => !p.scanned);
  if (!todo.length) return toast('Nothing new to scan');

  const p = progressSheet('Reading photos');
  const foundItems = new Set();
  const foundTags = new Set();
  let text = box.ocrText || '';

  for (let i = 0; i < todo.length; i++) {
    const photo = todo[i];
    const base = i / todo.length;
    const step = 1 / todo.length;

    try {
      p.update(`Photo ${i + 1} of ${todo.length} · reading text`, base);
      const ocr = await vision.readText(photo.blob, (_status, ratio) =>
        p.update(`Photo ${i + 1} of ${todo.length} · reading text`, base + ratio * step * 0.7));
      photo.ocr = ocr;
      if (ocr) text += (text ? '\n' : '') + ocr;
      vision.itemCandidates(ocr).forEach(t => foundItems.add(t));
    } catch (e) {
      p.done();
      return toast('Text scanning needs a connection the first time. ' + e.message);
    }

    try {
      p.update(`Photo ${i + 1} of ${todo.length} · recognising contents`, base + step * 0.75);
      const labels = await vision.labelObjects(photo.blob);
      photo.labels = labels;
      labels.forEach(l => foundItems.add(l.text));
    } catch (_) { /* labelling is a bonus, OCR is the real value */ }

    photo.scanned = true;
    await store.savePhoto(photo);
    p.update(`Photo ${i + 1} of ${todo.length}`, base + step);
  }

  box.ocrText = text.slice(0, 20000);
  search.keywordsFrom(text, 8).forEach(w => foundTags.add(w));
  await store.saveBox(box);
  p.done();

  photos = (await store.photosFor(box.id)).sort((a, b) => a.createdAt - b.createdAt);
  if (!foundItems.size) { paint($('#view')); return toast('Nothing legible found in those photos'); }
  chooseSuggestions([...foundItems], [...foundTags]);
}

function chooseSuggestions(items, tags) {
  const known = new Set(box.items.map(i => i.text.toLowerCase()));
  const fresh = items.filter(t => !known.has(t.toLowerCase()));
  if (!fresh.length) { paint($('#view')); return toast('Nothing new found'); }

  openSheet(`
    <h2>Found in your photos</h2>
    <p class="muted small">Tap anything that is actually in this box. Machine reading is
      approximate &mdash; ignore the nonsense.</p>
    <div class="chips pick">
      ${fresh.map((t, i) => `<button class="chip pick" data-pick="${i}">${esc(t)}</button>`).join('')}
    </div>
    ${tags.length ? `<h3 class="mt">Suggested tags</h3>
      <div class="chips pick">
        ${tags.map((t, i) => `<button class="chip pick tagpick" data-tagpick="${i}">${esc(t)}</button>`).join('')}
      </div>` : ''}
    <div class="row gap end mt">
      <button class="btn ghost" data-sheet="cancel">Skip</button>
      <button class="btn ghost" data-pick-all>Select all</button>
      <button class="btn primary" data-pick-save>Add selected</button>
    </div>`, {
    onMount(body) {
      body.addEventListener('click', async (e) => {
        const chip = e.target.closest('[data-pick], [data-tagpick]');
        if (chip) { chip.classList.toggle('on'); return; }

        if (e.target.closest('[data-pick-all]')) {
          $$('.chip.pick[data-pick]', body).forEach(c => c.classList.add('on'));
          return;
        }
        if (e.target.closest('[data-pick-save]')) {
          const chosen = $$('[data-pick].on', body).map(c => fresh[+c.dataset.pick]);
          const chosenTags = $$('[data-tagpick].on', body).map(c => tags[+c.dataset.tagpick]);
          store.addItems(box, chosen, 'ocr');
          box.tags = [...new Set([...(box.tags || []), ...chosenTags])];
          await store.saveBox(box);
          closeSheet(null);
          onChange();
          paint($('#view'));
          toast(chosen.length + ' item(s) added');
        }
      });
    }
  });
}

// ------------------------------------------------------------ dictation
function dictate() {
  const collected = [];
  let session = null;

  openSheet(`
    <h2>Dictate contents</h2>
    <p class="muted small">Say what is going in, pausing between things. Say
      &ldquo;and&rdquo; or just pause to start a new item.</p>
    <div class="listening"><span class="pulse"></span> Listening&hellip;</div>
    <p id="partial" class="partial"></p>
    <ul id="heard" class="items"></ul>
    <div class="row gap end mt">
      <button class="btn ghost" data-dict="cancel">Cancel</button>
      <button class="btn primary" data-dict="done">Done &amp; add</button>
    </div>`, {
    onMount(body) {
      const heard = body.querySelector('#heard');
      const partial = body.querySelector('#partial');

      const redraw = () => {
        heard.innerHTML = collected.map((t, i) =>
          `<li><span class="src voice"></span><span class="txt">${esc(t)}</span>
           <button class="icon-btn tiny" data-drop="${i}">&times;</button></li>`).join('');
      };

      session = voice.listen({
        onPartial: (t) => { partial.textContent = t; },
        onFinal: (t) => {
          partial.textContent = '';
          voice.splitSpeech(t).forEach(s => collected.push(store.cleanItem(s)));
          redraw();
        },
        onError: (e) => toast('Microphone: ' + e.message)
      });

      body.addEventListener('click', async (e) => {
        const drop = e.target.closest('[data-drop]');
        if (drop) { collected.splice(+drop.dataset.drop, 1); redraw(); return; }

        const btn = e.target.closest('[data-dict]');
        if (!btn) return;
        if (session) session.stop();
        if (btn.dataset.dict === 'cancel') return closeSheet(null);

        const added = store.addItems(box, collected, 'voice');
        await store.saveBox(box);
        closeSheet(null);
        onChange();
        paint($('#view'));
        toast(added + ' item(s) added');
      });
    }
  });
}

// -------------------------------------------------------------- bits
async function addTag() {
  const { prompt } = await import('./ui.js');
  const tag = await prompt('Add a tag', { placeholder: 'kitchen, fragile, open first' });
  if (!tag) return;
  box.tags = [...new Set([...(box.tags || []), ...tag.split(/[,\s]+/).filter(Boolean)])];
  await save();
}

async function newLocation() {
  const { prompt } = await import('./ui.js');
  const name = await prompt('New place', { placeholder: 'Shipping container A' });
  if (!name) return;
  const loc = store.newLocation(name);
  await store.saveLocation(loc);
  locations = await store.allLocations();
  box.locationId = loc.id;
  await save();
  toast('Stored in ' + name);
}

async function deleteBox() {
  if (!(await ask(`Delete box ${box.number}?`,
    'The box, its contents list and its photos on this phone are removed. Anything already backed up to OneDrive stays there.',
    { confirmText: 'Delete', danger: true }))) return;
  await store.deleteBox(box.id);
  onChange();
  location.hash = '#/boxes';
}
