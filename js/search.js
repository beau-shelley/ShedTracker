// In-memory search over every box: number, name, items, tags, notes, scanned text,
// and the location it is sitting in. Rebuilt whenever data changes.
let index = [];

const STOP = new Set(['the','and','for','with','from','that','this','some','a','of','in','on','to','is','it','my','our']);

export function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u024f]+/g, ' ')
    .split(' ')
    .filter(t => t.length > 1 && !STOP.has(t));
}

export function build(boxes, locations) {
  const locById = new Map(locations.map(l => [l.id, l]));
  index = boxes.map(box => {
    const loc = box.locationId ? locById.get(box.locationId) : null;
    const fields = {
      number: String(box.number),
      name: box.name || '',
      items: box.items.map(i => i.text).join(' \u00b7 '),
      tags: (box.tags || []).join(' '),
      notes: box.notes || '',
      ocr: box.ocrText || '',
      place: [loc ? loc.name : '', box.position || ''].filter(Boolean).join(' ')
    };
    return {
      box, loc, fields,
      haystack: Object.values(fields).join(' \n ').toLowerCase(),
      tokens: new Set(tokenize(Object.values(fields).join(' ')))
    };
  });
  return index.length;
}

// Returns [{ box, loc, score, hits: [{field, text}] }]
export function search(query, limit = 200) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];

  const asNumber = /^#?\d+$/.test(q) ? parseInt(q.replace('#', ''), 10) : null;
  const terms = tokenize(q);
  if (!terms.length && asNumber === null) return [];

  const results = [];
  for (const entry of index) {
    let score = 0;
    const hits = [];

    if (asNumber !== null && entry.box.number === asNumber) score += 1000;

    for (const term of terms) {
      let termScore = 0;
      if (entry.tokens.has(term)) termScore += 20;              // whole word
      else if (entry.haystack.includes(term)) termScore += 8;   // substring
      else {
        for (const t of entry.tokens) { if (t.startsWith(term)) { termScore += 12; break; } }
      }
      if (!termScore) { score = -1; break; }                     // every term must appear
      score += termScore;
    }
    if (score <= 0) continue;

    // Weight the fields people actually search by.
    for (const [field, text] of Object.entries(entry.fields)) {
      if (!text) continue;
      const low = text.toLowerCase();
      if (terms.some(t => low.includes(t)) || (asNumber !== null && field === 'number')) {
        hits.push({ field, text });
        if (field === 'items') score += 15;
        if (field === 'name') score += 10;
        if (field === 'tags') score += 8;
        if (field === 'ocr') score += 2;
      }
    }

    results.push({ box: entry.box, loc: entry.loc, score, hits });
  }

  return results.sort((a, b) => b.score - a.score || a.box.number - b.box.number).slice(0, limit);
}

// Which items inside a box matched, so results can show the actual thing found.
export function matchingItems(box, query) {
  const terms = tokenize(query);
  if (!terms.length) return [];
  return box.items.filter(i => {
    const low = i.text.toLowerCase();
    return terms.some(t => low.includes(t));
  });
}

export function highlight(text, query) {
  const terms = tokenize(query).sort((a, b) => b.length - a.length);
  let html = escapeHtml(text);
  for (const t of terms) {
    html = html.replace(new RegExp('(' + escapeRe(t) + ')', 'ig'), '<mark>$1</mark>');
  }
  return html;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Suggest tags/keywords worth keeping out of a blob of scanned text.
export function keywordsFrom(text, max = 12) {
  const counts = new Map();
  for (const t of tokenize(text)) {
    if (t.length < 3 || /^\d+$/.test(t)) continue;
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([word]) => word);
}
