// BT DUA voice (shared by the AI Center bar AND the chat sheet): browser-native speech only (Web Speech API). No audio is recorded, stored or sent by BT itself.
// Input  : SpeechRecognition -> text -> the SAME ask() path as typing. Voice can never approve anything: approvals
//          still need a real user tap (BTAgent.decide refuses untrusted gestures).
// Output : speechSynthesis reads a short plain-text version of the latest answer. Off by default.
export function voiceSupport(win = window) {
  return { input: !!(win.SpeechRecognition || win.webkitSpeechRecognition), output: !!(win.speechSynthesis && win.SpeechSynthesisUtterance) };
}

// Markdown/tables are unpleasant to hear: keep prose, drop tables and code, cap the length.
export function speakable(text, max = 420) {
  let t = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ').replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/[*_`#>]+/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
  if (t.length > max) { const cut = t.slice(0, max), i = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; ')); t = (i > 120 ? cut.slice(0, i + 1) : cut.trimEnd() + '…'); }
  return t;
}

// Returns { start(), stop() } or null when unsupported. Callbacks: onInterim(text), onFinal(text), onEnd(), onError(code).
export function createRecognizer(win, { lang = 'en-US', onInterim, onFinal, onEnd, onError } = {}) {
  const SR = win.SpeechRecognition || win.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.lang = lang; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
  let finalText = '', failed = false;
  r.onresult = ev => {
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const res = ev.results[i], t = res[0] ? res[0].transcript : '';
      if (res.isFinal) finalText += t; else interim += t;
    }
    if (interim && onInterim) onInterim((finalText + interim).trim());
  };
  r.onerror = ev => { failed = true; if (onError) onError(ev && ev.error ? ev.error : 'unknown'); };
  r.onend = () => { const t = finalText.trim(); if (!failed && t && onFinal) onFinal(t); if (onEnd) onEnd(); };
  return { start: () => { finalText = ''; failed = false; r.start(); }, stop: () => { try { r.stop(); } catch (_) { /* already stopped */ } } };
}

export function speak(win, text, lang = 'en-US') {
  if (!voiceSupport(win).output) return false;
  const t = speakable(text); if (!t) return false;
  win.speechSynthesis.cancel();
  const u = new win.SpeechSynthesisUtterance(t); u.lang = lang; u.rate = getVoiceRate();
  const vname = getVoiceName();
  if (vname) { try { const v = (win.speechSynthesis.getVoices() || []).find(x => x.name === vname); if (v) { u.voice = v; u.lang = v.lang || lang; } } catch (_) { /* no voice list: device default */ } }
  u.onstart = () => emitVoiceState(win, true); u.onend = () => emitVoiceState(win, false); u.onerror = () => emitVoiceState(win, false);
  win.speechSynthesis.speak(u); return true;
}
export function stopSpeaking(win) { if (voiceSupport(win).output) { win.speechSynthesis.cancel(); emitVoiceState(win, false); } }
// The AI Center avatar listens for this to animate while Dua is talking. No audio data is involved.
function emitVoiceState(win, speaking) { try { win.dispatchEvent(new win.CustomEvent('bt-voice-state', { detail: { speaking } })); } catch (_) { /* fake window in tests */ } }

// Shared preference + language, so the AI Center toggle and the chat-sheet toggle always agree.
const LS_OUT = 'bt_voice_out_v1';
export function getVoiceOut() { try { return localStorage.getItem(LS_OUT) === '1'; } catch (_) { return false; } }
export function setVoiceOut(on) { try { localStorage.setItem(LS_OUT, on ? '1' : '0'); } catch (_) { /* private mode: the toggle still works for this page */ } }
export function voiceLang(win = window) { const l = win.navigator && win.navigator.language; return l && /^[a-z]{2}(-[A-Z]{2})?$/.test(l) ? l : 'en-US'; }

// Spoken-answer speed and voice (chosen in the Dua avatar settings). Both fall back to the device default.
const LS_RATE = 'bt_voice_rate_v1', LS_NAME = 'bt_voice_name_v1';
export function getVoiceRate() { try { const r = Number(localStorage.getItem(LS_RATE)); return r >= 0.6 && r <= 1.6 ? r : 1; } catch (_) { return 1; } }
export function setVoiceRate(r) { try { localStorage.setItem(LS_RATE, String(Math.min(1.6, Math.max(0.6, Number(r) || 1)))); } catch (_) { /* private mode */ } }
export function getVoiceName() { try { return localStorage.getItem(LS_NAME) || ''; } catch (_) { return ''; } }
export function setVoiceName(n) { try { if (n) localStorage.setItem(LS_NAME, String(n)); else localStorage.removeItem(LS_NAME); } catch (_) { /* private mode */ } }
