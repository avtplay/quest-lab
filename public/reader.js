import * as THREE from 'three';
import { TYPE_COLOR, canvasTex } from './ui.js';
import { mdRows, drawRow } from './markdown.js';

// Lecteur de souvenir : titre, projet/type, description puis corps en Markdown, défilant du haut vers le bas.
const W = 1536, H = 960, TOP = 170, VIEW = H - TOP - 30;
export function createReader() {
  const { g, t } = canvasTex(W, H);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.75), new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false }));
  mesh.userData.pick = { type: 'reader' };
  let mem = null, scroll = 0, maxScroll = 0, dirty = true;
  const api = {
    mesh,
    get memory() { return mem; },
    set(m) { mem = m; scroll = 0; dirty = true; },
    scrollBy(px) { const v = Math.max(0, Math.min(maxScroll, scroll - px)); if (v !== scroll) { scroll = v; dirty = true; } },
    draw() {
      if (!dirty || !mem) return; dirty = false; const col = TYPE_COLOR[mem.type] || '#cfd8ff';
      g.clearRect(0, 0, W, H); const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, 'rgba(20,26,58,.96)'); bg.addColorStop(1, 'rgba(9,12,30,.96)');
      g.fillStyle = bg; g.beginPath(); g.roundRect(0, 0, W, H, 40); g.fill(); g.lineWidth = 4; g.strokeStyle = col + 'aa'; g.stroke();
      g.shadowColor = col; g.shadowBlur = 20; g.fillStyle = col; g.beginPath(); g.arc(64, 64, 18, 0, 7); g.fill(); g.shadowBlur = 0;
      g.textBaseline = 'alphabetic'; g.textAlign = 'left'; g.font = '700 50px system-ui'; g.fillStyle = '#eef2ff'; g.fillText(mem.name.slice(0, 34), 100, 76);
      g.font = '28px system-ui'; g.fillStyle = '#8c98c4'; g.fillText(`${mem.project} \u00b7 ${mem.type}${mem.size > mem.body.length ? ' \u00b7 extrait' : ''}`, 100, 112);
      if (mem.description) { g.font = 'italic 26px system-ui'; g.fillStyle = '#aab6e0'; let d = mem.description; while (d.length > 4 && g.measureText(d).width > W - 140) d = d.slice(0, -2); g.fillText(d + (d !== mem.description ? '\u2026' : ''), 60, 152); }
      g.fillStyle = 'rgba(120,150,255,.25)'; g.fillRect(40, TOP - 8, W - 80, 2);
      const rows = mdRows(g, mem.body || '(vide)', W - 140), total = rows.reduce((a, r) => a + r.h, 0); maxScroll = Math.max(0, total - VIEW); scroll = Math.min(scroll, maxScroll);
      g.save(); g.beginPath(); g.rect(30, TOP, W - 60, VIEW); g.clip(); let y = TOP - scroll;
      for (const r of rows) { if (y + r.h > TOP - 10 && y < TOP + VIEW + 10) drawRow(g, r, y, W - 140); y += r.h; } g.restore();
      if (maxScroll > 0) { const bh = Math.max(40, VIEW * VIEW / total), by = TOP + (VIEW - bh) * (scroll / maxScroll); g.fillStyle = 'rgba(140,160,255,.35)'; g.beginPath(); g.roundRect(W - 30, by, 8, bh, 4); g.fill(); }
      t.needsUpdate = true;
    },
  };
  return api;
}
