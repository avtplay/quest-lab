import * as THREE from 'three';
import { TYPE_COLOR, glowSprite, textSprite } from './ui.js';

// Constellations de mémoire : un amas par projet, une étoile par souvenir, des liens [[...]].
function rng(seed) { let a = 0; for (const ch of seed) a = (a * 31 + ch.charCodeAt(0)) >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export function createMemory(scene) {
  const root = new THREE.Group(); scene.add(root);
  const MINI = { pos: new THREE.Vector3(0.85, 1.0, -0.7), scale: 0.11 }, FULL = { pos: new THREE.Vector3(0, 1.45, 0), scale: 1 };
  root.position.copy(MINI.pos); root.scale.setScalar(MINI.scale);
  const stars = [], hits = [], clusters = {}; let expanded = false, hover = null, selected = null, data = [];
  // navigation : l'amas visé est amené devant l'utilisateur ; stick = tourner / avancer, ✕ amas = tout revoir
  const view = { yaw: 0, pos: FULL.pos.clone() }; let filter = { q: '', types: new Set(), n: 0 }; const norm = (x) => String(x).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // portail (miniature cliquable)
  const portal = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), new THREE.MeshBasicMaterial()); portal.material.visible = false; portal.userData.pick = { type: 'memory-open' };
  const portalHolder = new THREE.Group(); portalHolder.position.copy(MINI.pos); portalHolder.scale.setScalar(1.5); scene.add(portalHolder); portalHolder.add(portal);
  portal.position.set(0, 0, 0);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.25, 64), new THREE.MeshBasicMaterial({ color: 0x7a95ff, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = -0.12; portalHolder.add(ring);
  const title = textSprite('MÉMOIRE', { size: 0.045, color: '#8aa2ff', font: '600 40px system-ui', opacity: 0.8 }); title.position.y = -0.16; portalHolder.add(title);
  const tip = textSprite('', { size: 0.12, font: '600 46px system-ui' }); tip.visible = false; root.add(tip);

  async function load() {
    try { data = (await (await fetch('/api/memory')).json()).memories; } catch { data = []; }
    root.children.filter((c) => c.userData.mem).forEach((c) => root.remove(c)); stars.length = 0; hits.length = 0; for (const k in clusters) delete clusters[k];
    const projects = [...new Set(data.map((m) => m.cluster || m.project))], P = projects.length, centers = {};
    projects.forEach((p, i) => { // amas répartis en arc devant l'utilisateur (jamais au-dessus de la tête)
      const span = Math.min(Math.PI * 2, P * 1.1), a = P === 1 ? 0 : (i / (P - 1) - 0.5) * span * (P - 1) / P, y = 0.25 + ((i % 2) * 2 - 1) * 0.35;
      centers[p] = new THREE.Vector3(Math.sin(a) * 2.4, y, -Math.cos(a) * 2.4); clusters[p] = { c: centers[p], a }; });
    const hue = (p) => (([...p].reduce((s, c) => s + c.charCodeAt(0), 0) * 47) % 360) / 360;
    projects.forEach((p) => {
      const c = centers[p], col = new THREE.Color().setHSL(hue(p), 0.7, 0.6);
      const neb = glowSprite(col, 2.4, 0.2); neb.position.copy(c); neb.userData.mem = 1; root.add(neb);
      const lab = textSprite(p, { size: 0.16, color: '#' + col.clone().offsetHSL(0, 0, 0.15).getHexString(), font: '700 56px system-ui' }); lab.position.copy(c).add(new THREE.Vector3(0, 0.85, 0)); lab.userData.mem = 1; root.add(lab);
      const lh = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshBasicMaterial()); lh.material.visible = false; lh.position.copy(lab.position); lh.userData.mem = 1; lh.userData.pick = { type: 'cluster', name: p }; root.add(lh); hits.push(lh);
    });
    const byName = new Map(); data.forEach((m) => { byName.set(m.file, m); byName.set(m.name, m); });
    data.forEach((m) => {
      const rnd = rng(m.id), c = centers[m.cluster || m.project], u = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize().multiplyScalar(0.3 + rnd() * 0.5);
      const col = new THREE.Color(TYPE_COLOR[m.type] || '#cfd8ff'), size = 0.04 + Math.min(0.05, m.size / 20000);
      const grp = new THREE.Group(); grp.position.copy(c).add(u); grp.userData.mem = 1;
      const core = new THREE.Mesh(new THREE.SphereGeometry(size, 14, 10), new THREE.MeshBasicMaterial({ color: col }));
      const hit = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshBasicMaterial()); hit.material.visible = false; hit.userData.pick = { type: 'memory', id: m.id };
      const gl = glowSprite(col, size * 7, 0.7); grp.add(core, gl, hit); root.add(grp);
      stars.push({ m, grp, core, gl, ph: rnd() * 6.28, size, hay: norm([m.name, m.description, m.project, m.type, m.body].join(' ')) }); hits.push(hit);
    });
    const pts = []; stars.forEach((s) => s.m.links.forEach((l) => { const t = byName.get(l); const o = t && stars.find((x) => x.m === t); if (o) pts.push(s.grp.position.x, s.grp.position.y, s.grp.position.z, o.grp.position.x, o.grp.position.y, o.grp.position.z); }));
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x8ea4ff, transparent: true, opacity: 0.45 })); lines.userData.mem = 1; root.add(lines);
    return data.length;
  }

  const api = {
    load, root, portal, holder: portalHolder,
    get expanded() { return expanded; },
    setExpanded(v) { expanded = v; hover = null; tip.visible = false; api.resetView(); if (!v) api.setFilter('', []); },
    clusters: () => Object.keys(clusters),
    focusCluster(name) { const k = clusters[name]; if (!k) return; view.yaw = k.a; view.pos.set(0, 1.4 - k.c.y, 1.2); },
    resetView() { view.yaw = 0; view.pos.copy(FULL.pos); },
    nudge(dyaw, dz) { view.yaw += dyaw; view.pos.z = Math.max(-1.5, Math.min(2.2, view.pos.z + dz)); },
    get filter() { return filter; },
    // recherche : tous les mots doivent apparaître (sans accents) ; types : liste vide = tous. Renvoie le nombre de souvenirs trouvés.
    setFilter(q, types) {
      const words = norm(q).split(/[^a-z0-9]+/).filter((w) => w.length > 1); filter = { q: String(q).trim(), types: new Set(types), n: 0 };
      const on = words.length || filter.types.size; let first = null;
      for (const s of stars) { s.dim = !!on && !(words.every((w) => s.hay.includes(w)) && (!filter.types.size || filter.types.has(s.m.type))); if (on && !s.dim) { filter.n++; first ??= s; } }
      if (!on) filter.n = stars.length; else if (first) { const own = new Set(stars.filter((s) => !s.dim).map((s) => s.m.cluster || s.m.project)); if (own.size === 1) api.focusCluster([...own][0]); }
      return filter.n;
    },
    pickables() { return expanded ? hits : [portal]; },
    hoverStar(id) { hover = id; const s = stars.find((x) => x.m.id === id); if (s) { tip.set(s.m.name.slice(0, 34)); tip.position.copy(s.grp.position).add(new THREE.Vector3(0, 0.2, 0)); tip.visible = true; } else tip.visible = false; },
    select(id) { selected = id; }, find: (id) => data.find((m) => m.id === id),
    update(dt, now) {
      MINI.pos.copy(portalHolder.position); MINI.scale = 0.11 * portalHolder.scale.x / 1.5; // la miniature suit le portail quand on le déplace ou le redimensionne
      const T = expanded ? FULL : MINI;
      if (!expanded) root.position.lerp(T.pos, Math.min(1, dt * 3.5)); root.scale.setScalar(THREE.MathUtils.lerp(root.scale.x, T.scale, Math.min(1, dt * 3.5)));
      portalHolder.visible = !expanded;
      if (!expanded) { root.rotation.y += dt * 0.25; root.rotation.y %= Math.PI * 2; }
      else { const d = ((view.yaw - root.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI; root.rotation.y += d * Math.min(1, dt * 3); root.position.lerp(view.pos, Math.min(1, dt * 3)); }
      stars.forEach((s) => { const k = 1 + 0.12 * Math.sin(now / 700 + s.ph) + (hover === s.m.id || selected === s.m.id ? 0.7 : 0), q = s.dim ? 0.45 : 1; s.core.scale.setScalar(k * q); s.gl.scale.setScalar(s.size * 7 * k * q); s.gl.material.opacity = s.dim ? 0.08 : 0.7; s.core.material.opacity = s.dim ? 0.3 : 1; s.core.material.transparent = !!s.dim; });
    },
  };
  return api;
}
