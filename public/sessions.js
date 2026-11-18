import * as THREE from 'three';
import { STATUS, canvasTex, wrap, ago, glowSprite, textSprite } from './ui.js';

// ---- Arc de cartes (gestion) + orrery (vue d'ensemble) ----
const CW = 640, CH = 320;
function makeCard(s) {
  const { c, g, t } = canvasTex(CW, CH);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.4), new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false }));
  mesh.userData.pick = { type: 'session', id: s.id }; mesh.scale.setScalar(0.01);
  const card = { mesh, target: new THREE.Vector3(), rotY: 0, drawn: '', hover: false, selected: false };
  card.draw = (st, now) => {
    const key = [st.name, st.status, st.detail, card.hover, card.selected, Math.floor((now - st.seen) / 1000 / (now - st.seen > 60000 ? 30 : 1))].join('|');
    if (key === card.drawn) return; card.drawn = key;
    const S = STATUS[st.status] || STATUS.idle;
    g.clearRect(0, 0, CW, CH);
    const bg = g.createLinearGradient(0, 0, 0, CH); bg.addColorStop(0, card.hover ? 'rgba(34,44,96,.96)' : 'rgba(20,26,58,.93)'); bg.addColorStop(1, 'rgba(9,12,30,.93)');
    g.fillStyle = bg; g.beginPath(); g.roundRect(4, 4, CW - 8, CH - 8, 30); g.fill();
    g.lineWidth = card.selected ? 7 : card.hover ? 5 : 3; g.strokeStyle = card.selected || card.hover ? S.c : S.c + '88'; g.stroke();
    g.shadowColor = S.c; g.shadowBlur = 22; g.fillStyle = S.c; g.beginPath(); g.arc(52, 62, 15, 0, 7); g.fill(); g.shadowBlur = 0;
    g.textBaseline = 'alphabetic'; g.font = '700 50px system-ui'; g.fillStyle = '#eef2ff'; g.fillText(st.name.slice(0, 22), 84, 76);
    g.font = '600 32px system-ui'; g.fillStyle = S.c; g.fillText(S.t, 84, 114);
    g.font = '32px system-ui'; g.fillStyle = '#c4cef0'; wrap(g, st.detail || '—', 34, 180, CW - 68, 40, 3);
    g.font = '26px system-ui'; g.fillStyle = '#7a86ab'; g.fillText((st.kind === 'claude-code' ? 'Claude Code' : (st.kind || 'agent')) + (st.machine ? ' · ' + st.machine : ''), 34, CH - 28);
    g.textAlign = 'right'; g.fillText(ago(now - st.seen), CW - 34, CH - 28); g.textAlign = 'left';
    t.needsUpdate = true;
  };
  return card;
}

export function createSessions(scene) {
  const sessions = new Map(), cards = new Map(), planets = new Map();
  const arc = new THREE.Group(), orrery = new THREE.Group(); scene.add(arc, orrery);
  let selected = null, hoverId = null, orbitCount = 0;

  // piédestal de l'orrery
  orrery.position.set(-0.85, 1.0, -0.7); orrery.scale.setScalar(1.5);
  const base = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.25, 64), new THREE.MeshBasicMaterial({ color: 0x7a95ff, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
  base.rotation.x = -Math.PI / 2; base.position.y = -0.12; orrery.add(base);
  const sun = new THREE.Mesh(new THREE.SphereGeometry(0.018, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffe9b0 })); orrery.add(sun, glowSprite(0xffd890, 0.16, 0.7));
  const title = textSprite('SESSIONS', { size: 0.045, color: '#8aa2ff', font: '600 40px system-ui', opacity: 0.8 }); title.position.y = -0.16; orrery.add(title);

  function addPlanet(s, i) {
    const grp = new THREE.Group(), r = 0.08 + i * 0.035;
    const orbit = new THREE.Mesh(new THREE.RingGeometry(r - 0.0006, r + 0.0006, 96), new THREE.MeshBasicMaterial({ color: 0x5870c8, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    orbit.rotation.x = -Math.PI / 2; orrery.add(orbit);
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.012, 14, 10), new THREE.MeshBasicMaterial({ color: 0x7d9bd0 }));
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial()); hit.material.visible = false; hit.userData.pick = { type: 'session', id: s.id };
    const glow = glowSprite(0x7d9bd0, 0.07, 0.8), lab = textSprite(s.name, { size: 0.028, font: '600 44px system-ui', opacity: 0.85 }); lab.position.y = 0.03;
    body.add(glow); grp.add(body, hit, lab); grp.userData = { orbit, r, ph: Math.random() * 6.28, sp: 0.5 / Math.sqrt(r * 20), body, glow, lab, hit }; orrery.add(grp); planets.set(s.id, grp);
  }

  function relayout() {
    const list = [...sessions.values()]; const per = 5, R = 1.7;
    list.forEach((s, i) => {
      const row = Math.floor(i / per), inRow = Math.min(per, list.length - row * per), k = i % per;
      const a = (k - (inRow - 1) / 2) * 0.5;
      const card = cards.get(s.id); card.target.set(Math.sin(a) * R, 1.5 + row * 0.46, -Math.cos(a) * R); card.rotY = -a;
    });
  }

  const api = {
    arc, orrery, sessions,
    upsert(e) {
      let s = sessions.get(e.id);
      if (!s) {
        s = { id: e.id, name: e.label || e.id, status: 'idle', detail: '', kind: e.kind, machine: e.machine, seen: e.t || Date.now() }; sessions.set(e.id, s);
        const card = makeCard(s); card.mesh.position.set(0, 1.5, -1.9); arc.add(card.mesh); cards.set(e.id, card); addPlanet(s, orbitCount++ % 8); relayout();
      }
      if (e.label) s.name = e.label; if (e.status) s.status = e.status; if (e.detail !== undefined) s.detail = e.detail; if (e.machine) s.machine = e.machine; s.seen = e.t || Date.now();
      const p = planets.get(e.id); if (p) { const col = new THREE.Color(STATUS[s.status]?.c || '#7d9bd0'); p.userData.body.material.color.copy(col); p.userData.glow.material.color.copy(col); p.userData.pulse = 1; }
      return s;
    },
    remove(id) {
      const c = cards.get(id); if (c) { arc.remove(c.mesh); c.mesh.material.map.dispose(); cards.delete(id); }
      const p = planets.get(id); if (p) { orrery.remove(p); orrery.remove(p.userData.orbit); planets.delete(id); }
      sessions.delete(id); if (selected === id) selected = null;
      relayout();
    },
    select(id) { selected = id; }, hover(id) { hoverId = id; }, get selected() { return selected; },
    pickables() { const out = []; cards.forEach((c) => arc.visible && out.push(c.mesh)); planets.forEach((p) => orrery.visible && out.push(p.userData.hit)); return out; },
    update(dt, now) {
      cards.forEach((c, id) => {
        const st = sessions.get(id); c.hover = hoverId === id; c.selected = selected === id;
        c.mesh.position.lerp(c.target, Math.min(1, dt * 5)); c.mesh.rotation.y += (c.rotY - c.mesh.rotation.y) * Math.min(1, dt * 5);
        const sc = (c.selected ? 1.12 : c.hover ? 1.06 : 1); c.mesh.scale.setScalar(THREE.MathUtils.lerp(c.mesh.scale.x, sc, Math.min(1, dt * 8)));
        c.draw(st, now);
      });
      planets.forEach((p, id) => {
        const u = p.userData, st = sessions.get(id); u.ph += dt * u.sp * (st.status === 'working' ? 2.2 : st.status === 'idle' ? 0.5 : 1);
        p.position.set(Math.cos(u.ph) * u.r, 0, Math.sin(u.ph) * u.r);
        u.pulse = Math.max(0, (u.pulse || 0) - dt * 1.5);
        const sc = 1 + u.pulse * 0.9 + (st.status === 'waiting' ? 0.4 * Math.abs(Math.sin(now / 250)) : 0) + (selected === id || hoverId === id ? 0.5 : 0);
        u.body.scale.setScalar(sc);
      });
    },
  };
  return api;
}
