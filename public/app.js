import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildEnvironment } from './env.js';
import { createConsole, canvasTex, STATUS, TYPE_COLOR, ago } from './ui.js';
import { createSessions } from './sessions.js';
import { createMemory } from './memory.js';

const clog = (m) => { try { fetch('/api/clientlog', { method: 'POST', body: String(m).slice(0, 1500), keepalive: true }); } catch {} };
addEventListener('error', (e) => clog(`ERR ${e.message} @${e.filename}:${e.lineno}`));
addEventListener('unhandledrejection', (e) => clog('REJ ' + (e.reason?.stack || e.reason)));
clog('page chargée · ' + navigator.userAgent);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true; document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer, { optionalFeatures: ['hand-tracking'] }));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 100); camera.position.set(0, 1.6, 1.3);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 1.25, -1.5); controls.update();

const env = buildEnvironment(scene);
const log = createConsole(); log.mesh.position.set(0, 0.92, -0.78); log.mesh.rotation.x = -0.7; log.mesh.userData.pick = log.pick; scene.add(log.mesh);
const sess = createSessions(scene);
const memory = createMemory(scene);

// bouton retour (visible en mode mémoire plein écran)
const back = (() => { const { g, t } = canvasTex(384, 128); g.fillStyle = 'rgba(20,26,58,.95)'; g.beginPath(); g.roundRect(4, 4, 376, 120, 40); g.fill(); g.strokeStyle = '#7a95ff'; g.lineWidth = 4; g.stroke();
  g.fillStyle = '#eaf0ff'; g.font = '600 44px system-ui'; g.textAlign = 'center'; g.fillText('← Retour', 192, 82); t.needsUpdate = true;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.1), new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false }));
  m.position.set(0.62, 0.9, -0.62); m.rotation.set(-0.7, -0.35, 0); m.userData.pick = { type: 'back' }; m.visible = false; scene.add(m); return m; })();

// ---- événements (polling : robuste derrière un tunnel)
function onEvent(e) {
  if (e.type === 'agent.status') { const s = sess.upsert(e); if (e.kind === 'claude-code' && e.detail !== undefined) log.push(`${s.name}: ${s.status}${e.detail ? ' · ' + e.detail.slice(0, 40) : ''}`); refocus(); }
  if (e.type === 'agent.remove') { sess.remove(e.id); refocus(); }
  if (e.type === 'agent.message') log.push(e.text);
}
let since = 0;
setInterval(async () => { try { const r = await (await fetch('/poll?since=' + since)).json(); since = r.seq; const skew = Date.now() - r.now; r.events.forEach((e) => onEvent({ ...e, t: e.t + skew })); } catch {} }, 400);
memory.load().then((n) => log.push(`mémoire: ${n} souvenirs chargés`));

// ---- sélection / focus
function refocus() { const id = sess.selected; if (!id) return; const s = sess.sessions.get(id); if (!s) { sess.select(null); log.setFocus(null); return; }
  log.setFocus({ title: s.name, color: STATUS[s.status]?.c, text: `${STATUS[s.status]?.t ?? s.status} · ${ago(Date.now() - s.seen)}\n${s.detail || ''}` }); }
function act(p) {
  if (!p) return;
  if (p.type === 'session') { memory.select(null); sess.select(p.id); refocus(); }
  if (p.type === 'memory-open') { memory.setExpanded(true); sess.arc.visible = false; sess.orrery.visible = false; back.visible = true; }
  if (p.type === 'back') { memory.setExpanded(false); sess.arc.visible = true; sess.orrery.visible = true; back.visible = false; }
  if (p.type === 'memory') { const m = memory.find(p.id); sess.select(null); memory.select(p.id);
    log.setFocus({ title: m.name, color: TYPE_COLOR[m.type], text: `[${m.project} · ${m.type}] ${m.description || ''}\n${m.body.replace(/\s+/g, ' ').slice(0, 220)}` }); }
}
const vis = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
const ray = new THREE.Raycaster(); ray.far = 12;
const tmpM = new THREE.Matrix4();
function rayFrom(c) { c.updateMatrixWorld(true); tmpM.identity().extractRotation(c.matrixWorld); ray.ray.origin.setFromMatrixPosition(c.matrixWorld); ray.ray.direction.set(0, 0, -1).applyMatrix4(tmpM).normalize(); }
function pick(r) { const objs = [...sess.pickables(), ...memory.pickables(), back, log.mesh].filter(vis); const h = r.intersectObjects(objs, false)[0]; return h ? { p: h.object.userData.pick, d: h.distance } : null; }
function setHover(p) { sess.hover(p?.type === 'session' ? p.id : null); memory.hoverStar(p?.type === 'memory' ? p.id : null); }

// manettes
const ctrls = [0, 1].map((i) => { const c = renderer.xr.getController(i); scene.add(c);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: 0x9db4ff, transparent: true, opacity: 0.7 })); line.scale.z = 3; c.add(line);
  c.userData = { line }; c.addEventListener('selectstart', () => { rayFrom(c); act(pick(ray)?.p); });
  c.addEventListener('squeezestart', startRec); c.addEventListener('squeezeend', stopRec); return c; });
// souris (mode bureau)
const mouse = new THREE.Vector2(); let down = null, mouseHover = false;
renderer.domElement.addEventListener('pointermove', (e) => { mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); mouseHover = true; });
renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => { if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5) { ray.setFromCamera(mouse, camera); act(pick(ray)?.p); } down = null; });

// ---- chat LLM (streaming)
async function ask(text) {
  log.setChat('… '); let out = '', think = '';
  const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: text }] }) });
  if (!r.ok) { log.setChat(`Erreur ${r.status}: ${await r.text()}`); return; }
  const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
  for (;;) { const { done, value } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n'); buf = parts.pop();
    for (const p of parts) { if (!p.startsWith('data:') || p.includes('[DONE]')) continue;
      try { const d = JSON.parse(p.slice(5)).choices?.[0]?.delta ?? {};
        if (d.reasoning) { think += d.reasoning; if (!out) log.setChat('💭 ' + think); }
        if (d.content) { out += d.content; log.setChat(out); } } catch {} } }
}
const q = document.getElementById('q'); const send = () => { if (q.value.trim()) { ask(q.value); q.value = ''; } };
document.getElementById('send').onclick = send; q.onkeydown = (e) => e.key === 'Enter' && send();

// ---- dictée : maintenir grip (VR) ou espace (bureau)
async function toWav(blob) {
  const ctx = new OfflineAudioContext(1, 1, 16000); const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  const off = new OfflineAudioContext(1, Math.ceil(buf.duration * 16000), 16000); const src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start();
  const pcm = (await off.startRendering()).getChannelData(0), out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const w = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); out.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVEfmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, 16000, true); out.setUint32(28, 32000, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, pcm.length * 2, true);
  pcm.forEach((v, i) => out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true));
  return new Blob([out], { type: 'audio/wav' });
}
let rec = null, chunks = [], stream = null;
async function startRec() {
  try { stream ??= await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { log.setChat('Micro refusé: ' + e.message); return; }
  chunks = []; rec = new MediaRecorder(stream); rec.ondataavailable = (e) => chunks.push(e.data); rec.start(); log.setChat('🎙 j\'écoute… (relâche pour envoyer)');
}
async function stopRec() {
  if (!rec) return; const r = rec; rec = null; await new Promise((ok) => { r.onstop = ok; r.stop(); });
  try { log.setChat('… transcription'); const wav = await toWav(new Blob(chunks));
    const res = await fetch('/api/stt', { method: 'POST', body: wav }); const txt = await res.text();
    if (!res.ok) { log.setChat(`STT ${res.status}: ${txt}`); return; }
    let text = txt; try { text = JSON.parse(txt).text ?? txt; } catch {}
    text = text.trim(); if (!text) { log.setChat('(rien entendu)'); return; }
    log.push('🗣 ' + text.slice(0, 55)); ask(text);
  } catch (e) { log.setChat('Erreur dictée: ' + e.message); }
}
addEventListener('keydown', (e) => { if (e.code === 'Space' && e.target === document.body && !rec) { e.preventDefault(); startRec(); } });
addEventListener('keyup', (e) => { if (e.code === 'Space' && rec) stopRec(); });
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ---- boucle
let frames = 0, t0 = 0, errOnce = false;
renderer.xr.addEventListener('sessionstart', () => { frames = 0; t0 = performance.now(); clog('XR sessionstart'); });
renderer.xr.addEventListener('sessionend', () => clog('XR sessionend'));
const clock = new THREE.Clock(); let lastFocus = 0;
renderer.setAnimationLoop(() => { try {
  const dt = Math.min(clock.getDelta(), 0.1), now = Date.now();
  // survol : manettes en priorité, sinon souris
  let hit = null;
  ctrls.forEach((c) => { const l = c.userData.line; l.scale.z = 3; if (!c.visible) return; rayFrom(c); const h = pick(ray); if (h) { l.scale.z = h.d; if (!hit) hit = h.p; } });
  if (!hit && mouseHover && !renderer.xr.isPresenting) { ray.setFromCamera(mouse, camera); hit = pick(ray)?.p ?? null; }
  setHover(hit);
  env.update(dt); sess.update(dt, now); memory.update(dt, now);
  sess.sessions.forEach((s, id) => { if (now - s.seen > 1800000) { sess.remove(id); refocus(); } });
  if (now - lastFocus > 1000) { lastFocus = now; refocus(); }
  renderer.render(scene, camera);
  if (renderer.xr.isPresenting && ++frames % 120 === 1) { const i = renderer.info; clog(`XR frame ${frames} · ${((performance.now() - t0) / 1000).toFixed(1)}s · calls ${i.render.calls} · tris ${i.render.triangles} · tex ${i.memory.textures}`); }
  } catch (e) { if (!errOnce) { errOnce = true; clog('LOOP ' + (e.stack || e)); } }
});
