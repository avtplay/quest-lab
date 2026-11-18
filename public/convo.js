import * as THREE from 'three';
import { STATUS, canvasTex, ago } from './ui.js';
import { mdRows, drawRow } from './markdown.js';

// Panneau de conversation d'une session : toi / Claude / outils, du plus récent (en bas) au plus ancien (défilement).
const W = 1536, H = 960, TOP = 132, VIEW = H - TOP - 28;
function wrapLines(g, text, maxW) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const w of para.split(/\s+/)) {
      const t = line ? line + ' ' + w : w;
      if (g.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
    }
    lines.push(line);
  }
  return lines;
}
export function createConvo() {
  const { g, t } = canvasTex(W, H);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.9375), new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false }));
  mesh.position.set(0, 1.55, -1.35); mesh.visible = false;
  let msgs = null, scroll = 0, maxScroll = 0, key = '';
  const api = {
    mesh,
    setMessages(m) { msgs = m; key = ''; },
    reset() { msgs = null; scroll = 0; key = ''; },
    scrollBy(px) { scroll = Math.max(0, Math.min(maxScroll, scroll + px)); },
    draw(s, now) {
      const status = STATUS[s.status] || STATUS.idle, head = `${s.machine ? s.machine + ' · ' : ''}${s.ask ? 'demande ' + s.ask.tool : status.t} · ${ago(now - s.seen)}`;
      const pend = s.note && s.note.status === 'queued' && s.note.until > now ? s.note : null;
      const k = [s.name, s.listening, head, msgs?.length, msgs?.at(-1)?.text.length, Math.round(scroll), pend?.text, s.status].join('|'); if (k === key) return; key = k;
      g.clearRect(0, 0, W, H);
      const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, 'rgba(20,26,58,.95)'); bg.addColorStop(1, 'rgba(9,12,30,.95)');
      g.fillStyle = bg; g.beginPath(); g.roundRect(0, 0, W, H, 40); g.fill(); g.lineWidth = 4; g.strokeStyle = status.c + 'aa'; g.stroke();
      g.shadowColor = status.c; g.shadowBlur = 20; g.fillStyle = status.c; g.beginPath(); g.arc(64, 64, 18, 0, 7); g.fill(); g.shadowBlur = 0;
      g.textBaseline = 'alphabetic'; g.textAlign = 'left'; g.font = '700 54px system-ui'; g.fillStyle = '#eef2ff'; g.fillText(s.name.slice(0, 28), 100, 78);
      g.font = '28px system-ui'; g.fillStyle = s.ask ? STATUS.waiting.c : '#8c98c4'; g.fillText(head, 100, 112);
      g.fillStyle = 'rgba(120,150,255,.25)'; g.fillRect(40, TOP - 8, W - 80, 2);
      g.textAlign = 'right'; g.font = '22px system-ui'; g.fillStyle = '#566083'; g.fillText('stick : défiler', W - 50, 60); g.textAlign = 'left';
      if (!msgs || !msgs.length) { g.font = '32px system-ui'; g.fillStyle = '#7c88b4';
        g.fillText(msgs ? 'Aucun historique partagé par cette machine.' : 'Chargement…', 60, TOP + 70); if (msgs) { g.font = '26px system-ui'; g.fillText('Installe le hook avec --history pour le voir ici.', 60, TOP + 116); } t.needsUpdate = true; maxScroll = 0; return; }
      // mise en page : tout est converti en lignes, puis on affiche la fenêtre visible
      const rows = [], maxW = W - 140;
      for (const m of msgs) {
        if (m.role === 'tool') { g.font = '26px ui-monospace, monospace'; rows.push({ h: 38, text: '⚙ ' + wrapLines(g, m.text, maxW)[0].slice(0, 80), font: '26px ui-monospace, monospace', color: '#6f7aa5', x: 60 }); continue; }
        const user = m.role === 'user'; rows.push({ h: 42, text: user ? 'TOI' : 'CLAUDE', font: '700 26px system-ui', color: user ? '#7fd6ff' : '#ffd28a', x: 60, gap: 10 });
        rows.push(...mdRows(g, m.text, maxW, user ? '#e6ecff' : '#f1e8d6'));
        rows.push({ h: 12 });
      }
      if (pend) { rows.push({ h: 42, text: 'TOI · EN ATTENTE', font: '700 26px system-ui', color: '#7fd6ff', x: 60 });
        g.font = '34px system-ui'; for (const l of wrapLines(g, pend.text, maxW)) rows.push({ h: 46, text: l, font: '34px system-ui', color: '#9fb6d8', x: 60 });
        rows.push({ h: 40, text: s.listening ? 'Session à l\'écoute : elle la reçoit tout de suite.' : s.status === 'idle' ? 'La session est inactive : elle recevra ta consigne à son prochain tour.' : 'Livraison au prochain outil de la session.', font: 'italic 26px system-ui', color: '#8c98c4', x: 60 }); }
      const total = rows.reduce((a, r) => a + r.h, 0); maxScroll = Math.max(0, total - VIEW); scroll = Math.min(scroll, maxScroll);
      g.save(); g.beginPath(); g.rect(30, TOP, W - 60, VIEW); g.clip();
      let y = TOP + VIEW - total + scroll;
      for (const r of rows) { if (y + r.h > TOP - 10 && y < TOP + VIEW + 10) drawRow(g, r, y, maxW); y += r.h; }
      g.restore();
      if (maxScroll > 0) { const bh = Math.max(40, VIEW * VIEW / total), by = TOP + (VIEW - bh) * (1 - scroll / maxScroll); g.fillStyle = 'rgba(140,160,255,.35)'; g.beginPath(); g.roundRect(W - 30, by, 8, bh, 4); g.fill(); }
      t.needsUpdate = true;
    },
  };
  return api;
}
