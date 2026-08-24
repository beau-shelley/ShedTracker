// Domain layer: boxes, locations, items. Everything the UI talks to.
import * as db from './db.js';

export const STATUS = ['packing', 'sealed', 'stored', 'unpacked'];

export function newBox(number) {
  const now = Date.now();
  return {
    id: db.uid('b_'),
    number,                 // integer, matches the sticker on the tub
    name: '',               // optional human name, e.g. "Kitchen - pantry"
    locationId: null,       // where the tub physically is
    position: '',           // free text within the location, e.g. "row 2, back"
    status: 'packing',
    items: [],              // [{ id, text, source }]
    tags: [],
    notes: '',
    ocrText: '',            // accumulated text scanned out of photos
    createdAt: now,
    updatedAt: now,
    deleted: false
  };
}

export function newLocation(name) {
  return { id: db.uid('l_'), name, kind: 'container', notes: '', createdAt: Date.now() };
}

export const allBoxes = async () =>
  (await db.getAll('boxes')).filter(b => !b.deleted).sort((a, b) => a.number - b.number);

export const allLocations = async () =>
  (await db.getAll('locations')).sort((a, b) => a.name.localeCompare(b.name));

export const getBox = (id) => db.get('boxes', id);
export const getLocation = (id) => (id ? db.get('locations', id) : Promise.resolve(null));

export async function saveBox(box) {
  box.updatedAt = Date.now();
  await db.put('boxes', box);
  return box;
}

export const saveLocation = (loc) => db.put('locations', loc);

export async function deleteBox(id) {
  const box = await getBox(id);
  if (!box) return;
  box.deleted = true;
  box.updatedAt = Date.now();
  await db.put('boxes', box);
  for (const p of await db.getAllBy('photos', 'boxId', id)) await db.del('photos', p.id);
}

export async function deleteLocation(id) {
  const boxes = await db.getAllBy('boxes', 'locationId', id);
  for (const b of boxes) { b.locationId = null; b.updatedAt = Date.now(); await db.put('boxes', b); }
  await db.del('locations', id);
}

export async function nextNumber() {
  const boxes = await db.getAll('boxes');
  return boxes.reduce((m, b) => Math.max(m, b.number || 0), 0) + 1;
}

export async function findByNumber(number) {
  const boxes = await db.getAll('boxes');
  return boxes.find(b => b.number === number && !b.deleted) || null;
}

// ---- items ----
export function addItems(box, texts, source = 'manual') {
  const existing = new Set(box.items.map(i => i.text.toLowerCase().trim()));
  let added = 0;
  for (const raw of texts) {
    const text = cleanItem(raw);
    if (!text) continue;
    const key = text.toLowerCase();
    if (existing.has(key)) continue;
    existing.add(key);
    box.items.push({ id: db.uid('i_'), text, source });
    added++;
  }
  return added;
}

export function cleanItem(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-\u2022*.,;:]+|[\s\-\u2022*.,;:]+$/g, '')
    .slice(0, 120)
    .trim();
}

export function removeItem(box, itemId) {
  box.items = box.items.filter(i => i.id !== itemId);
}

// ---- photos ----
export const photosFor = (boxId) => db.getAllBy('photos', 'boxId', boxId);
export const allPhotos = () => db.getAll('photos');
export const getPhoto = (id) => db.get('photos', id);
export const savePhoto = (photo) => db.put('photos', photo);
export const deletePhoto = (id) => db.del('photos', id);

export async function photoCounts() {
  const counts = {};
  for (const p of await db.getAll('photos')) counts[p.boxId] = (counts[p.boxId] || 0) + 1;
  return counts;
}

// ---- export / import (the shape that goes to OneDrive) ----
export async function snapshot() {
  const [boxes, locations, photos] = await Promise.all([
    db.getAll('boxes'), db.getAll('locations'), db.getAll('photos')
  ]);
  return {
    format: 'shedtracker/1',
    exportedAt: Date.now(),
    boxes,
    locations,
    photos: photos.map(p => ({
      id: p.id, boxId: p.boxId, createdAt: p.createdAt,
      remoteName: p.remoteName || null, uploadedAt: p.uploadedAt || null,
      labels: p.labels || [], ocr: p.ocr || ''
    }))
  };
}

// Merge a snapshot in, newest-wins per record. Returns a small report.
export async function mergeSnapshot(snap) {
  const report = { boxes: 0, locations: 0 };
  if (!snap || snap.format !== 'shedtracker/1') throw new Error('Not a Shed Tracker backup file');

  const localBoxes = new Map((await db.getAll('boxes')).map(b => [b.id, b]));
  const incoming = [];
  for (const b of snap.boxes || []) {
    const mine = localBoxes.get(b.id);
    if (!mine || (b.updatedAt || 0) > (mine.updatedAt || 0)) { incoming.push(b); report.boxes++; }
  }
  if (incoming.length) await db.putMany('boxes', incoming);

  const localLocs = new Map((await db.getAll('locations')).map(l => [l.id, l]));
  const incomingL = (snap.locations || []).filter(l => !localLocs.has(l.id));
  if (incomingL.length) { await db.putMany('locations', incomingL); report.locations = incomingL.length; }

  return report;
}
