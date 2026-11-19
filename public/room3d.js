import * as THREE from 'three';
import { textSprite } from './ui.js';

// Objets de la salle blanche d'une session : formes simples décrites en JSON, que l'on saisit et déplace à la manette.
export function createRoom(scene) {
  const group = new THREE.Group(); group.visible = false; scene.add(group);
  const NODE_SHAPES = ['db', 'api', 'server', 'queue', 'cache', 'browser', 'user', 'file', 'cloud'];
  const items = new Map(); // nom -> { spec, key, obj, hit }
  const STATE = { ok: '#38e08f', warn: '#ffb04a', error: '#ff5c70', idle: '#9aa4c0' };
  // objets de développement : formes génériques (aucune marque, aucune licence), l'état est un voyant coloré
  function buildNode(o, mat, s) {
    const g = new THREE.Group(), M = (geo, m = mat) => new THREE.Mesh(geo, m), dark = new THREE.MeshStandardMaterial({ color: 0x2b3350, roughness: 0.6 }), light = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
    if (o.shape === 'db') for (let i = 0; i < 3; i++) { const c = M(new THREE.CylinderGeometry(0.5, 0.5, 0.26, 32)); c.position.y = (i - 1) * 0.3; g.add(c); const ring = M(new THREE.CylinderGeometry(0.505, 0.505, 0.03, 32), light); ring.position.y = (i - 1) * 0.3 + 0.1; g.add(ring); }
    else if (o.shape === 'api') { const h = M(new THREE.CylinderGeometry(0.55, 0.55, 0.3, 6)); h.rotation.x = Math.PI / 2; g.add(h); const t = textSprite('</>', { size: 0.22, color: '#ffffff', font: '700 90px ui-monospace, monospace' }); t.position.z = 0.2; t.material.depthTest = true; g.add(t); }
    else if (o.shape === 'server') for (let i = 0; i < 3; i++) { const u = M(new THREE.BoxGeometry(1, 0.26, 0.6)); u.position.y = (i - 1) * 0.3; g.add(u); const led = M(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: 0x7dffb0 })); led.position.set(0.4, (i - 1) * 0.3, 0.31); g.add(led); }
    else if (o.shape === 'queue') { const p = M(new THREE.CylinderGeometry(0.28, 0.28, 1.1, 24)); p.rotation.z = Math.PI / 2; g.add(p); for (const x of [-0.35, 0, 0.35]) { const r2 = M(new THREE.TorusGeometry(0.29, 0.03, 8, 24), light); r2.rotation.y = Math.PI / 2; r2.position.x = x; g.add(r2); } }
    else if (o.shape === 'cache') { g.add(M(new THREE.OctahedronGeometry(0.55))); const c = M(new THREE.OctahedronGeometry(0.3), light); g.add(c); }
    else if (o.shape === 'browser') { g.add(M(new THREE.BoxGeometry(1.1, 0.8, 0.08))); const bar = M(new THREE.BoxGeometry(1.1, 0.14, 0.1), dark); bar.position.y = 0.33; g.add(bar); const pg = M(new THREE.BoxGeometry(0.95, 0.5, 0.1), light); pg.position.y = -0.06; g.add(pg); }
    else if (o.shape === 'user') { const hd = M(new THREE.SphereGeometry(0.25, 24, 16)); hd.position.y = 0.4; g.add(hd); const bd = M(new THREE.CapsuleGeometry(0.28, 0.3, 6, 16)); bd.position.y = -0.2; g.add(bd); }
    else if (o.shape === 'file') { g.add(M(new THREE.BoxGeometry(0.7, 0.9, 0.06))); for (let i = 0; i < 3; i++) { const l = M(new THREE.BoxGeometry(0.46, 0.05, 0.08), light); l.position.set(0, 0.15 - i * 0.18, 0.01); g.add(l); } }
    else /* cloud */ for (const [x, y, r2] of [[-0.3, -0.05, 0.3], [0.05, 0.12, 0.4], [0.38, -0.05, 0.28], [0.05, -0.1, 0.32]]) { const b = M(new THREE.SphereGeometry(r2, 20, 14)); b.position.set(x, y, 0); g.add(b); }
    g.scale.setScalar(s); const led = new THREE.Mesh(new THREE.SphereGeometry(0.06 * s / 0.3 * 0.5 + 0.02, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(STATE[o.state] || STATE.ok) })); led.position.set(0.55 * s, 0.65 * s, 0); g.add(led);
    return g;
  }
  // lien : tube entre deux objets par leur nom, impulsions dans le sens des données ; suit les objets quand on les déplace
  function buildLink(o) {
    const g = new THREE.Group(), col = new THREE.Color(o.state === 'ok' ? o.color : STATE[o.state] || o.color), mat = new THREE.MeshBasicMaterial({ color: col });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1, 8), mat); g.add(shaft);
    const pulses = [0, 1, 2].map((i) => { const p = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff })); p.userData.t = i / 3; g.add(p); return p; });
    let label = null; if (o.label) { label = textSprite(o.label, { size: 0.06, color: '#2b3350', font: '600 50px system-ui' }); label.material.depthTest = false; g.add(label); }
    g.userData.link = { shaft, pulses, label }; return { obj: g, hit: null, link: true };
  }
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  function updateLinks(dt) {
    for (const it of items.values()) { if (!it.link) continue; const o = it.spec, A = items.get(o.from), B = items.get(o.toName), L = it.obj.userData.link;
      const ok = !!A && !!B && !A.link && !B.link; it.obj.visible = ok; if (!ok) continue;
      _a.copy(A.obj.position); _b.copy(B.obj.position); _d.subVectors(_b, _a); const len = _d.length(); if (len < 0.05) { it.obj.visible = false; continue; } _d.normalize();
      const ra = (Array.isArray(A.spec.size) ? A.spec.size[0] : A.spec.size) * 0.65, rb = (Array.isArray(B.spec.size) ? B.spec.size[0] : B.spec.size) * 0.65; _a.addScaledVector(_d, ra); _b.addScaledVector(_d, -rb);
      const l2 = Math.max(0.02, _a.distanceTo(_b)); L.shaft.position.copy(_a).add(_b).multiplyScalar(0.5); L.shaft.scale.set(1, l2, 1); L.shaft.quaternion.setFromUnitVectors(_up, _d);
      const speed = o.state === 'idle' ? 0 : o.state === 'warn' ? 0.12 : o.state === 'error' ? 0 : 0.3, now = performance.now();
      for (const p of L.pulses) { p.userData.t = (p.userData.t + dt * speed / l2) % 1; p.visible = o.state !== 'idle'; p.position.lerpVectors(_a, _b, o.state === 'error' ? 0.5 : p.userData.t); if (o.state === 'error') p.visible = Math.floor(now / 350) % 2 === 0; }
      if (L.label) L.label.position.copy(_a).add(_b).multiplyScalar(0.5).add(new THREE.Vector3(0, 0.08, 0));
    }
  }
  function build(o) {
    if (o.shape === 'link') return buildLink(o);
    if (NODE_SHAPES.includes(o.shape)) { const sz0 = Array.isArray(o.size) ? o.size[0] : o.size, s = sz0 / 0.5 * 0.5, g = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(o.color), roughness: 0.5, metalness: 0.1 });
      const body = buildNode(o, mat, s); g.add(body); const hit = new THREE.Mesh(new THREE.BoxGeometry(1.2 * s, 1.2 * s, 0.8 * s), new THREE.MeshBasicMaterial()); hit.material.visible = false; g.add(hit);
      const l = textSprite(o.label || o.name, { size: 0.07, color: '#2b3350', font: '600 52px system-ui' }); l.position.y = 0.7 * s + 0.1; l.material.depthTest = false; g.add(l);
      g.position.set(...o.pos); g.rotation.set(...o.rot.map((d) => d * Math.PI / 180)); hit.userData.pick = { type: 'roomobj', name: o.name }; return { obj: g, hit }; }
    const col = new THREE.Color(o.color), mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide }), sz = Array.isArray(o.size) ? o.size : [o.size, o.size, o.size];
    const g = new THREE.Group(); let hit;
    if (o.shape === 'text') { const s = textSprite(o.text || o.label || o.name, { size: 0.12 * sz[0] / 0.3, color: '#' + col.getHexString(), font: '700 60px system-ui' }); s.material.depthTest = true; g.add(s); hit = new THREE.Mesh(new THREE.BoxGeometry(0.7 * sz[0] / 0.3, 0.14 * sz[0] / 0.3, 0.05), new THREE.MeshBasicMaterial()); hit.material.visible = false; g.add(hit); }
    else if (o.shape === 'arrow') { const a = new THREE.Vector3(...o.pos), b = new THREE.Vector3(...(o.to || [o.pos[0], o.pos[1], o.pos[2] - 1])), len = Math.max(0.05, a.distanceTo(b)), r = 0.015 * sz[0] / 0.3;
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len * 0.85, 12), mat), cone = new THREE.Mesh(new THREE.ConeGeometry(r * 3, len * 0.2, 16), mat); shaft.position.y = len * 0.425; cone.position.y = len * 0.95;
      const arrow = new THREE.Group(); arrow.add(shaft, cone); arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); g.add(arrow); hit = shaft; }
    else { const geo = o.shape === 'sphere' ? new THREE.SphereGeometry(0.5, 32, 20) : o.shape === 'cylinder' ? new THREE.CylinderGeometry(0.5, 0.5, 1, 32) : o.shape === 'plane' ? new THREE.PlaneGeometry(1, 1) : new THREE.BoxGeometry(1, 1, 1);
      hit = new THREE.Mesh(geo, mat); hit.scale.set(sz[0], o.shape === 'sphere' ? sz[0] : sz[1], o.shape === 'sphere' ? sz[0] : sz[2] || sz[0]); g.add(hit); }
    if (o.label) { const l = textSprite(o.label, { size: 0.07, color: '#2b3350', font: '600 52px system-ui' }); l.position.y = (o.shape === 'arrow' ? 0.1 : (sz[1] || sz[0]) / 2 + 0.12); l.material.depthTest = false; g.add(l); }
    g.position.set(...o.pos); if (o.shape === 'arrow') g.position.set(...o.pos); g.rotation.set(...o.rot.map((d) => d * Math.PI / 180));
    hit.userData.pick = { type: 'roomobj', name: o.name }; return { obj: g, hit };
  }
  const key = (o) => JSON.stringify([o.shape, o.color, o.size, o.rot, o.to, o.text, o.label, o.state, o.from, o.toName]);
  return {
    group,
    pickables() { return [...items.values()].filter((i) => i.hit).map((i) => i.hit); },
    update(dt) { updateLinks(dt); },
    get(name) { return items.get(name)?.obj; },
    // aligne les objets affichés sur la spec du serveur (l'objet en cours de déplacement n'est pas touché)
    apply(objects, holding) {
      const names = new Set(objects.map((o) => o.name));
      for (const [n, it] of items) if (!names.has(n)) { group.remove(it.obj); it.obj.traverse((x) => { x.geometry?.dispose(); x.material?.dispose?.(); }); items.delete(n); }
      for (const o of objects) { const cur = items.get(o.name);
        if (cur && cur.key === key(o)) { if (!cur.link && o.name !== holding) cur.obj.position.set(...o.pos); cur.spec = o; continue; }
        if (cur) { group.remove(cur.obj); cur.obj.traverse((x) => { x.geometry?.dispose(); x.material?.dispose?.(); }); }
        const b = build(o); group.add(b.obj); items.set(o.name, { spec: o, key: key(o), ...b }); }
    },
    clear() { this.apply([], null); },
    spec(name) { return items.get(name)?.spec; },
  };
}
