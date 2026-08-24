// Capture, downscale and store photos. Full frames are kept at 1600px so they
// stay readable but a whole move still fits in browser storage.
import * as db from './db.js';

const FULL_MAX = 1600;
const THUMB_MAX = 400;
const QUALITY = 0.78;

export function pickFiles({ multiple = true, capture = false } = {}) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (multiple) input.multiple = true;
    if (capture) input.capture = 'environment';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const files = [...(input.files || [])];
      input.remove();
      resolve(files);
    }, { once: true });
    input.click();
  });
}

async function loadBitmap(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file); } catch (_) { /* fall through */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function scaleTo(bitmap, max) {
  const w = bitmap.width, h = bitmap.height;
  const ratio = Math.min(1, max / Math.max(w, h));
  const cw = Math.round(w * ratio), ch = Math.round(h * ratio);
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, cw, ch);
  return canvas;
}

const toBlob = (canvas, quality) =>
  new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));

export async function addPhoto(boxId, file) {
  const bitmap = await loadBitmap(file);
  const fullCanvas = scaleTo(bitmap, FULL_MAX);
  const thumbCanvas = scaleTo(bitmap, THUMB_MAX);
  const [blob, thumb] = await Promise.all([
    toBlob(fullCanvas, QUALITY),
    toBlob(thumbCanvas, 0.7)
  ]);
  if (bitmap.close) bitmap.close();

  const photo = {
    id: db.uid('p_'),
    boxId,
    blob,
    thumb,
    width: fullCanvas.width,
    height: fullCanvas.height,
    bytes: blob.size,
    createdAt: Date.now(),
    ocr: '',
    labels: [],
    scanned: false,
    remoteName: null,
    uploadedAt: null
  };
  await db.put('photos', photo);
  return photo;
}

const urlCache = new Map();

export function objectUrl(blob, key) {
  if (key && urlCache.has(key)) return urlCache.get(key);
  const url = URL.createObjectURL(blob);
  if (key) urlCache.set(key, url);
  return url;
}

export function releaseUrls() {
  for (const url of urlCache.values()) URL.revokeObjectURL(url);
  urlCache.clear();
}

export function fmtBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + units[i];
}
