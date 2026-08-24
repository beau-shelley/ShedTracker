// On-device photo understanding. Nothing leaves the phone and nothing costs money.
//
//   readText(blob)   - OCR via Tesseract.js. Genuinely good at product boxes,
//                      appliance labels, book spines, anything printed.
//   labelObjects()   - rough object recognition via MobileNet. Useful as a
//                      starting point for tags; not a substitute for typing.
//
// Both libraries are fetched from a CDN the first time you use them and then
// cached by the service worker, so the first scan needs a connection.

const CDN = {
  tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  tfjs:      'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js',
  mobilenet: 'https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1/dist/mobilenet.min.js'
};

const loaded = new Map();
function loadScript(src) {
  if (loaded.has(src)) return loaded.get(src);
  const p = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.crossOrigin = 'anonymous';
    el.onload = resolve;
    el.onerror = () => reject(new Error('Could not load ' + src + ' (are you online?)'));
    document.head.appendChild(el);
  });
  loaded.set(src, p);
  return p;
}

// ---------------------------------------------------------------- OCR
let workerP = null;

async function getWorker(onProgress) {
  if (workerP) return workerP;
  workerP = (async () => {
    await loadScript(CDN.tesseract);
    return Tesseract.createWorker('eng', 1, {
      logger: (m) => {
        if (onProgress && m.progress != null) onProgress(m.status, m.progress);
      }
    });
  })();
  return workerP;
}

export async function readText(blob, onProgress) {
  const worker = await getWorker(onProgress);
  const { data } = await worker.recognize(blob);
  return cleanOcr(data.text || '');
}

export async function disposeOcr() {
  if (!workerP) return;
  try { (await workerP).terminate(); } catch (_) {}
  workerP = null;
}

// OCR of a cluttered tub is noisy. Keep lines that look like real words.
export function cleanOcr(raw) {
  return raw
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(line => {
      if (line.length < 3) return false;
      const letters = (line.match(/[a-zA-Z]/g) || []).length;
      if (letters < 3) return false;
      const junk = (line.match(/[^a-zA-Z0-9 .,'&\/+%-]/g) || []).length;
      return junk / line.length < 0.3 && letters / line.length > 0.45;
    })
    .join('\n');
}

// Lines that look like a product or item name, offered as one-tap contents.
export function itemCandidates(ocrText, max = 15) {
  const seen = new Set();
  const out = [];
  for (const line of String(ocrText || '').split('\n')) {
    const t = line.trim();
    if (t.length < 3 || t.length > 60) continue;
    const words = t.split(' ').filter(Boolean);
    if (words.length > 6) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(titleCase(t));
    if (out.length >= max) break;
  }
  return out;
}

function titleCase(s) {
  if (s === s.toUpperCase() && s.length > 3) s = s.toLowerCase();
  return s.replace(/\b[a-z]/g, c => c.toUpperCase());
}

// ------------------------------------------------------- object labels
let modelP = null;

async function getModel() {
  if (modelP) return modelP;
  modelP = (async () => {
    await loadScript(CDN.tfjs);
    await loadScript(CDN.mobilenet);
    return mobilenet.load({ version: 2, alpha: 1.0 });
  })();
  return modelP;
}

export async function labelObjects(blob, { min = 0.12, max = 6 } = {}) {
  const model = await getModel();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = 224; canvas.height = 224;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, 224, 224);
  if (bitmap.close) bitmap.close();

  const preds = await model.classify(canvas, 10);
  const out = [];
  const seen = new Set();
  for (const p of preds) {
    if (p.probability < min) continue;
    // ImageNet names come comma-separated: "power drill, drill" -> take each.
    for (const part of p.className.split(',')) {
      const name = titleCase(part.trim());
      const key = name.toLowerCase();
      if (!name || seen.has(key) || IGNORE.has(key)) continue;
      seen.add(key);
      out.push({ text: name, confidence: p.probability });
      if (out.length >= max) return out;
    }
  }
  return out;
}

// MobileNet loves guessing these when it sees a plastic tub. They tell us nothing.
const IGNORE = new Set([
  'carton', 'packet', 'envelope', 'crate', 'chest', 'box', 'shopping basket',
  'wardrobe', 'closet', 'press', 'plastic bag', 'paper towel', 'quilt', 'comforter',
  'studio couch', 'day bed', 'shoji', 'window shade', 'home theater', 'home theatre'
]);

export const ocrReady = () => !!workerP;
export const modelReady = () => !!modelP;
