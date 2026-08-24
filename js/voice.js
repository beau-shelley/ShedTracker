// Dictation for adding contents. Packing a tub while holding a phone is
// awkward; talking at it is not. Chrome on Android supports this natively.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export const supported = () => !!SR;

// Splits a spoken run of contents into separate items.
// "kettle, toaster and the good frying pan" -> three items
export function splitSpeech(text) {
  return String(text || '')
    .replace(/\b(and then|and also|and|plus|next)\b/gi, ',')
    .replace(/\b(comma|full stop|new item)\b/gi, ',')
    .split(/[,;\n]+/)
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(s => s.length > 1);
}

export function listen({ onPartial, onFinal, onEnd, onError } = {}) {
  if (!SR) { onError && onError(new Error('This browser cannot do speech input')); return null; }

  const rec = new SR();
  rec.lang = navigator.language || 'en-AU';
  rec.continuous = true;
  rec.interimResults = true;

  let stopped = false;

  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      const text = res[0].transcript;
      if (res.isFinal) onFinal && onFinal(text);
      else interim += text;
    }
    if (interim && onPartial) onPartial(interim);
  };

  rec.onerror = (e) => { if (e.error !== 'no-speech' && onError) onError(new Error(e.error)); };

  // Android likes to end the session after a pause. Restart until told to stop.
  rec.onend = () => {
    if (stopped) { onEnd && onEnd(); return; }
    try { rec.start(); } catch (_) { onEnd && onEnd(); }
  };

  try { rec.start(); } catch (e) { onError && onError(e); return null; }

  return { stop() { stopped = true; try { rec.stop(); } catch (_) {} } };
}
