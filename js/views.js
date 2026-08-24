// Places and settings.
import * as store from './store.js';
import * as db from './db.js';
import * as od from './onedrive.js';
import * as sync from './sync.js';
import { fmtBytes } from './photos.js';
import { $, $$, esc, toast, ask, prompt, openSheet, closeSheet, progressSheet, relTime } from './ui.js';

// ------------------------------------------------------------- places
export async function renderLocations(container, opts = {}) {
  const [locations, boxes] = await Promise.all([store.allLocations(), store.allBoxes()]);
  const counts = {};
  for (const b of boxes) counts[b.locationId || ''] = (counts[b.locationId || ''] || 0) + 1;
  const loose = counts[''] || 0;

  container.innerHTML = `
    <p class="lede">Where the tubs physically are. A place can be a shipping
      container, a room, the garage, or the back of the ute.</p>
    <ul class="list">
      ${locations.map(l => `
        <li class="row-item" data-location="${l.id}">
          <div class="grow">
            <strong>${esc(l.name)}</strong>
            ${l.notes ? `<div class="muted small">${esc(l.notes)}</div>` : ''}
          </div>
          <span class="count">${counts[l.id] || 0}</span>
          <button class="icon-btn tiny" data-edit-location="${l.id}" aria-label="Edit">&#9998;</button>
        </li>`).join('') || '<li class="empty">No places yet. Add your first shipping container.</li>'}
      ${loose ? `<li class="row-item muted" data-location=""><div class="grow">Not stored anywhere yet</div><span class="count">${loose}</span></li>` : ''}
    </ul>`;

  container.onclick = async (e) => {
    const edit = e.target.closest('[data-edit-location]');
    if (edit) {
      const loc = await store.getLocation(edit.dataset.editLocation);
      return editLocation(loc, container, opts);
    }
    const row = e.target.closest('[data-location]');
    if (row) location.hash = '#/boxes?place=' + encodeURIComponent(row.dataset.location);
  };
}

export async function newLocationFlow(onDone) {
  const name = await prompt('New place', { placeholder: 'Shipping container A' });
  if (!name) return;
  await store.saveLocation(store.newLocation(name));
  toast('Added ' + name);
  onDone && onDone();
}

async function editLocation(loc, container, opts) {
  openSheet(`
    <h2>Edit place</h2>
    <input class="field" id="locName" value="${esc(loc.name)}" placeholder="Name">
    <input class="field" id="locNotes" value="${esc(loc.notes || '')}" placeholder="Notes, e.g. 20ft, Kelso yard, key on red tag">
    <div class="row gap end mt">
      <button class="btn danger ghost" data-loc="delete">Delete</button>
      <button class="btn ghost" data-sheet="cancel">Cancel</button>
      <button class="btn primary" data-loc="save">Save</button>
    </div>`, {
    onMount(body) {
      body.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-loc]');
        if (!btn) return;
        if (btn.dataset.loc === 'save') {
          loc.name = $('#locName', body).value.trim() || loc.name;
          loc.notes = $('#locNotes', body).value.trim();
          await store.saveLocation(loc);
          closeSheet(null);
        } else {
          closeSheet(null);
          if (!(await ask('Delete place?', 'Boxes stored there stay, but lose their location.', { confirmText: 'Delete', danger: true }))) return;
          await store.deleteLocation(loc.id);
        }
        opts.onChange && opts.onChange();
        renderLocations(container, opts);
      });
    }
  });
}

// ------------------------------------------------------------ settings
export async function renderSettings(container, opts = {}) {
  const [clientId, st, est, boxes, folder] = await Promise.all([
    od.getClientId(), sync.status(), db.estimate(), store.allBoxes(), od.getFolderLink()
  ]);
  const items = boxes.reduce((n, b) => n + b.items.length, 0);

  container.innerHTML = `
    <section class="card">
      <h3>OneDrive backup</h3>
      ${st.signedIn ? `
        <p class="ok">Signed in${st.account ? ' as ' + esc(st.account.name || st.account.email) : ''}</p>
        <p class="muted small">Last sync ${relTime(st.lastSync)} &middot;
           ${st.pending} photo(s) waiting to upload</p>
        <div class="row gap">
          <button class="btn primary grow" data-action="push">Back up now</button>
          <button class="btn ghost grow" data-action="pull">Restore</button>
        </div>
        <button class="btn ghost wide" data-action="signout">Sign out</button>

        <div class="mt">
          ${folder ? `
            <p class="muted small">Saving into <strong>${esc(folder.name)}</strong>${folder.webUrl ? ` &middot; <a href="${esc(folder.webUrl)}" target="_blank" rel="noopener">open</a>` : ''}</p>
            <button class="btn ghost wide" data-action="unlinkfolder">Use the app's private folder instead</button>
          ` : `
            <p class="muted small">Saving into the app's private
              <strong>OneDrive &rsaquo; Apps &rsaquo; Shed Tracker</strong> folder.
              Paste a link to a folder of your own to save there instead.</p>
            <input class="field" id="folderLink" placeholder="https://1drv.ms/f/..." autocomplete="off">
            <button class="btn ghost wide" data-action="linkfolder">Use this folder</button>
          `}
        </div>
      ` : `
        <p class="muted small">Photos and the whole index go into
          <strong>OneDrive &rsaquo; Apps &rsaquo; Shed Tracker</strong> by default, or a
          folder of your own once you link one in Settings.</p>
        <label>Application (client) ID
          <input class="field" id="clientId" value="${esc(clientId)}"
                 placeholder="00000000-0000-0000-0000-000000000000" autocomplete="off">
        </label>
        <p class="muted small">One-off setup &mdash; see SETUP.md. Redirect URI to register:
          <code class="break">${esc(od.redirectUri())}</code></p>
        <button class="btn primary wide" data-action="signin">Sign in to OneDrive</button>
      `}
    </section>

    <section class="card">
      <h3>On this phone</h3>
      <dl class="stats">
        <div><dt>Boxes</dt><dd>${boxes.length}</dd></div>
        <div><dt>Items listed</dt><dd>${items}</dd></div>
        <div><dt>Photos</dt><dd>${st.totalPhotos}</dd></div>
        <div><dt>Photo storage</dt><dd>${fmtBytes(st.bytes)}</dd></div>
        ${est ? `<div><dt>Browser quota</dt><dd>${fmtBytes(est.usage)} of ${fmtBytes(est.quota)}</dd></div>` : ''}
      </dl>
      <div class="row gap">
        <button class="btn ghost grow" data-action="csv">Export CSV</button>
        <button class="btn ghost grow" data-action="json">Export JSON</button>
      </div>
    </section>

    <section class="card">
      <h3>Danger zone</h3>
      <button class="btn danger ghost wide" data-action="wipe">Erase everything on this phone</button>
      <p class="muted small">Your OneDrive backup is not touched, so you can restore afterwards.</p>
    </section>

    <p class="muted small center">Shed Tracker &middot; works offline &middot; add to your home screen for a full-screen app</p>`;

  container.onclick = async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    try {
      if (action === 'signin') {
        const id = $('#clientId', container).value.trim();
        if (!id) return toast('Paste your Application (client) ID first');
        await od.setClientId(id);
        await od.signIn();
      }

      if (action === 'signout') {
        if (!(await ask('Sign out?', 'Your backup stays in OneDrive.', { confirmText: 'Sign out' }))) return;
        await od.signOut();
        renderSettings(container, opts);
      }

      if (action === 'linkfolder') {
        const url = $('#folderLink', container).value.trim();
        if (!url) return toast('Paste a OneDrive folder link first');
        await od.setFolderLink(url);
        toast('Backup folder set');
        renderSettings(container, opts);
      }

      if (action === 'unlinkfolder') {
        await od.clearFolderLink();
        toast("Back to the app's private folder");
        renderSettings(container, opts);
      }

      if (action === 'push') {
        const p = progressSheet('Backing up to OneDrive');
        try {
          const r = await sync.push(({ phase, done, total }) => {
            if (phase === 'photos') p.update(`Uploading photos ${done} of ${total}`, total ? done / total : 1);
            else p.update('Writing the index', 0.98);
          });
          p.done();
          toast(`Backed up · ${r.uploaded} photo(s)` + (r.failed ? `, ${r.failed} failed` : ''));
        } catch (err) { p.done(); toast(err.message); }
        renderSettings(container, opts);
      }

      if (action === 'pull') {
        if (!(await ask('Restore from OneDrive?', 'Anything newer in the backup replaces what is on this phone. Missing photos are downloaded.', { confirmText: 'Restore' }))) return;
        const p = progressSheet('Restoring from OneDrive');
        try {
          const r = await sync.pull(({ phase, done, total }) => {
            if (phase === 'photos') p.update(`Downloading photos ${done} of ${total}`, total ? done / total : 1);
            else p.update('Reading the index', 0.1);
          });
          p.done();
          toast(r.empty ? 'No backup found in OneDrive yet' : `Restored ${r.boxes} box(es), ${r.photos} photo(s)`);
        } catch (err) { p.done(); toast(err.message); }
        opts.onChange && opts.onChange();
        renderSettings(container, opts);
      }

      if (action === 'csv') await sync.exportCsv();
      if (action === 'json') await sync.exportJson();

      if (action === 'wipe') {
        if (!(await ask('Erase everything?', 'Every box, item and photo on this phone is deleted. This cannot be undone here.', { confirmText: 'Erase', danger: true }))) return;
        const typed = await prompt('Type ERASE to confirm', { confirmText: 'Erase' });
        if (typed !== 'ERASE') return toast('Cancelled');
        for (const s of ['boxes', 'photos', 'locations']) await db.clear(s);
        opts.onChange && opts.onChange();
        toast('Erased');
        renderSettings(container, opts);
      }
    } catch (err) {
      toast(err.message || String(err));
    }
  };
}
