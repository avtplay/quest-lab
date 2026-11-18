import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildEnvironment } from './env.js';
import { createConsole, canvasTex, STATUS, TYPE_COLOR, ago, wrap } from './ui.js';
import { createSessions } from './sessions.js';
import { createMemory } from './memory.js';
import { createConvo } from './convo.js';

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
const log = createConsole(); log.mesh.userData.pick = log.pick;
const consoleGroup = new THREE.Group(); consoleGroup.position.set(0, 0.92, -0.78); consoleGroup.rotation.order = 'YXZ'; consoleGroup.rotation.x = -0.7; consoleGroup.add(log.mesh); scene.add(consoleGroup);
const sess = createSessions(scene);
const memory = createMemory(scene);
const convo = createConvo(); const convoGroup = new THREE.Group(); convoGroup.position.set(0, 1.55, -1.35); convoGroup.rotation.order = 'YXZ'; convo.mesh.position.set(0, 0, 0); convoGroup.add(convo.mesh); scene.add(convoGroup);
let lastSel = null, renaming = null; // renaming : id de la session dont on dicte le nouveau nom
async function loadTranscript(id) { try { const r = await fetch('/api/transcript?id=' + encodeURIComponent(id)); if (r.ok && sess.selected === id) convo.setMessages((await r.json()).messages); } catch {} }

// bouton retour (visible en mode mémoire plein écran)
const back = (() => { const { g, t } = canvasTex(384, 128); g.fillStyle = 'rgba(20,26,58,.95)'; g.beginPath(); g.roundRect(4, 4, 376, 120, 40); g.fill(); g.strokeStyle = '#7a95ff'; g.lineWidth = 4; g.stroke();
  g.fillStyle = '#eaf0ff'; g.font = '600 44px system-ui'; g.textAlign = 'center'; g.fillText('← Retour', 192, 82); t.needsUpdate = true;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.1), new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false }));
  m.position.set(0.62, 0.9, -0.62); m.rotation.set(-0.7, -0.35, 0); m.userData.pick = { type: 'back' }; m.visible = false; scene.add(m); return m; })();

// barre d'action sous la console : décisions de permission, consigne vocale, désélection
const bar = (() => { const W = 1024, H = 128, { g, t } = canvasTex(W, H);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.125), new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false }));
  m.position.set(0, -0.444, 0.031); m.userData.pick = { type: 'bar' }; m.visible = false; consoleGroup.add(m);
  const o = { m, buttons: [], key: '' };
  o.draw = (label, buttons, key) => { if (key === o.key) return; o.key = key; o.buttons = buttons; g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(14,18,42,.94)'; g.beginPath(); g.roundRect(0, 0, W, H, 30); g.fill(); g.strokeStyle = 'rgba(120,150,255,.45)'; g.lineWidth = 3; g.stroke();
    buttons.forEach((b, i) => { b.x0 = W - 24 - (buttons.length - i) * 220 + 14; b.x1 = b.x0 + 206; });
    g.textBaseline = 'middle'; g.textAlign = 'left'; g.font = '600 28px system-ui'; g.fillStyle = '#cdd6ff';
    const room = buttons[0].x0 - 28 - 24; let txt = label; while (txt.length > 4 && g.measureText(txt).width > room) txt = txt.slice(0, -2) + '…'; g.fillText(txt, 28, H / 2);
    buttons.forEach((b) => { g.fillStyle = b.color; g.beginPath(); g.roundRect(b.x0, 20, 206, 88, 22); g.fill(); g.fillStyle = '#0b0f20'; g.font = '700 30px system-ui'; g.textAlign = 'center'; g.fillText(b.label, (b.x0 + b.x1) / 2, H / 2); });
    t.needsUpdate = true; };
  return o; })();
// boutons sous la console : recharger la page (ferme la session VR : il faut ré-appuyer sur Enter VR) et réinitialiser la disposition des écrans
function smallButton(label, pick, x, y = -0.444) { const { g, t } = canvasTex(384, 128);
  g.fillStyle = 'rgba(14,18,42,.94)'; g.beginPath(); g.roundRect(4, 4, 376, 120, 40); g.fill(); g.strokeStyle = 'rgba(120,150,255,.6)'; g.lineWidth = 4; g.stroke();
  g.fillStyle = '#dfe6ff'; g.font = '600 42px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, 192, 66); t.needsUpdate = true;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.0867), new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false }));
  m.position.set(x, y, 0.031); m.userData.pick = pick; consoleGroup.add(m); return m; }
const reloadBtn = smallButton('↻ Recharger', { type: 'reload' }, -0.66);
const layoutBtn = smallButton('⟲ Disposition', { type: 'reset-layout' }, 0.66);
const launchBtn = smallButton('+ Session', { type: 'open-launcher' }, -0.66, -0.55);

// ---- écrans déplaçables et redimensionnables, comme les fenêtres de l'OS du Quest
// poignée au-dessus de l'écran : maintenir la gâchette pour le déplacer (stick avant/arrière : plus près / plus loin) ; coin en bas à droite : l'agrandir ou le réduire
const LAYOUT_KEY = 'questlab.layout', panels = {};
function gripMesh(w, h, draw) { const px = 256, py = Math.round(256 * h / w), { g, t } = canvasTex(px, py); draw(g, px, py); t.needsUpdate = true;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false })); }
function addPanel(name, group, halfW, halfH) {
  const handle = gripMesh(0.5, 0.07, (g, w, h) => { g.fillStyle = 'rgba(120,150,255,.45)'; g.beginPath(); g.roundRect(2, 2, w - 4, h - 4, h / 2); g.fill(); g.fillStyle = '#e8edff'; for (let k = -3; k <= 3; k++) { g.beginPath(); g.arc(w / 2 + k * 18, h / 2, 4, 0, 7); g.fill(); } });
  const corner = gripMesh(0.1, 0.1, (g, w, h) => { g.fillStyle = 'rgba(120,150,255,.45)'; g.beginPath(); g.roundRect(2, 2, w - 4, h - 4, 28); g.fill(); g.strokeStyle = '#e8edff'; g.lineWidth = 8; g.lineCap = 'round';
    for (const o of [0.3, 0.5, 0.7]) { g.beginPath(); g.moveTo(w * 0.85, h * o + h * 0.15); g.lineTo(w * o + w * 0.15, h * 0.85); g.stroke(); } });
  handle.position.set(0, halfH + 0.06, 0.005); corner.position.set(halfW + 0.05, -halfH - 0.05, 0.005);
  handle.userData.pick = { type: 'handle', panel: name }; corner.userData.pick = { type: 'corner', panel: name };
  group.add(handle, corner); panels[name] = { name, group, handle, corner, home: group.position.clone() };
}
addPanel('convo', convoGroup, 0.75, 0.469); addPanel('console', consoleGroup, 0.5, 0.3125);
const faceUser = (P) => { P.group.rotation.y = Math.atan2(-P.group.position.x, -P.group.position.z); }; // se tourne vers l'utilisateur, resté à l'origine
function saveLayout() { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(Object.fromEntries(Object.entries(panels).map(([n, P]) => [n, { p: P.group.position.toArray(), s: P.group.scale.x }])))); } catch {} }
function resetLayout() { for (const P of Object.values(panels)) { P.group.position.copy(P.home); P.group.scale.setScalar(1); faceUser(P); } try { localStorage.removeItem(LAYOUT_KEY); } catch {} }
try { for (const [n, v] of Object.entries(JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}'))) { const P = panels[n]; if (P && Array.isArray(v.p) && v.p.length === 3 && v.p.every(Number.isFinite)) { P.group.position.fromArray(v.p); P.group.scale.setScalar(Math.min(2.5, Math.max(0.5, +v.s || 1))); faceUser(P); } } } catch {}
let drag = null; const _p = new THREE.Vector3(), _n = new THREE.Vector3(), _q = new THREE.Quaternion();
function startDrag(pk, dist, src) {
  const P = panels[pk.panel]; if (!P) return; ray.ray.at(dist, _p);
  if (pk.type === 'handle') drag = { mode: 'move', P, src, dist, off: P.group.position.clone().sub(_p) };
  else { _n.set(0, 0, 1).applyQuaternion(P.group.getWorldQuaternion(_q)); const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(_n, P.group.position);
    if (!ray.ray.intersectPlane(plane, _p)) return; drag = { mode: 'resize', P, src, plane, r0: Math.max(0.05, _p.distanceTo(P.group.position)), s0: P.group.scale.x }; }
  if (src === 'mouse') controls.enabled = false;
}
function endDrag() { if (!drag) return; drag = null; controls.enabled = true; saveLayout(); }
function updateDrag(dt) {
  if (!drag) return; const P = drag.P, src = drag.src;
  if (src === 'mouse') ray.setFromCamera(mouse, camera); else rayFrom(src);
  if (drag.mode === 'move') {
    const y = src !== 'mouse' ? (src.userData.src?.gamepad?.axes?.[3] ?? 0) : 0; if (Math.abs(y) > 0.2) drag.dist = Math.min(4, Math.max(0.5, drag.dist + y * dt * 1.5));
    ray.ray.at(drag.dist, _p).add(drag.off); P.group.position.copy(_p); P.group.position.y = Math.max(0.3, P.group.position.y); faceUser(P);
  } else if (ray.ray.intersectPlane(drag.plane, _p)) P.group.scale.setScalar(Math.min(2.5, Math.max(0.5, drag.s0 * _p.distanceTo(P.group.position) / drag.r0)));
}
// ---- lanceur : démarrer une nouvelle session Claude Code sur une machine (machine -> dossier -> consigne dictée -> lancer)
const launcher = (() => {
  const W = 1536, H = 960, { g, t } = canvasTex(W, H);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.75), new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false }));
  mesh.position.set(0, 1.6, -1.05); mesh.visible = false; mesh.userData.pick = { type: 'launcher' }; scene.add(mesh);
  const L = { mesh, open: false, step: 0, runners: [], machine: null, dir: null, prompt: '', status: '', rid: null, failed: false, buttons: [], pendingSelect: null };
  L.draw = () => {
    g.clearRect(0, 0, W, H); const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, 'rgba(22,28,64,.97)'); bg.addColorStop(1, 'rgba(9,12,30,.97)');
    g.fillStyle = bg; g.beginPath(); g.roundRect(0, 0, W, H, 44); g.fill(); g.lineWidth = 5; g.strokeStyle = 'rgba(142,162,255,.7)'; g.stroke();
    g.textBaseline = 'alphabetic'; g.textAlign = 'left'; g.font = '700 56px system-ui'; g.fillStyle = '#eef2ff'; g.fillText('Nouvelle session Claude Code', 60, 96);
    L.buttons = []; const btn = (x, y, w, h, label, color, action, sub) => { L.buttons.push({ x0: x, y0: y, x1: x + w, y1: y + h, action });
      g.fillStyle = color; g.beginPath(); g.roundRect(x, y, w, h, 26); g.fill(); g.fillStyle = '#0b0f20'; g.textAlign = 'center'; g.font = '700 40px system-ui'; g.fillText(label, x + w / 2, y + h / (sub ? 2.4 : 1.7));
      if (sub) { g.font = '26px system-ui'; g.fillStyle = 'rgba(11,15,32,.75)'; g.fillText(sub, x + w / 2, y + h - 22); } g.textAlign = 'left'; };
    const sub = (s) => { g.font = '34px system-ui'; g.fillStyle = '#9fb0e0'; g.fillText(s, 60, 160); };
    const online = L.runners.filter((r) => r.on);
    if (L.step === 0) { sub('Sur quelle machine ?');
      if (!online.length) { g.font = '32px system-ui'; g.fillStyle = '#ffd28a'; wrap(g, 'Aucun lanceur actif. Sur la machine voulue, démarre : node ~/.quest-lab/client/runner.js (après avoir autorisé des dossiers dans ~/.quest-lab/config.json).', 60, 260, W - 120, 46, 5); }
      online.slice(0, 8).forEach((r, i) => btn(60 + (i % 2) * 730, 210 + Math.floor(i / 2) * 130, 700, 110, r.machine, '#8fa6ff', { machine: r.machine }, `${r.dirs.length} dossier${r.dirs.length > 1 ? 's' : ''} autorisé${r.dirs.length > 1 ? 's' : ''}`));
      btn(60, 800, 300, 100, 'Annuler', '#8d97c4', { close: true }); }
    else if (L.step === 1) { sub(`Dans quel dossier ? (${L.machine})`);
      (online.find((r) => r.machine === L.machine)?.dirs ?? []).slice(0, 8).forEach((d, i) => btn(60 + (i % 2) * 730, 210 + Math.floor(i / 2) * 130, 700, 110, d.split('/').filter(Boolean).pop() || d, '#8fa6ff', { dir: d }, d.length > 40 ? '…' + d.slice(-38) : d));
      btn(60, 800, 300, 100, 'Retour', '#8d97c4', { back: true }); }
    else if (L.step === 2) { sub(`${L.machine} · ${L.dir.split('/').filter(Boolean).pop()}`);
      g.fillStyle = 'rgba(8,12,30,.9)'; g.beginPath(); g.roundRect(60, 190, W - 120, 440, 26); g.fill(); g.strokeStyle = 'rgba(142,162,255,.45)'; g.lineWidth = 3; g.stroke();
      if (L.prompt) { g.font = '40px system-ui'; g.fillStyle = '#f1e8d6'; wrap(g, L.prompt, 90, 260, W - 180, 54, 6); }
      else { g.font = '38px system-ui'; g.fillStyle = '#6f7aa5'; wrap(g, 'Maintiens le grip et dicte la consigne de départ. (Sur PC : tape-la dans le champ en bas puis Entrée.)', 90, 260, W - 180, 52, 4); }
      g.font = '28px system-ui'; g.fillStyle = '#8c98c4'; wrap(g, 'La session pourra lancer des commandes dans ce dossier. Tu valides chaque permission avec Autoriser / Refuser.', 60, 680, W - 120, 36, 2);
      btn(60, 800, 300, 100, 'Retour', '#8d97c4', { back: true }); btn(400, 800, 340, 100, 'Redicter', '#8d97c4', { redo: true });
      if (L.prompt) btn(1136, 800, 340, 100, 'Lancer', '#38e08f', { go: true }); }
    else { g.font = '44px system-ui'; g.fillStyle = L.failed ? '#ff8da0' : '#cdd6ff'; wrap(g, L.status, 60, 260, W - 120, 60, 6); btn(60, 800, 300, 100, 'Fermer', '#8d97c4', { close: true }); }
    t.needsUpdate = true;
  };
  return L;
})();
async function openLauncher() { launcher.open = true; launcher.step = 0; launcher.machine = launcher.dir = null; launcher.prompt = ''; launcher.failed = false; launcher.mesh.visible = true; launcher.draw();
  try { launcher.runners = (await (await fetch('/api/runners')).json()).runners; } catch { launcher.runners = []; } launcher.draw(); }
function closeLauncher() { launcher.open = false; launcher.mesh.visible = false; }
async function launchSession() {
  launcher.step = 3; launcher.failed = false; launcher.status = 'Envoi de la demande…'; launcher.draw();
  try { const r = await fetch('/api/launch', { method: 'POST', body: JSON.stringify({ machine: launcher.machine, dir: launcher.dir, prompt: launcher.prompt }) });
    if (!r.ok) { launcher.failed = true; launcher.status = `Refusé (${r.status}) : ${await r.text()}`; } else { launcher.rid = (await r.json()).rid; launcher.status = 'Demande envoyée. En attente du lanceur…'; } }
  catch (e) { launcher.failed = true; launcher.status = 'Erreur : ' + e.message; } launcher.draw();
}
function launcherClick(uv) {
  const x = (uv?.x ?? 0) * 1536, y = (1 - (uv?.y ?? 0)) * 960, b = launcher.buttons.find((k) => x >= k.x0 && x <= k.x1 && y >= k.y0 && y <= k.y1); if (!b) return; const A = b.action;
  if (A.close) closeLauncher(); else if (A.machine) { launcher.machine = A.machine; launcher.step = 1; } else if (A.dir) { launcher.dir = A.dir; launcher.prompt = ''; launcher.step = 2; }
  else if (A.back) launcher.step = Math.max(0, launcher.step - 1); else if (A.redo) launcher.prompt = ''; else if (A.go) return launchSession();
  launcher.draw();
}
function onLaunchEvent(e) {
  if (e.type === 'runner.update') { fetch('/api/runners').then((r) => r.json()).then((j) => { launcher.runners = j.runners; if (launcher.open) launcher.draw(); }).catch(() => {}); return; }
  if (e.rid !== launcher.rid) return;
  const T = { queued: 'Demande envoyée. En attente du lanceur…', started: 'Session démarrée.', failed: 'Échec : ' + (e.error || 'inconnu'), exited: 'La session s\'est terminée.' };
  launcher.failed = e.status === 'failed'; launcher.status = T[e.status] || e.status; launcher.draw();
  if (e.status === 'started' && e.id) { launcher.pendingSelect = e.id; setTimeout(closeLauncher, 1500); }
}
const controllable = (s) => s && s.control;
function updateBar() {
  const s = sess.selected && sess.sessions.get(sess.selected); bar.m.visible = !!s && !memory.expanded;
  log.setTarget(s && controllable(s) ? s.name + ' (consigne)' : 'Qwen');
  // une session sélectionnée prend la scène : on masque l'arc des autres cartes et on affiche sa conversation
  sess.orrery.visible = !memory.expanded; sess.arc.visible = !memory.expanded && !s; convo.mesh.visible = !!s && !memory.expanded; convoGroup.visible = convo.mesh.visible;
  if (launcher.pendingSelect && sess.sessions.has(launcher.pendingSelect)) { memory.select(null); sess.select(launcher.pendingSelect); launcher.pendingSelect = null; }
  if ((sess.selected || null) !== lastSel) { lastSel = sess.selected || null; convo.reset(); if (lastSel) loadTranscript(lastSel); }
  if (s) convo.draw(s, Date.now());
  if (!s) return;
  if (renaming && renaming !== s.id) renaming = null;
  if (renaming) bar.draw(`Dicte le nouveau nom de ${s.name}`, [{ label: 'Annuler', color: '#8d97c4', act: { cancelRename: true } }], 'ren' + s.id);
  else if (s.ask) bar.draw(`Autoriser ${s.ask.tool} ?`, [{ label: 'Autoriser', color: '#38e08f', act: { decide: 'allow' } }, { label: 'Refuser', color: '#ff6b7d', act: { decide: 'deny' } }, { label: 'Terminal', color: '#8d97c4', act: { decide: 'pass' } }], 'ask' + s.ask.rid);
  else if (controllable(s)) bar.draw(s.listening ? `grip : ta voix réveille ${s.name} aussitôt` : `grip : ta voix va à ${s.name}, lue à son prochain tour`, [{ label: 'Renommer', color: '#ffd28a', act: { rename: true } }, { label: 'Fermer', color: '#8d97c4', act: { clear: true } }], 'dict' + s.id + !!s.listening);
  else bar.draw(`${s.name} : lecture seule (installer avec --control)`, [{ label: 'Renommer', color: '#ffd28a', act: { rename: true } }, { label: 'Fermer', color: '#8d97c4', act: { clear: true } }], 'ro' + s.id);
}

// ---- événements (polling : robuste derrière un tunnel)
function onEvent(e) {
  if (e.type === 'agent.status') { const s = sess.upsert(e); if (e.kind === 'claude-code' && e.detail !== undefined) log.push(`${s.name}: ${s.status}${e.detail ? ' · ' + e.detail.slice(0, 40) : ''}`); refocus(); }
  if (e.type === 'agent.remove') { sess.remove(e.id); refocus(); }
  if (e.type === 'agent.message') log.push(e.text);
  if (e.type === 'agent.rename') { sess.rename(e.id, e.name); refocus(); }
  if (e.type === 'runner.update' || e.type === 'launch.update') onLaunchEvent(e);
  if (e.type === 'agent.listen') { const s = sess.sessions.get(e.id); if (s) s.listening = e.on; }
  if (e.type === 'agent.transcript' && e.id === sess.selected) loadTranscript(e.id);
  if (e.type === 'agent.ask') { const s = sess.sessions.get(e.id); if (s) { s.ask = { rid: e.rid, tool: e.tool, summary: e.summary }; s.status = 'waiting'; s.seen = e.t;
    memory.select(null); sess.select(e.id); log.push(`${s.name} demande : ${e.tool}`); refocus(); } }
  if (e.type === 'agent.ask.done') { const s = sess.sessions.get(e.id); if (s && s.ask?.rid === e.rid) { s.ask = null; s.status = e.decision === 'deny' ? 'idle' : 'working'; s.seen = e.t; log.push(`${s.name} : ${e.decision === 'allow' ? 'autorisé' : e.decision === 'deny' ? 'refusé' : 'laissé au terminal'}`); refocus(); } }
  if (e.type === 'agent.instruct') { const s = sess.sessions.get(e.id); if (s) { s.note = { text: e.text, status: e.status, until: Date.now() + (e.status === 'queued' ? 600000 : 8000) }; refocus(); } }
}
let since = 0;
setInterval(async () => { try { const r = await (await fetch('/poll?since=' + since)).json(); since = r.seq; const skew = Date.now() - r.now; r.events.forEach((e) => onEvent({ ...e, t: e.t + skew })); } catch {} }, 400);
memory.load().then((n) => log.push(`mémoire: ${n} souvenirs chargés`));

// ---- sélection / focus
function refocus() { const id = sess.selected; if (!id) return; const s = sess.sessions.get(id); if (!s) { sess.select(null); log.setFocus(null); return; }
  log.setFocus({ title: s.name, color: STATUS[s.status]?.c, text: `${STATUS[s.status]?.t ?? s.status} · ${ago(Date.now() - s.seen)}${s.control ? '' : ' · lecture seule'}\n${s.ask ? 'Demande : ' + s.ask.tool + ' ' + s.ask.summary : s.detail || ''}` }); }
async function finishRename(raw) {
  const id = renaming; renaming = null; const name = String(raw).replace(/["«»“”]/g, '').replace(/[.!?…\s]+$/g, '').trim().slice(0, 40); if (!id) return;
  try { const r = await fetch('/api/rename', { method: 'POST', body: JSON.stringify({ id, name }) }); log.setChat(r.ok ? (name ? `Session renommée : ${name}` : 'Nom d\'origine rétabli') : `Renommage refusé (${r.status})`); } catch (e) { log.setChat('Renommage impossible : ' + e.message); }
}
async function decide(rid, decision) { try { const r = await fetch('/api/decide', { method: 'POST', body: JSON.stringify({ rid, decision }) }); if (!r.ok) log.setChat('Décision refusée : ' + r.status); } catch (e) { log.setChat('Décision impossible : ' + e.message); } }
async function instruct(s, text) {
  log.setChat(`→ ${s.name} : ${text}\n(${s.listening ? 'session à l\'écoute : elle la reçoit tout de suite' : s.status === 'idle' ? 'session inactive et sans écouteur : elle la lira à son prochain tour' : 'livrée au prochain outil'})`);
  try { const r = await fetch('/api/instruct', { method: 'POST', body: JSON.stringify({ id: s.id, text }) }); if (!r.ok) log.setChat(`Consigne refusée (${r.status}) : ${await r.text()}`); } catch (e) { log.setChat('Consigne impossible : ' + e.message); }
}
function act(p, uv) {
  if (!p) return;
  if (p.type === 'reload') { location.reload(); return; }
  if (p.type === 'open-launcher') { openLauncher(); return; }
  if (p.type === 'launcher') { launcherClick(uv); return; }
  if (p.type === 'reset-layout') { resetLayout(); return; }
  if (p.type === 'bar') { const s = sess.selected && sess.sessions.get(sess.selected); const x = (uv?.x ?? 0) * 1024, b = bar.buttons.find((k) => x >= k.x0 && x <= k.x1);
    if (b?.act.decide && s?.ask) decide(s.ask.rid, b.act.decide); if (b?.act.clear) { sess.select(null); log.setFocus(null); }
    if (b?.act.rename && s) { renaming = s.id; log.setChat('Maintiens le grip et dis le nouveau nom (ou tape-le en bas sur PC).'); }
    if (b?.act.cancelRename) { renaming = null; log.setChat(''); } }
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
function pick(r) { const objs = [...sess.pickables(), ...memory.pickables(), back, log.mesh, bar.m, convo.mesh, reloadBtn, layoutBtn, launchBtn, launcher.mesh, ...Object.values(panels).flatMap((P) => [P.handle, P.corner])].filter(vis); const h = r.intersectObjects(objs, false)[0]; return h ? { p: h.object.userData.pick, d: h.distance, uv: h.uv } : null; }
function setHover(p) { sess.hover(p?.type === 'session' ? p.id : null); memory.hoverStar(p?.type === 'memory' ? p.id : null); }

// manettes
const ctrls = [0, 1].map((i) => { const c = renderer.xr.getController(i); scene.add(c);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: 0x9db4ff, transparent: true, opacity: 0.7 })); line.scale.z = 3; c.add(line);
  c.userData = { line }; c.addEventListener('connected', (e) => { c.userData.src = e.data; });
  c.addEventListener('selectend', () => { if (drag?.src === c) endDrag(); });
  c.addEventListener('selectstart', () => { rayFrom(c); const h = pick(ray); if (h && (h.p.type === 'handle' || h.p.type === 'corner')) startDrag(h.p, h.d, c); else act(h?.p, h?.uv); });
  c.addEventListener('squeezestart', startRec); c.addEventListener('squeezeend', stopRec); return c; });
// souris (mode bureau)
const mouse = new THREE.Vector2(); let down = null, mouseHover = false;
renderer.domElement.addEventListener('pointermove', (e) => { mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); mouseHover = true; });
renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(mouse, camera); const h = pick(ray); if (h && (h.p.type === 'handle' || h.p.type === 'corner')) { startDrag(h.p, h.d, 'mouse'); down = null; } });
renderer.domElement.addEventListener('pointerup', (e) => { if (drag) { endDrag(); return; } if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5) { ray.setFromCamera(mouse, camera); const h = pick(ray); act(h?.p, h?.uv); } down = null; });

renderer.domElement.addEventListener('wheel', (e) => { if (convo.mesh.visible) convo.scrollBy(-e.deltaY); }, { passive: true });

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
const q = document.getElementById('q'); const send = () => { if (!q.value.trim() && !renaming) return; if (renaming) { finishRename(q.value); q.value = ''; return; } if (launcher.open && launcher.step === 2) { launcher.prompt = q.value.trim(); launcher.draw(); } else ask(q.value); q.value = ''; };
document.getElementById('send').onclick = send; q.onkeydown = (e) => e.key === 'Enter' && send();

// ---- dictée : maintenir grip (VR) ou espace (bureau). Capture PCM directe puis WAV 16 kHz : aucun décodage de format.
function pcmToWav(chunks, sr) {
  const n = chunks.reduce((a, c) => a + c.length, 0), all = new Float32Array(n); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
  const ratio = sr / 16000, len = Math.floor(n / ratio), out = new DataView(new ArrayBuffer(44 + len * 2));
  const w = (p, s) => [...s].forEach((c, i) => out.setUint8(p + i, c.charCodeAt(0)));
  w(0, 'RIFF'); out.setUint32(4, 36 + len * 2, true); w(8, 'WAVEfmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, 16000, true); out.setUint32(28, 32000, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, len * 2, true);
  for (let i = 0; i < len; i++) { let s = 0, c = 0; for (let k = Math.floor(i * ratio); k < Math.floor((i + 1) * ratio) && k < n; k++) { s += all[k]; c++; } out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, c ? s / c : 0)) * 0x7fff, true); }
  return new Blob([out], { type: 'audio/wav' });
}
let rec = null, stream = null, actx = null;
async function startRec() {
  if (rec) return;
  try {
    stream ??= await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    actx ??= new AudioContext(); if (actx.state !== 'running') await actx.resume();
    const src = actx.createMediaStreamSource(stream), proc = actx.createScriptProcessor(4096, 1, 1), chunks = [];
    proc.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    src.connect(proc); proc.connect(actx.destination); // sortie muette (on n'écrit rien), mais le noeud doit être relié pour tourner
    rec = { src, proc, chunks, t0: performance.now() }; log.setChat('🎙 j\'écoute… (relâche pour envoyer)');
  } catch (e) { log.setChat('Micro indisponible : ' + e.message); }
}
async function stopRec() {
  if (!rec) return; const r = rec; rec = null; r.src.disconnect(); r.proc.disconnect(); r.proc.onaudioprocess = null;
  if (performance.now() - r.t0 < 600 || !r.chunks.length) { log.setChat('(trop court : maintiens le grip en parlant)'); return; }
  try { log.setChat('… transcription'); const wav = pcmToWav(r.chunks, actx.sampleRate);
    const res = await fetch('/api/stt', { method: 'POST', body: wav }); const txt = await res.text();
    if (!res.ok) { log.setChat(`STT ${res.status}: ${txt}`); return; }
    let text = txt; try { text = JSON.parse(txt).text ?? txt; } catch {}
    text = text.trim(); if (!text) { log.setChat('(rien entendu)'); return; }
    log.push('🗣 ' + text.slice(0, 55));
    if (renaming) { finishRename(text); return; } // la dictée sert de nouveau nom
    if (launcher.open && launcher.step === 2) { launcher.prompt = text; launcher.draw(); return; } // la dictée sert de consigne de départ
    const target = sess.selected && sess.sessions.get(sess.selected); if (controllable(target)) instruct(target, text); else ask(text);
  } catch (e) { log.setChat('Erreur dictée : ' + e.message); }
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
  if (renderer.xr.isPresenting && convo.mesh.visible) for (const src of renderer.xr.getSession().inputSources) { const ax = src.gamepad?.axes, y = ax ? (ax[3] ?? ax[1] ?? 0) : 0; if (Math.abs(y) > 0.2) convo.scrollBy(-y * dt * 700); }
  controls.enableZoom = !convo.mesh.visible;
  updateDrag(dt); updateBar(); env.update(dt); sess.update(dt, now); memory.update(dt, now);
  sess.sessions.forEach((s, id) => { if (now - s.seen > 1800000) { sess.remove(id); refocus(); } });
  if (now - lastFocus > 1000) { lastFocus = now; refocus(); }
  renderer.render(scene, camera);
  if (renderer.xr.isPresenting && ++frames % 120 === 1) { const i = renderer.info; clog(`XR frame ${frames} · ${((performance.now() - t0) / 1000).toFixed(1)}s · calls ${i.render.calls} · tris ${i.render.triangles} · tex ${i.memory.textures}`); }
  } catch (e) { if (!errOnce) { errOnce = true; clog('LOOP ' + (e.stack || e)); } }
});
