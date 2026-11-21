import * as THREE from 'three';
import { canvasTex } from './ui.js';

// Fenêtre « Web » : image du navigateur de développement d'une session (lecture seule), mise à jour environ 4 fois par seconde.
const W = 1280, H = 800, BAR = 64;
export function createWeb() {
  const { g, t } = canvasTex(W, H), mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.75), new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false }));
  let sid = null, rev = 0, active = false, busy = false, last = 0, painted = 0, meta = { url: '', title: '', at: 0 }, bmp = null, dirty = true;
  function paint() {
    g.clearRect(0, 0, W, H); g.fillStyle = '#0b0f24'; g.beginPath(); g.roundRect(0, 0, W, H, 28); g.fill();
    g.save(); g.beginPath(); g.roundRect(0, BAR, W, H - BAR, [0, 0, 28, 28]); g.clip();
    if (bmp) g.drawImage(bmp, 0, BAR, W, H - BAR); g.restore();
    g.fillStyle = '#161c3d'; g.beginPath(); g.roundRect(0, 0, W, BAR, [28, 28, 0, 0]); g.fill();
    const age = meta.at ? Math.round((Date.now() - meta.at) / 1000) : null, live = age !== null && age < 30;
    g.fillStyle = live ? '#38e08f' : '#7c88b4'; g.beginPath(); g.arc(38, BAR / 2, 11, 0, 7); g.fill();
    g.textBaseline = 'middle'; g.textAlign = 'left'; g.font = '600 28px system-ui'; g.fillStyle = '#eef2ff';
    let s = (meta.title ? meta.title + '  ·  ' : '') + (meta.url || '…'); while (s.length > 6 && g.measureText(s).width > W - 250) s = s.slice(0, -2);
    g.fillText(s, 64, BAR / 2 + 1); g.textAlign = 'right'; g.font = '24px system-ui'; g.fillStyle = '#8c98c4'; g.fillText(live ? 'lecture seule' : `arrêté depuis ${age ?? '?'} s`, W - 28, BAR / 2 + 1);
    g.strokeStyle = 'rgba(120,150,255,.35)'; g.lineWidth = 4; g.beginPath(); g.roundRect(2, 2, W - 4, H - 4, 28); g.stroke(); t.needsUpdate = true; dirty = false; painted = Date.now();
  }
  async function poll(id) { // une requête à la fois ; 204 = rien de neuf, 404 = pas de navigateur pour cette session
    busy = true; last = Date.now();
    try { const r = await fetch(`/api/web?id=${encodeURIComponent(id)}&rev=${rev}`, { cache: 'no-store' });
      if (r.status === 404) { if (active) { active = false; dirty = true; } }
      else if (r.ok || r.status === 204) { active = true; meta.at = +r.headers.get('x-at') || meta.at; dirty = true;
        if (r.status === 200) { rev = +r.headers.get('x-rev') || rev; meta.url = decodeURIComponent(r.headers.get('x-url') || ''); meta.title = decodeURIComponent(r.headers.get('x-title') || ''); const b = await createImageBitmap(await r.blob()); bmp?.close?.(); bmp = b; } } } catch {}
    busy = false;
  }
  return { mesh, scrollBy() {}, get active() { return active; },
    // renvoie vrai quand une image existe pour cette session
    draw(s) { const id = s?.id ?? null; if (id !== sid) { sid = id; rev = 0; active = false; bmp?.close?.(); bmp = null; meta = { url: '', title: '', at: 0 }; dirty = true; }
      if (id && !busy && Date.now() - last > (active ? 250 : 2000)) poll(id);
      if (dirty || (active && Date.now() - painted > 1000)) paint(); return active; } };
}
