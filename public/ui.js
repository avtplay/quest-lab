import * as THREE from 'three';

export const STATUS = {
  idle: { c: '#7d9bd0', t: 'inactive' }, thinking: { c: '#ffcc33', t: 'réfléchit' }, working: { c: '#38e08f', t: 'travaille' },
  waiting: { c: '#ff6fd0', t: 'attend ta réponse' }, error: { c: '#ff5566', t: 'erreur' },
};
export const TYPE_COLOR = { user: '#7fd6ff', feedback: '#ffb36b', project: '#a99bff', reference: '#7be8b4' };

export function canvasTex(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return { c, g: c.getContext('2d'), t, w, h };
}
export function wrap(g, text, x, y, maxW, lh, maxLines = 99) {
  const words = String(text).split(/\s+/); let line = '', n = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + ' ' + words[i] : words[i];
    if (g.measureText(test).width > maxW && line) {
      n++; if (n >= maxLines) { g.fillText(line.replace(/.$/, '…'), x, y); return n; }
      g.fillText(line, x, y); y += lh; line = words[i];
    } else line = test;
  }
  if (line) { g.fillText(line, x, y); n++; } return n;
}
export function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 5 ? 'à l\'instant' : s < 60 ? `il y a ${s} s` : s < 3600 ? `il y a ${Math.round(s / 60)} min` : `il y a ${Math.round(s / 3600)} h`;
}
let glow;
export function glowTexture() {
  if (glow) return glow;
  const { c, g, t } = canvasTex(128, 128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return (glow = t);
}
export function glowSprite(color, size, opacity = 0.6) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.setScalar(size); return s;
}
// Sprite de texte toujours face à l'utilisateur
export function textSprite(text, { size = 0.14, color = '#dfe8ff', font = '600 54px system-ui', opacity = 1 } = {}) {
  const w = 768, h = 128, { g, t } = canvasTex(w, h);
  const m = new THREE.SpriteMaterial({ map: t, transparent: true, opacity, depthWrite: false, depthTest: false });
  const s = new THREE.Sprite(m); s.renderOrder = 10;
  s.set = (str) => { g.clearRect(0, 0, w, h); g.font = font; g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0,0,0,.8)'; g.shadowBlur = 8; g.fillText(str, w / 2, h / 2); t.needsUpdate = true; };
  s.scale.set(size * 6, size, 1); s.set(text); return s;
}

// Console : retour LLM, sélection courante, journal d'événements
export function createConsole() {
  const W = 1024, H = 640, { g, t } = canvasTex(W, H);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.625), new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false }));
  const lines = []; let chat = '', focus = null, target = 'Qwen';
  const api = {
    mesh, pick: { type: 'console' },
    draw() {
      g.clearRect(0, 0, W, H);
      const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, 'rgba(18,24,54,.94)'); bg.addColorStop(1, 'rgba(8,10,26,.94)');
      g.fillStyle = bg; g.beginPath(); g.roundRect(0, 0, W, H, 36); g.fill();
      g.strokeStyle = 'rgba(120,150,255,.45)'; g.lineWidth = 3; g.stroke();
      g.textBaseline = 'alphabetic';
      // sélection
      g.font = '600 24px system-ui'; g.fillStyle = '#6b7aa8'; g.fillText('SÉLECTION', 36, 52);
      if (focus) {
        g.font = '700 38px system-ui'; g.fillStyle = focus.color || '#eaf0ff'; g.fillText(String(focus.title).slice(0, 40), 36, 100);
        g.font = '28px system-ui'; g.fillStyle = '#b7c3e8'; wrap(g, focus.text || '', 36, 142, W - 72, 36, 4);
      } else { g.font = '28px system-ui'; g.fillStyle = '#566083'; g.fillText('Vise une carte, une planète ou une étoile.', 36, 100); }
      // chat
      g.fillStyle = 'rgba(120,150,255,.25)'; g.fillRect(36, 300, W - 72, 2);
      g.font = '600 24px system-ui'; g.fillStyle = '#6b7aa8'; g.fillText('ASSISTANT', 36, 338);
      g.font = '28px system-ui'; g.fillStyle = '#ffd28a'; wrap(g, chat.slice(-420), 36, 378, W - 72, 36, 5);
      // journal
      g.font = '22px ui-monospace, monospace'; g.fillStyle = '#5fa889';
      lines.slice(-3).forEach((l, i) => g.fillText(l.slice(0, 70), 36, 560 + i * 26));
      g.font = '600 22px system-ui'; g.textAlign = 'right'; g.fillStyle = target === 'Qwen' ? '#ffd28a' : '#7fd6ff'; g.fillText('voix (grip) → ' + target, W - 36, 52); g.textAlign = 'left';
      t.needsUpdate = true;
    },
    push(s) { lines.push(s); api.draw(); },
    setChat(s) { chat = s; api.draw(); },
    setFocus(f) { focus = f; api.draw(); },
    setTarget(t) { if (t !== target) { target = t; api.draw(); } },
  };
  api.draw(); return api;
}
