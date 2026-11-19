import * as THREE from 'three';
import { canvasTex, ago, wrap } from './ui.js';

// Fenêtres d'atelier : Changements (diffs), Sortie (commandes), Tâches (kanban) et Tableau de dessin.
const W = 1280, H = 800, TOP = 118, VIEW = H - TOP - 26, MONO = '24px ui-monospace, SFMono-Regular, Menlo, monospace';
const base = (p) => String(p || '').split('/').filter(Boolean).pop() || '?';
function shell(g, title, sub, color) {
  g.clearRect(0, 0, W, H); const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, 'rgba(20,26,58,.96)'); bg.addColorStop(1, 'rgba(9,12,30,.96)');
  g.fillStyle = bg; g.beginPath(); g.roundRect(0, 0, W, H, 36); g.fill(); g.lineWidth = 4; g.strokeStyle = color + 'aa'; g.stroke();
  g.shadowColor = color; g.shadowBlur = 18; g.fillStyle = color; g.beginPath(); g.arc(56, 58, 15, 0, 7); g.fill(); g.shadowBlur = 0;
  g.textBaseline = 'alphabetic'; g.textAlign = 'left'; g.font = '700 46px system-ui'; g.fillStyle = '#eef2ff'; g.fillText(title, 88, 70);
  g.font = '26px system-ui'; g.fillStyle = '#8c98c4'; let s = sub; while (s.length > 4 && g.measureText(s).width > W - 120) s = s.slice(0, -2); g.fillText(s, 88, 102);
  g.fillStyle = 'rgba(120,150,255,.25)'; g.fillRect(36, TOP - 6, W - 72, 2);
}
function mesh(t) { const m = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.75), new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false })); return m; }

// liste défilante, ancrée en bas (le plus récent visible) : kind = 'changes' | 'output'
export function createList(kind) {
  const { g, t } = canvasTex(W, H), m = mesh(t); let rows = [], total = 0, scroll = 0, maxScroll = 0, key = '', color = kind === 'changes' ? '#7be8b4' : '#7fd6ff';
  const title = kind === 'changes' ? 'Changements' : 'Sortie';
  return {
    mesh: m,
    scrollBy(px) { scroll = Math.max(0, Math.min(maxScroll, scroll + px)); },
    draw(s, d, now) {
      const items = (d && (kind === 'changes' ? d.changes : d.output)) || [], last = items.at(-1);
      const k = [s?.name, items.length, last?.t, Math.round(scroll)].join('|'); if (k === key) return; key = k;
      rows = [];
      for (const it of items) {
        if (kind === 'changes') { rows.push({ h: 44, text: `${base(it.file)}  ·  ${it.tool}  ·  ${ago(now - it.t)}`, font: '700 27px system-ui', color: '#ffd28a', gap: 8 });
          for (const l of it.diff.split('\n')) rows.push({ h: 32, text: l, font: MONO, color: l.startsWith('+') ? '#7be8b4' : l.startsWith('-') ? '#ff8da0' : '#6f7aa5' }); }
        else { rows.push({ h: 44, text: '$ ' + it.cmd.replace(/\s+/g, ' '), font: '700 26px ui-monospace, monospace', color: '#7fd6ff', gap: 8 });
          for (const l of it.out.split('\n').slice(-10)) rows.push({ h: 32, text: l, font: MONO, color: it.error ? '#ff8da0' : '#9fb0d8' }); }
        rows.push({ h: 16 });
      }
      shell(g, title, s ? `${s.name}${items.length ? '' : ' · rien pour l\'instant'}` : 'aucune session', color);
      if (!items.length) { g.font = '28px system-ui'; g.fillStyle = '#7c88b4'; g.fillText('Rien pour l\'instant : les outils de la session apparaissent ici (machine installée avec --history).', 50, TOP + 60); t.needsUpdate = true; return; }
      total = rows.reduce((a, r) => a + r.h, 0); maxScroll = Math.max(0, total - VIEW); scroll = Math.min(scroll, maxScroll);
      g.save(); g.beginPath(); g.rect(30, TOP, W - 60, VIEW); g.clip(); let y = TOP + VIEW - total + scroll;
      for (const r of rows) { if (r.text && y + r.h > TOP - 10 && y < TOP + VIEW + 10) { g.font = r.font; g.fillStyle = r.color; let tx = r.text; while (tx.length > 4 && g.measureText(tx).width > W - 110) tx = tx.slice(0, -3) + '…'; g.fillText(tx, 52, y + r.h - 8); } y += r.h; }
      g.restore();
      if (maxScroll > 0) { const bh = Math.max(40, VIEW * VIEW / total), by = TOP + (VIEW - bh) * (1 - scroll / maxScroll); g.fillStyle = 'rgba(140,160,255,.35)'; g.beginPath(); g.roundRect(W - 26, by, 8, bh, 4); g.fill(); }
      t.needsUpdate = true;
    },
  };
}

// kanban : à faire / en cours / fait, d'après la liste de tâches de Claude
export function createKanban() {
  const { g, t } = canvasTex(W, H), m = mesh(t); let key = '', scroll = 0, maxScroll = 0;
  const COLS = [['pending', 'À faire', '#a99bff'], ['in_progress', 'En cours', '#ffd28a'], ['completed', 'Fait', '#7be8b4']];
  return {
    mesh: m,
    scrollBy(px) { scroll = Math.max(0, Math.min(maxScroll, scroll + px)); },
    draw(s, d) {
      const todos = d?.todos; const k = [s?.name, JSON.stringify(todos), Math.round(scroll)].join('|'); if (k === key) return; key = k;
      shell(g, 'Tâches', s ? `${s.name}${todos ? ` · ${todos.length} tâche${todos.length > 1 ? 's' : ''}` : ''}` : 'aucune session', '#a99bff');
      if (!todos) { g.font = '28px system-ui'; g.fillStyle = '#7c88b4'; g.fillText('Pas encore de liste : elle apparaît quand Claude en crée une (dis-lui « ajoute une tâche : … »).', 50, TOP + 60); t.needsUpdate = true; return; }
      const cw = (W - 100) / 3; let worst = 0;
      g.save(); g.beginPath(); g.rect(20, TOP, W - 40, VIEW + 20); g.clip();
      COLS.forEach(([st, label, col], i) => {
        const x = 40 + i * (cw + 10), items = todos.filter((x2) => x2.status === st); let y = TOP + 14 - scroll;
        g.font = '700 30px system-ui'; g.fillStyle = col; g.fillText(`${label} (${items.length})`, x + 8, y + 28); y += 46;
        for (const it of items) { g.font = '26px system-ui'; const words = it.content.split(/\s+/), lines = []; let ln = '';
          for (const w of words) { const tt = ln ? ln + ' ' + w : w; if (g.measureText(tt).width > cw - 50 && ln) { lines.push(ln); ln = w; } else ln = tt; } lines.push(ln);
          const hh = Math.min(lines.length, 5) * 34 + 24; g.fillStyle = 'rgba(40,48,96,.85)'; g.beginPath(); g.roundRect(x, y, cw, hh, 16); g.fill(); g.fillStyle = col; g.fillRect(x, y + 10, 6, hh - 20);
          g.fillStyle = st === 'completed' ? '#8c98c4' : '#eef2ff'; lines.slice(0, 5).forEach((l, j) => g.fillText(l + (j === 4 && lines.length > 5 ? '…' : ''), x + 20, y + 36 + j * 34)); y += hh + 10; }
        worst = Math.max(worst, y + scroll);
      });
      g.restore(); maxScroll = Math.max(0, worst - (TOP + VIEW)); scroll = Math.min(scroll, maxScroll); t.needsUpdate = true;
    },
  };
}

// tableau de dessin : le contrôleur trace, « Envoyer » transmet l'image à la session
export function createBoard() {
  const { c, g, t } = canvasTex(W, H), m = mesh(t); let color = '#ffffff', last = null, key = '';
  const BAR = 110, COLORS = ['#ffffff', '#7fd6ff', '#ffd28a', '#ff8da0'], btn = [];
  const bg = () => { g.fillStyle = '#0d1230'; g.fillRect(0, BAR, W, H - BAR); };
  function bar() { g.fillStyle = 'rgba(20,26,58,.98)'; g.fillRect(0, 0, W, BAR); g.fillStyle = 'rgba(120,150,255,.35)'; g.fillRect(0, BAR - 2, W, 2);
    g.textBaseline = 'middle'; g.textAlign = 'left'; g.font = '700 40px system-ui'; g.fillStyle = '#eef2ff'; g.fillText('Tableau', 30, BAR / 2);
    btn.length = 0; COLORS.forEach((col, i) => btn.push({ x0: 250 + i * 90, x1: 322 + i * 90, color: col })); btn.push({ x0: 700, x1: 900, action: 'clear', label: 'Effacer' }, { x0: 940, x1: 1250, action: 'send', label: 'Envoyer à Claude' });
    for (const b of btn) { if (b.color) { g.fillStyle = b.color; g.beginPath(); g.arc((b.x0 + b.x1) / 2, BAR / 2, 30, 0, 7); g.fill(); if (b.color === color) { g.strokeStyle = '#fff'; g.lineWidth = 5; g.beginPath(); g.arc((b.x0 + b.x1) / 2, BAR / 2, 38, 0, 7); g.stroke(); } }
      else { g.fillStyle = b.action === 'send' ? '#38e08f' : '#8d97c4'; g.beginPath(); g.roundRect(b.x0, 16, b.x1 - b.x0, 78, 20); g.fill(); g.fillStyle = '#0b0f20'; g.font = '700 30px system-ui'; g.textAlign = 'center'; g.fillText(b.label, (b.x0 + b.x1) / 2, BAR / 2); } } }
  const clear = () => { bg(); bar(); t.needsUpdate = true; }; clear();
  const xy = (uv) => [uv.x * W, (1 - uv.y) * H];
  return {
    mesh: m,
    clear,
    // appui : renvoie 'clear' | 'send' | null ; sinon commence un trait
    press(uv) { const [x, y] = xy(uv);
      if (y < BAR) { const b = btn.find((k) => x >= k.x0 && x <= k.x1); if (b?.color) { color = b.color; bar(); t.needsUpdate = true; } return b?.action || null; }
      last = [x, y]; g.fillStyle = color; g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); t.needsUpdate = true; return null; },
    move(uv) { if (!last) return; const [x, y] = xy(uv); if (y < BAR + 4) return; g.strokeStyle = color; g.lineWidth = 6; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); g.moveTo(...last); g.lineTo(x, y); g.stroke(); last = [x, y]; t.needsUpdate = true; },
    release() { last = null; },
    // affiche un schéma (nœuds + liens) ; efface les traits, une seule fois par version du schéma
    showDiagram(sid, dg) { const k = dg ? sid + ':' + dg.t : sid + ':-'; if (k === key) return; key = k; clear(); if (dg) drawDiagram(g, dg, W, BAR, H); t.needsUpdate = true; },
    get drawing() { return !!last; },
    toBlob() { const o = document.createElement('canvas'); o.width = W; o.height = H - BAR; o.getContext('2d').drawImage(c, 0, BAR, W, H - BAR, 0, 0, W, H - BAR); return new Promise((r) => o.toBlob(r, 'image/png')); },
  };
}

// mise en page par couches (de gauche à droite) : une couche = plus long chemin depuis les sources
function drawDiagram(g, dg, W, top, H) {
  const nodes = dg.nodes, n = nodes.length; if (!n) return; const idx = new Map(nodes.map((x, i) => [x.id, i])), links = dg.links.filter((l) => idx.has(l.from) && idx.has(l.to) && l.from !== l.to);
  const layer = new Array(n).fill(0); for (let it = 0; it < n; it++) { let ch = false; for (const l of links) { const a = idx.get(l.from), b = idx.get(l.to); if (layer[b] < layer[a] + 1 && layer[a] + 1 < n) { layer[b] = layer[a] + 1; ch = true; } } if (!ch) break; }
  const L = Math.max(...layer) + 1, cols = Array.from({ length: L }, () => []); nodes.forEach((x, i) => cols[layer[i]].push(i));
  const padX = 40, padY = 56, cw = (W - padX * 2) / L, bw = Math.min(260, cw - 60), bh = 76, pos = [];
  if (dg.title) { g.font = '700 34px system-ui'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = '#eef2ff'; g.fillText(dg.title, 36, top + 42); }
  cols.forEach((c, li) => c.forEach((i, k) => { const ch = (H - top - padY - 30) / c.length; pos[i] = { x: padX + (li + 0.5) * cw, y: top + padY + 20 + (k + 0.5) * ch }; }));
  const PAL = ['#4f8cff', '#38c98a', '#ff9f5a', '#a07cff', '#ff6b8b', '#35c2d8', '#d4b84a'];
  const edge = (p, q) => { const dx = q.x - p.x, dy = q.y - p.y, k = Math.min((bw / 2 + 6) / Math.abs(dx || 1e-9), (bh / 2 + 6) / Math.abs(dy || 1e-9)); return { x: p.x + dx * k, y: p.y + dy * k }; };
  g.lineWidth = 3; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const l of links) { const p = pos[idx.get(l.from)], q = pos[idx.get(l.to)], a = edge(p, q), b = edge(q, p); g.strokeStyle = '#8aa2ff'; g.fillStyle = '#8aa2ff';
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); const ang = Math.atan2(b.y - a.y, b.x - a.x);
    g.beginPath(); g.moveTo(b.x, b.y); g.lineTo(b.x - 16 * Math.cos(ang - 0.4), b.y - 16 * Math.sin(ang - 0.4)); g.lineTo(b.x - 16 * Math.cos(ang + 0.4), b.y - 16 * Math.sin(ang + 0.4)); g.closePath(); g.fill();
    if (l.label) { g.font = '600 22px system-ui'; const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, tw = g.measureText(l.label).width + 16; g.fillStyle = '#0d1230'; g.beginPath(); g.roundRect(mx - tw / 2, my - 16, tw, 32, 10); g.fill(); g.fillStyle = '#cdd6ff'; g.fillText(l.label, mx, my + 1); } }
  nodes.forEach((x, i) => { const p = pos[i], col = x.color || PAL[i % PAL.length]; g.fillStyle = col; g.beginPath(); g.roundRect(p.x - bw / 2, p.y - bh / 2, bw, bh, 18); g.fill();
    g.fillStyle = '#0b0f20'; g.font = '700 26px system-ui'; const words = x.label.split(/\s+/), lines = []; let ln = ''; for (const w of words) { const tt = ln ? ln + ' ' + w : w; if (g.measureText(tt).width > bw - 24 && ln) { lines.push(ln); ln = w; } else ln = tt; } lines.push(ln);
    lines.slice(0, 2).forEach((l, j, a) => g.fillText(l, p.x, p.y + (j - (a.length - 1) / 2) * 30)); });
}
