// Synthèse vocale : lit à voix haute les réponses (assistant, sessions). D'abord le synthétiseur du bridge (/api/tts, voix locale Piper),
// sinon celle du navigateur (speechSynthesis) si elle existe. Le navigateur du Quest n'en a pas toujours.
const KEY = 'questlab.voice';
export function createVoice() {
  const ss = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null; let on = false; try { on = localStorage.getItem(KEY) === '1'; } catch {}
  let voice = null, ctl = null, audio = null; const pick = () => { const v = ss?.getVoices() ?? []; voice = v.find((x) => /^fr[-_]FR/i.test(x.lang)) || v.find((x) => /^fr/i.test(x.lang)) || null; }; pick(); if (ss) ss.onvoiceschanged = pick;
  // texte lisible : sans code, adresses, tableaux ni mise en forme ; 500 caractères au plus, coupés en fin de phrase
  const clean = (t) => { let s = String(t).replace(/```[\s\S]*?```/g, ' (code) ').replace(/`([^`]*)`/g, '$1').replace(/https?:\/\/\S+/g, ' lien ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*\|.*\|\s*$/gm, '').replace(/[#*_>~|]/g, ' ').replace(/^\s*[-•]\s+/gm, '').replace(/\s+/g, ' ').trim();
    if (s.length > 500) { s = s.slice(0, 500); const i = Math.max(s.lastIndexOf('. '), s.lastIndexOf('! '), s.lastIndexOf('? ')); s = i > 200 ? s.slice(0, i + 1) : s; } return s; };
  return {
    get supported() { return true; }, get on() { return on; },
    stop() { try { ctl?.abort(); } catch {} try { audio?.pause(); } catch {} try { ss?.cancel(); } catch {} },
    async speak(text) { if (!on) return; const s = clean(text); if (!s) return; this.stop(); ctl = new AbortController(); const c = ctl;
      try { const r = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: s }), signal: c.signal });
        if (r.ok) { const url = URL.createObjectURL(await r.blob()); audio = new Audio(url); audio.onended = () => URL.revokeObjectURL(url); await audio.play(); return true; } } catch { if (c.signal.aborted) return; }
      if (!ss) return false; // pas de synthétiseur sur le bridge : voix du navigateur
      try { const u = new SpeechSynthesisUtterance(s); u.lang = voice?.lang || 'fr-FR'; if (voice) u.voice = voice; u.rate = 1.05; ss.speak(u); return true; } catch { return false; } },
    toggle() { on = !on; try { localStorage.setItem(KEY, on ? '1' : '0'); } catch {} if (!on) this.stop(); return on; },
    hasVoice() { return !!voice; },
  };
}
