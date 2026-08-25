// Ties the local database to OneDrive. Uploads anything new, then writes the
// index last so the index never references a photo that is not up there yet.
import * as db from './db.js';
import * as store from './store.js';
import * as od from './onedrive.js';

let running = false;
export const isRunning = () => running;

export async function push(onProgress = () => {}) {
  if (running) throw new Error('A sync is already running');
  if (!(await od.isSignedIn())) throw new Error('Sign in to OneDrive first');
  running = true;

  try {
    const [photos, boxes] = await Promise.all([store.allPhotos(), db.getAll('boxes')]);
    const boxById = new Map(boxes.map(b => [b.id, b]));
    const pending = photos.filter(p => !p.uploadedAt);

    onProgress({ phase: 'photos', done: 0, total: pending.length });

    let done = 0, failed = 0;
    for (const photo of pending) {
      const name = od.photoName(boxById.get(photo.boxId), photo);
      try {
        await od.uploadFile(name, photo.blob, 'image/jpeg');
        photo.remoteName = name;
        photo.uploadedAt = Date.now();
        await store.savePhoto(photo);
      } catch (e) {
        failed++;
        if (String(e.message).includes('sign in')) throw e;
      }
      onProgress({ phase: 'photos', done: ++done, total: pending.length });
    }

    onProgress({ phase: 'index' });
    await od.putIndex(await store.snapshot());
    const at = Date.now();
    await db.setMeta('lastSync', at);

    return { uploaded: done - failed, failed, at };
  } finally {
    running = false;
  }
}

// Rebuild this device from OneDrive: index first, then any photo we are missing.
export async function pull(onProgress = () => {}) {
  if (running) throw new Error('A sync is already running');
  if (!(await od.isSignedIn())) throw new Error('Sign in to OneDrive first');
  running = true;

  try {
    onProgress({ phase: 'index' });
    const snap = await od.getIndex();
    if (!snap) return { boxes: 0, locations: 0, photos: 0, empty: true };

    const report = await store.mergeSnapshot(snap);

    const localIds = new Set((await store.allPhotos()).map(p => p.id));
    const wanted = (snap.photos || []).filter(p => !localIds.has(p.id) && p.remoteName);
    onProgress({ phase: 'photos', done: 0, total: wanted.length });

    let done = 0;
    for (const meta of wanted) {
      try {
        const res = await od.downloadFile(meta.remoteName);
        if (res) {
          const blob = await res.blob();
          await store.savePhoto({
            id: meta.id,
            boxId: meta.boxId,
            blob,
            thumb: blob,
            bytes: blob.size,
            createdAt: meta.createdAt || Date.now(),
            ocr: meta.ocr || '',
            labels: meta.labels || [],
            scanned: !!meta.ocr,
            remoteName: meta.remoteName,
            uploadedAt: meta.uploadedAt || Date.now()
          });
        }
      } catch (_) { /* a missing photo should not stop the restore */ }
      onProgress({ phase: 'photos', done: ++done, total: wanted.length });
    }

    await db.setMeta('lastSync', Date.now());
    return { ...report, photos: done };
  } finally {
    running = false;
  }
}

export async function status() {
  const [signedIn, account, lastSync, photos] = await Promise.all([
    od.isSignedIn(), od.account(), db.getMeta('lastSync', 0), store.allPhotos()
  ]);
  return {
    signedIn,
    account,
    lastSync,
    pending: photos.filter(p => !p.uploadedAt).length,
    totalPhotos: photos.length,
    bytes: photos.reduce((n, p) => n + (p.bytes || (p.blob ? p.blob.size : 0)), 0)
  };
}

// Local escape hatch: one JSON file with everything, photos included as data URLs
// is too big, so this exports the index only. Photos live in OneDrive.
export async function exportJson() {
  const snap = await store.snapshot();
  const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'move-tracker-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export async function exportCsv() {
  const [boxes, locations] = await Promise.all([store.allBoxes(), store.allLocations()]);
  const locName = new Map(locations.map(l => [l.id, l.name]));
  const rows = [['Box', 'Name', 'Location', 'Position', 'Contents', 'Tags', 'Notes']];
  for (const b of boxes) {
    rows.push([
      b.number,
      b.name,
      locName.get(b.locationId) || '',
      b.position || '',
      b.items.map(i => i.text).join('; '),
      (b.tags || []).join('; '),
      (b.notes || '').replace(/\n/g, ' ')
    ]);
  }
  const csv = rows.map(r => r.map(cell => {
    const s = String(cell == null ? '' : cell);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');

  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = 'move-tracker-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
