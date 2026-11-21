// Bridge Quest Lab — zéro dépendance. Sert la page, reçoit les événements des sessions (hooks, locaux ou distants),
// agrège la mémoire de plusieurs machines, proxifie le LLM et la dictée. Conçu pour tourner sur un VPS derrière HTTPS.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadMemories } from './client/memory-scan.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
try { // mini loader .env
  for (const l of fs.readFileSync(path.join(dir, '.env'), 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {}
const { STT_URL, SCRIBE_DICTEE_TOKEN, LLM_BASE_URL, LLM_API_KEY, LLM_MODEL,
  PORT = 8080, HOST = '0.0.0.0', SIMULATE = '0', DATA_DIR = path.join(dir, 'data') } = process.env;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json' };
const TTL = 30 * 60 * 1000; // une session sans événement depuis 30 min disparaît
fs.mkdirSync(path.join(DATA_DIR, 'memory'), { recursive: true });

// ---- accès : jeton obligatoire sauf appel local direct (loopback sans en-tête de proxy)
let TOKEN = process.env.ACCESS_TOKEN;
if (!TOKEN) { TOKEN = crypto.randomBytes(12).toString('hex'); fs.appendFileSync(path.join(dir, '.env'), `\nACCESS_TOKEN=${TOKEN}\n`); }
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const isLoop = (a = '') => a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
function authorized(req, res, url) {
  const h = req.headers, proxied = h['cf-connecting-ip'] || h['x-forwarded-for'] || h['x-real-ip'];
  if (isLoop(req.socket.remoteAddress) && !proxied) return true;
  if (eq(h['x-quest-token'] || '', TOKEN) || eq((h.authorization || '').replace(/^Bearer\s+/i, ''), TOKEN)) return true;
  if (eq(url.searchParams.get('k') || '', TOKEN)) {
    const secure = h['x-forwarded-proto'] === 'https' || h['cf-visitor'] ? '; Secure' : '';
    res.setHeader('Set-Cookie', `qk=${TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`); return true;
  }
  return (h.cookie || '').split(/;\s*/).some((c) => c.startsWith('qk=') && eq(c.slice(3), TOKEN));
}

// ---- événements + persistance des sessions (survit aux redémarrages)
const STATE = path.join(DATA_DIR, 'state.json');
let state = {}; try { state = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch {}
let saveTimer; const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => fs.writeFile(STATE, JSON.stringify(state), () => {}), 1000); };
// noms personnalisés des sessions (sinon : nom du dossier), conservés sur disque
const NAMES = path.join(DATA_DIR, 'names.json'); let names = {}; try { names = JSON.parse(fs.readFileSync(NAMES, 'utf8')); } catch {}
const saveNames = () => fs.writeFile(NAMES, JSON.stringify(names), () => {}); const autoLabels = new Map();
const clients = new Set(), buf = []; let seq = 0;
const push = (full) => { buf.push({ seq: ++seq, ev: full }); if (buf.length > 400) buf.shift(); const d = `data: ${JSON.stringify(full)}\n\n`; for (const c of clients) c.write(d); };
const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : v);
function emit(ev) {
  const full = { t: Date.now(), ...ev };
  if (full.type === 'agent.status' && full.kind) state[full.id] = full;
  if (full.type === 'agent.remove') delete state[full.id];
  save(); push(full);
}
for (const e of Object.values(state)) if (Date.now() - e.t < TTL) push(e); else delete state[e.id];
setInterval(() => { for (const [id, e] of Object.entries(state)) if (Date.now() - e.t > TTL) { delete state[id]; save(); } }, 60000);
setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 15000);
setInterval(() => { for (const [id, q] of queues) { const keep = q.filter((x) => Date.now() - x.at < 600000); if (keep.length) queues.set(id, keep); else queues.delete(id); } }, 30000);

// ---- mémoire : celle de cette machine + celles poussées par les autres (hooks)
const safe = (s) => String(s || '').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 40) || 'inconnue';
function allMemories() {
  const sets = [];
  const sig = (l) => l.map((m) => `${m.project}/${m.file}`).sort().join('|');
  const local = loadMemories(), pushed = [];
  for (const f of fs.readdirSync(path.join(DATA_DIR, 'memory')).filter((x) => x.endsWith('.json'))) { try { pushed.push(JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'memory', f), 'utf8'))); } catch {} }
  // la mémoire de cette machine peut aussi arriver par son hook (sous le nom configuré) : on ne la compte qu'une fois
  if (local.length && !pushed.some((p) => sig(p.list) === sig(local))) sets.push({ machine: safe(os.hostname()), list: local });
  sets.push(...pushed);
  const multi = sets.length > 1;
  return sets.flatMap((s) => s.list.map((m) => ({ ...m, machine: s.machine, id: `${s.machine}/${m.project}/${m.file}`, cluster: multi ? `${s.machine} · ${m.project}` : m.project })));
}

const readBody = async (req, max = 256 * 1024) => { let b = '', n = 0; for await (const c of req) { n += c.length; if (n > max) throw new Error('trop gros'); b += c; } return b; };
const json = (res, code, obj) => res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(obj));
const okDir = (r, d) => r.dirs.includes(d);
const EVENTS = new Set(['agent.status', 'agent.remove', 'agent.message']); // les autres types (ask, instruct, transcript) ne naissent que dans le bridge

// ---- pilotage : permissions à valider et consignes à livrer (uniquement pour les machines installées avec --control)
const asks = new Map();    // rid -> { id, machine, tool, res, timer }
const dev = new Map();     // id de session -> { changes, output, todos } : données d'atelier, en mémoire seulement (comme l'historique)
const rooms = new Map();   // id de session -> { objects: Map(nom -> objet), rev } : salle blanche de la session, gardée sur disque (data/rooms) pour survivre aux redéploiements
const ROOMS_DIR = path.join(DATA_DIR, 'rooms'); fs.mkdirSync(ROOMS_DIR, { recursive: true });
const roomFile = (id) => path.join(ROOMS_DIR, safe(id) + '.json'), roomTimers = new Map();
for (const f of fs.readdirSync(ROOMS_DIR).filter((x) => x.endsWith('.json'))) { // rechargement au démarrage ; une salle abandonnée depuis 30 jours est supprimée
  try { const p = path.join(ROOMS_DIR, f); if (Date.now() - fs.statSync(p).mtimeMs > 30 * 864e5) { fs.rmSync(p); continue; } const j = JSON.parse(fs.readFileSync(p, 'utf8')); rooms.set(String(j.id), { objects: new Map((j.objects || []).map((o) => [o.name, o])), rev: 0 }); } catch {}
}
function writeRoom(id) { const R = rooms.get(id); if (!R) return; const tmp = roomFile(id) + '.tmp'; try { fs.writeFileSync(tmp, JSON.stringify({ id, objects: [...R.objects.values()] })); fs.renameSync(tmp, roomFile(id)); } catch {} }
function saveRoom(id) { clearTimeout(roomTimers.get(id)); roomTimers.set(id, setTimeout(() => { roomTimers.delete(id); writeRoom(id); }, 300)); }
const flushRooms = () => { for (const id of roomTimers.keys()) { clearTimeout(roomTimers.get(id)); writeRoom(id); } roomTimers.clear(); };
const webFrames = new Map(); // id de session -> dernière image JPEG du navigateur de dev (mémoire seulement)
const ttsJobs = [], ttsWait = new Map(), ttsPoll = []; let ttsSeen = 0; // synthèse vocale : le synthétiseur (machine locale) vient chercher les textes et renvoie du WAV ; aucune connexion entrante, aucun secret de plus
const boards = new Map();  // id de session -> PNG du dernier schéma dessiné dans le casque (mémoire seulement)
const queues = new Map();  // id de session -> [{ text, at }]
const transcripts = new Map(); // id de session -> { messages, at } : en mémoire seulement, jamais sur disque
const waiters = new Map();       // id -> [{ res, timer }] : écouteurs en attente (long-poll)
const listening = new Map();     // id -> timer : session à l'écoute (réveil immédiat possible)
const runners = new Map();       // machine -> { dirs, seen, queue: [], waiter } : « lanceurs » de sessions, démarrés à la main sur chaque machine
const runnerSessions = new Map(); // id de carte -> { machine, sid } : sessions lancées depuis le casque (consignes envoyées directement à leur entrée)
const runnerOnline = (r) => r && Date.now() - r.seen < 45000;
function runnerPush(machine, cmd) { const r = runners.get(machine); if (!r) return false; r.queue.push(cmd); runnerWake(r); return true; }
function runnerWake(r) { if (r.waiter && r.queue.length) { const w = r.waiter; r.waiter = null; clearTimeout(w.timer); json(w.res, 200, { cmds: r.queue.splice(0) }); } }
setInterval(() => { for (const [m, r] of runners) if (r.on && !runnerOnline(r)) { r.on = false; emit({ type: 'runner.update', machine: m, on: false, dirs: r.dirs }); } }, 10000);
let lastPoll = 0;          // dernière fois qu'une page (casque/navigateur) a lu le bridge
const audit = (line) => fs.appendFile(path.join(DATA_DIR, 'audit.log'), `${new Date().toISOString()} ${line}\n`, () => {});
function markListening(id) {
  if (!listening.has(id)) emit({ type: 'agent.listen', id, on: true });
  clearTimeout(listening.get(id)); listening.set(id, setTimeout(() => { listening.delete(id); emit({ type: 'agent.listen', id, on: false }); }, 40000));
}
function takeQueue(id) {
  const texts = (queues.get(id) ?? []).splice(0).map((q) => q.text); if (!texts.length) return [];
  for (const t of texts) { audit(`livré machine=${state[id]?.machine} session=${id} texte=${JSON.stringify(t)}`); emit({ type: 'agent.instruct', id, text: t, status: 'delivered' }); }
  return texts;
}
function wake(id) { // une consigne vient d'arriver : réveille l'écouteur de la session s'il y en a un
  const w = waiters.get(id)?.shift(); if (!w) return false;
  clearTimeout(w.timer); const texts = takeQueue(id); if (!texts.length) { waiters.get(id).unshift(w); return false; }
  json(w.res, 200, { texts }); return true;
}
const present = () => Date.now() - lastPoll < 8000;
function endAsk(rid, decision, why) {
  const a = asks.get(rid); if (!a) return; asks.delete(rid); clearTimeout(a.timer);
  if (!a.res.writableEnded) json(a.res, 200, { decision: decision === 'pass' ? null : decision });
  audit(`ask ${why} machine=${a.machine} session=${a.id} tool=${a.tool} -> ${decision}`);
  emit({ type: 'agent.ask.done', id: a.id, rid, decision });
}

// met une consigne en file pour une session (ou l'écrit au lanceur) ; renvoie le code HTTP
function instructCore(id, text) {
  if (!text || !state[id]?.control) return 404;
  const q = queues.get(id) ?? []; if (q.length >= 5) return 429;
  q.push({ text, at: Date.now() }); queues.set(id, q);
  const rs = runnerSessions.get(id); // session lancée depuis le casque : on écrit directement dans son entrée
  if (rs && runnerPush(rs.machine, { type: 'say', sid: rs.sid, text })) { audit(`consigne envoyée au lanceur machine=${rs.machine} session=${id} texte=${JSON.stringify(text)}`); emit({ type: 'agent.instruct', id, text, status: 'delivered' }); return 204; }
  audit(`consigne en attente machine=${state[id].machine} session=${id} texte=${JSON.stringify(text)}`);
  emit({ type: 'agent.instruct', id, text, status: 'queued' }); wake(id); return 204;
}
async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') { res.writeHead(200).end('ok'); return; }
  if (!authorized(req, res, url)) { res.writeHead(403).end('403'); return; }
  const P = url.pathname, POST = req.method === 'POST';

  if (P === '/poll') { // lecture régulière : robuste derrière tunnel / proxy
    lastPoll = Date.now(); const since = +url.searchParams.get('since') || 0;
    return json(res, 200, { seq, now: Date.now(), events: buf.filter((b) => b.seq > since).map((b) => b.ev) });
  }
  if (P === '/events') { // flux SSE (usage local)
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
    res.write(': ' + ' '.repeat(4096) + '\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return;
  }
  if (P === '/api/event' && POST) { // envoyé par les hooks des machines
    const e = JSON.parse(await readBody(req, 16 * 1024));
    if (!EVENTS.has(e.type)) return void res.writeHead(400).end('type inconnu');
    const out = { type: e.type, id: clip(e.id, 80), label: clip(e.label, 60), kind: clip(e.kind, 30), machine: clip(e.machine, 40), status: clip(e.status, 20), detail: clip(e.detail, 120), from: clip(e.from, 60), to: clip(e.to, 60), text: clip(e.text, 200) };
    if (e.control === true) out.control = true;
    if (out.id && out.label) { autoLabels.set(out.id, out.label); out.auto = out.label; if (names[out.id]) out.label = names[out.id]; } // le nom choisi l'emporte sur celui du dossier
    for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
    emit(out);
    if (e.type === 'agent.remove') { if (names[out.id]) { delete names[out.id]; saveNames(); } autoLabels.delete(out.id); runnerSessions.delete(out.id); queues.delete(out.id); transcripts.delete(out.id); dev.delete(out.id); boards.delete(out.id); webFrames.delete(out.id); rooms.delete(out.id); clearTimeout(roomTimers.get(out.id)); roomTimers.delete(out.id); fs.rmSync(roomFile(out.id), { force: true }); clearTimeout(listening.get(out.id)); listening.delete(out.id); for (const [rid, a] of asks) if (a.id === out.id) endAsk(rid, 'pass', 'fin de session'); }
    if (e.inbox === true && e.control === true && queues.get(out.id)?.length) { // livre les consignes en attente à la session
      const texts = takeQueue(out.id); if (texts.length) return json(res, 200, { inbox: texts });
    }
    return void res.writeHead(204).end();
  }
  if (P === '/api/transcript' && POST) { // une machine envoie les derniers échanges d'une session
    const b = JSON.parse(await readBody(req, 600 * 1024)), id = clip(String(b.id || ''), 80);
    if (!state[id]) return void res.writeHead(404).end('session inconnue');
    const messages = (Array.isArray(b.messages) ? b.messages : []).slice(-60).map((m) => ({ role: ['user', 'assistant', 'tool'].includes(m.role) ? m.role : 'assistant', text: clip(String(m.text || ''), 8000) }));
    transcripts.set(id, { messages, at: Date.now() }); emit({ type: 'agent.transcript', id }); return void res.writeHead(204).end();
  }
  if (P === '/api/transcript') return json(res, 200, transcripts.get(url.searchParams.get('id')) ?? { messages: [], at: 0 });
  if (P === '/api/listen') { // long-poll : la session (via listen.js) attend qu'une consigne soit dictée
    const id = clip(String(url.searchParams.get('id') || ''), 80);
    if (!state[id]?.control) return void res.writeHead(404).end('session non pilotable');
    markListening(id);
    const ready = takeQueue(id); if (ready.length) return json(res, 200, { texts: ready });
    const w = { res }; const list = waiters.get(id) ?? []; waiters.set(id, list); list.push(w);
    w.timer = setTimeout(() => { const l = waiters.get(id); if (l) waiters.set(id, l.filter((x) => x !== w)); json(res, 200, { texts: [] }); }, Math.min(Math.max(+url.searchParams.get('secs') || 25, 5), 30) * 1000);
    res.on('close', () => { clearTimeout(w.timer); const l = waiters.get(id); if (l) waiters.set(id, l.filter((x) => x !== w)); });
    return;
  }
  if (P === '/api/runner/hello' && POST) { // un lanceur se déclare avec ses dossiers autorisés
    const b = JSON.parse(await readBody(req, 8192)), m = safe(b.machine), dirs = (Array.isArray(b.dirs) ? b.dirs : []).slice(0, 30).map((d) => clip(String(d), 300));
    const r = runners.get(m) ?? { queue: [], waiter: null, on: false }; r.dirs = dirs; r.resumable = (Array.isArray(b.resumable) ? b.resumable : []).slice(0, 12).map((x) => ({ sid: clip(String(x.sid || ''), 80), dir: clip(String(x.dir || ''), 300), title: clip(String(x.title || ''), 80), model: clip(String(x.model || ''), 10), at: +x.at || 0 })); r.seen = Date.now(); runners.set(m, r);
    for (const x of (Array.isArray(b.sessions) ? b.sessions : []).slice(0, 10)) if (x?.id && x?.sid) runnerSessions.set(clip(String(x.id), 80), { machine: m, sid: clip(String(x.sid), 80) }); // après un redémarrage du bridge, le lanceur rappelle ses sessions vivantes
    if (!r.on) { r.on = true; audit(`lanceur en ligne machine=${m} dossiers=${JSON.stringify(dirs)}`); emit({ type: 'runner.update', machine: m, on: true, dirs }); }
    return json(res, 200, { ok: true });
  }
  if (P === '/api/runner/poll') { // long-poll : le lanceur attend des ordres (lancer, parler, arrêter)
    const m = safe(url.searchParams.get('machine')), r = runners.get(m); if (!r) return void res.writeHead(404).end('lanceur inconnu : envoie d\'abord hello');
    r.seen = Date.now(); if (r.queue.length) return json(res, 200, { cmds: r.queue.splice(0) });
    if (r.waiter) { clearTimeout(r.waiter.timer); json(r.waiter.res, 200, { cmds: [] }); }
    const w = { res }; r.waiter = w; w.timer = setTimeout(() => { if (r.waiter === w) r.waiter = null; json(res, 200, { cmds: [] }); }, 25000);
    res.on('close', () => { clearTimeout(w.timer); if (r.waiter === w) r.waiter = null; }); return;
  }
  if (P === '/api/runner/report' && POST) { // le lanceur raconte ce qu'il fait : démarré, échoué, terminé
    const b = JSON.parse(await readBody(req, 8192)), m = safe(b.machine), id = b.id ? clip(String(b.id), 80) : undefined;
    if (b.event === 'started' && id) runnerSessions.set(id, { machine: m, sid: clip(String(b.sid || ''), 80) });
    if ((b.event === 'exited' || b.event === 'failed') && id) runnerSessions.delete(id);
    audit(`lanceur ${b.event} machine=${m} rid=${clip(String(b.rid || ''), 20)} id=${id ?? '-'} ${b.error ? 'erreur=' + JSON.stringify(clip(String(b.error), 200)) : ''}`);
    emit({ type: 'launch.update', rid: clip(String(b.rid || ''), 20), machine: m, id, status: clip(String(b.event || ''), 20), error: b.error ? clip(String(b.error), 200) : undefined });
    return void res.writeHead(204).end();
  }
  if (P === '/api/runners') return json(res, 200, { runners: [...runners].map(([machine, r]) => ({ machine, dirs: r.dirs, on: runnerOnline(r), resumable: r.resumable || [] })) });
  if (P === '/api/launch' && POST) { // depuis le casque : démarre une nouvelle session sur une machine
    const b = JSON.parse(await readBody(req, 8192)), m = safe(b.machine), r = runners.get(m), dir = String(b.dir || (r?.resumable || []).find((x) => x.sid === String(b.resume || ''))?.dir || ''), prompt = clip(String(b.prompt || '').trim(), 2000);
    if (!runnerOnline(r)) return void res.writeHead(409).end('aucun lanceur actif sur cette machine');
    if (!okDir(r, dir)) return void res.writeHead(403).end('dossier non autorisé');
    const resume = b.resume ? String(b.resume) : '';
    if (resume && !(r.resumable || []).some((x) => x.sid === resume)) return void res.writeHead(404).end('session non reprenable');
    if (!prompt && !resume) return void res.writeHead(400).end('consigne vide');
    const model = ['sonnet', 'opus', 'haiku'].includes(b.model) ? b.model : '', rid = crypto.randomBytes(5).toString('hex'); runnerPush(m, { type: 'launch', rid, dir, prompt, model, resume });
    audit(`lancement demandé machine=${m} dossier=${dir} modèle=${model || 'défaut'} reprise=${resume || '-'} rid=${rid} consigne=${JSON.stringify(prompt)}`); emit({ type: 'launch.update', rid, machine: m, status: 'queued' });
    return json(res, 200, { rid });
  }
  if (P === '/api/rename' && POST) { // donne un nom à une session ; un nom vide rétablit le nom du dossier
    const b = JSON.parse(await readBody(req, 2048)), id = clip(String(b.id || ''), 80), name = clip(String(b.name || '').trim(), 40);
    if (!state[id]) return void res.writeHead(404).end('session inconnue');
    state[id].auto ??= autoLabels.get(id) ?? state[id].label; // le nom d'origine (dossier) est gardé avec la session
    if (name) names[id] = name; else delete names[id]; saveNames();
    const label = names[id] ?? state[id].auto; state[id].label = label; save();
    audit(`renommée session=${id} nom=${JSON.stringify(label)}`); emit({ type: 'agent.rename', id, name: label }); return void res.writeHead(204).end();
  }
  if (P === '/api/ask' && POST) { // un hook PermissionRequest attend ta décision depuis le casque
    const b = JSON.parse(await readBody(req, 16 * 1024)), id = clip(String(b.id || ''), 80);
    if (!state[id]?.control || !present()) return json(res, 200, { decision: null }); // personne devant : le terminal décide, sans délai
    const rid = crypto.randomBytes(6).toString('hex'), wait = Math.min(Math.max(+b.wait || 40, 5), 55) * 1000;
    const a = { id, machine: clip(String(b.machine || ''), 40), tool: clip(String(b.tool || ''), 40), res };
    a.timer = setTimeout(() => endAsk(rid, 'pass', 'délai'), wait); asks.set(rid, a);
    res.on('close', () => { if (asks.has(rid)) endAsk(rid, 'pass', 'hook parti'); });
    audit(`ask demandé machine=${a.machine} session=${id} tool=${a.tool} résumé=${JSON.stringify(clip(String(b.summary || ''), 120))}`);
    emit({ type: 'agent.ask', id, rid, tool: a.tool, summary: clip(String(b.summary || ''), 160) });
    return; // la réponse partira dans /api/decide, à l'expiration du délai, ou si le hook raccroche
  }
  if (P === '/api/decide' && POST) { // depuis le casque : allow | deny | pass
    const b = JSON.parse(await readBody(req, 2048));
    if (!asks.has(b.rid) || !['allow', 'deny', 'pass'].includes(b.decision)) return void res.writeHead(404).end('demande inconnue');
    endAsk(b.rid, b.decision, 'décidé'); return void res.writeHead(204).end();
  }
  if (P === '/api/instruct' && POST) { // depuis le casque : consigne pour une session
    const b = JSON.parse(await readBody(req, 4096)); return void res.writeHead(instructCore(clip(String(b.id || ''), 80), clip(String(b.text || '').trim(), 500))).end();
  }
  if (P === '/api/dev' && POST) { // une machine envoie un événement d'atelier (changement, sortie, tâches) : opt-in avec --history
    const b = JSON.parse(await readBody(req, 512 * 1024)), id = clip(String(b.id || ''), 80); if (!id || !state[id]) return void res.writeHead(404).end();
    const d = dev.get(id) ?? { changes: [], output: [], todos: null }; dev.set(id, d); const t = Date.now();
    if (b.kind === 'change') { d.changes.push({ t, tool: clip(String(b.tool || ''), 20), file: clip(String(b.file || ''), 200), diff: clip(String(b.diff || ''), 2400) }); d.changes = d.changes.slice(-60); }
    else if (b.kind === 'output') { d.output.push({ t, cmd: clip(String(b.cmd || ''), 300), out: clip(String(b.out || ''), 2400), error: !!b.error }); d.output = d.output.slice(-40); }
    else if (b.kind === 'diagram') { // schéma (nœuds + liens) affiché dans le Tableau du casque
      const nodes = (Array.isArray(b.nodes) ? b.nodes : []).slice(0, 30).map((n) => ({ id: clip(String(n.id ?? n.label ?? ''), 30), label: clip(String(n.label ?? n.id ?? ''), 40), color: /^#[0-9a-fA-F]{6}$/.test(n.color) ? n.color : '' })).filter((n) => n.id);
      const ids = new Set(nodes.map((n) => n.id)), links = (Array.isArray(b.links) ? b.links : []).slice(0, 60).map((l) => ({ from: clip(String(l.from ?? ''), 30), to: clip(String(l.to ?? ''), 30), label: clip(String(l.label ?? ''), 30) })).filter((l) => ids.has(l.from) && ids.has(l.to));
      d.diagram = { title: clip(String(b.title || ''), 60), nodes, links, t };
    }
    else if (b.kind === 'sync') { // recalage complet depuis la transcription
      const ok = (x) => Array.isArray(x) ? x : [];
      d.changes = ok(b.changes).slice(-60).map((x) => ({ t: +x.t || t, tool: clip(String(x.tool || ''), 20), file: clip(String(x.file || ''), 200), diff: clip(String(x.diff || ''), 2400) }));
      d.output = ok(b.output).slice(-40).map((x) => ({ t: +x.t || t, cmd: clip(String(x.cmd || ''), 300), out: clip(String(x.out || ''), 2400), error: !!x.error }));
      d.todos = Array.isArray(b.todos) ? b.todos.slice(0, 60).map((x) => ({ content: clip(String(x.content || x.subject || ''), 160), status: ['pending', 'in_progress', 'completed'].includes(x.status) ? x.status : 'pending' })) : d.todos;
    }
    else if (b.kind === 'todos' && Array.isArray(b.todos)) d.todos = b.todos.slice(0, 60).map((x) => ({ content: clip(String(x.content || x.subject || ''), 160), status: ['pending', 'in_progress', 'completed'].includes(x.status) ? x.status : 'pending' }));
    else return void res.writeHead(400).end();
    emit({ type: 'agent.dev', id, kind: b.kind }); return void res.writeHead(204).end();
  }
  if (P === '/api/dev') return json(res, 200, dev.get(clip(String(url.searchParams.get('id') || ''), 80)) ?? { changes: [], output: [], todos: null });
  if (P === '/api/room' && POST) { // salle blanche : Claude (client/room.js) ou le casque (déplacement) modifie les objets de la session
    const b = JSON.parse(await readBody(req, 64 * 1024)), id = clip(String(b.id || ''), 80); if (!id || !state[id]) return void res.writeHead(404).end('session inconnue');
    const R = rooms.get(id) ?? { objects: new Map(), rev: 0 }; rooms.set(id, R); const SHAPES = ['box', 'sphere', 'cylinder', 'plane', 'text', 'arrow', 'db', 'api', 'server', 'queue', 'cache', 'browser', 'user', 'file', 'cloud', 'link'];
    const num = (v, d) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.max(-100, Math.min(100, +v)) : d), vec = (a, d) => (Array.isArray(a) ? [0, 1, 2].map((i) => num(a[i], d[i])) : d);
    const clean = (o, old = {}) => ({ name: safe(o.name ?? old.name).slice(0, 40), shape: SHAPES.includes(o.shape) ? o.shape : (old.shape ?? 'box'), state: ['ok', 'warn', 'error', 'idle'].includes(o.state) ? o.state : (old.state ?? 'ok'),
      from: safe(o.from ?? old.from ?? '').slice(0, 40), toName: safe(typeof o.to === 'string' ? o.to : (o.toName ?? o.target ?? old.toName ?? '')).slice(0, 40),
      color: /^#[0-9a-fA-F]{6}$/.test(o.color) || /^[a-z]{3,20}$/.test(o.color) ? o.color : (old.color ?? '#4f8cff'), pos: vec(o.pos, old.pos ?? [0, 1.2, -1]),
      size: Array.isArray(o.size) ? vec(o.size, [0.3, 0.3, 0.3]).map((x) => Math.max(0.01, Math.abs(x))) : Number.isFinite(+o.size) && o.size !== null ? Math.max(0.01, Math.min(20, +o.size)) : (old.size ?? 0.3),
      rot: vec(o.rot, old.rot ?? [0, 0, 0]), to: Array.isArray(o.to) ? vec(o.to, [0, 1, -2]) : old.to, text: clip(String(o.text ?? old.text ?? ''), 120), label: clip(String(o.label ?? old.label ?? ''), 60) });
    if (b.op === 'set' && b.obj) { const o = clean(b.obj, R.objects.get(safe(b.obj.name))); if (!R.objects.has(o.name) && R.objects.size >= 60) return void res.writeHead(429).end('60 objets au maximum'); R.objects.set(o.name, o); }
    else if (b.op === 'remove') R.objects.delete(safe(b.name));
    else if (b.op === 'clear') R.objects.clear();
    else if (b.op === 'move') { const o = R.objects.get(safe(b.name)); if (!o) return void res.writeHead(404).end('objet inconnu'); const old = o.pos; o.pos = vec(b.pos, o.pos); if (o.to) o.to = o.to.map((v, i) => Math.max(-100, Math.min(100, v + o.pos[i] - old[i]))); /* une flèche se déplace d'un bloc : son extrémité suit */ if (b.size !== undefined) o.size = clean({ size: b.size }, o).size; }
    else return void res.writeHead(400).end('op inconnue');
    R.rev++; saveRoom(id); emit({ type: 'agent.room', id }); return void res.writeHead(204).end();
  }
  if (P === '/api/room') { const R = rooms.get(clip(String(url.searchParams.get('id') || ''), 80)); return json(res, 200, { rev: R?.rev ?? 0, objects: R ? [...R.objects.values()] : [] }); }
  if (P === '/api/board' && POST) { // schéma dessiné dans le casque : gardé en mémoire, la session le récupère via [[board:id]]
    const id = clip(String(url.searchParams.get('id') || ''), 80); if (!state[id]?.control) return void res.writeHead(404).end('session non pilotable');
    const chunks = []; let n = 0; for await (const c of req) { n += c.length; if (n > 4e6) throw new Error('image trop grosse'); chunks.push(c); }
    const buf = Buffer.concat(chunks); if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return void res.writeHead(400).end('PNG attendu');
    boards.set(id, buf); audit(`schéma reçu machine=${state[id].machine} session=${id} octets=${buf.length}`);
    return void res.writeHead(instructCore(id, `Schéma dessiné dans le casque (image) : [[board:${id}]]`)).end();
  }
  if (P === '/api/board') { const buf = boards.get(clip(String(url.searchParams.get('id') || ''), 80)); if (!buf) return void res.writeHead(404).end(); return void res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }).end(buf); }
  if (P === '/api/web' && POST) { // navigateur de dev vu dans le casque : une image JPEG par session, la plus récente, en mémoire seulement
    const id = clip(String(url.searchParams.get('id') || ''), 80); if (!state[id]) return void res.writeHead(404).end('session inconnue');
    const chunks = []; let n = 0; for await (const c of req) { n += c.length; if (n > 2e6) throw new Error('image trop grosse'); chunks.push(c); }
    const buf = Buffer.concat(chunks); if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return void res.writeHead(400).end('JPEG attendu');
    const old = webFrames.get(id); webFrames.set(id, { buf, rev: (old?.rev ?? 0) + 1, at: Date.now(), url: clip(String(url.searchParams.get('url') || ''), 200), title: clip(String(url.searchParams.get('title') || ''), 120) });
    return void res.writeHead(204).end();
  }
  if (P === '/api/web') { const f = webFrames.get(clip(String(url.searchParams.get('id') || ''), 80)); if (!f) return void res.writeHead(404).end();
    if (+url.searchParams.get('rev') === f.rev) return void res.writeHead(204, { 'x-at': String(f.at) }).end();
    return void res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', 'x-rev': String(f.rev), 'x-at': String(f.at), 'x-url': encodeURIComponent(f.url), 'x-title': encodeURIComponent(f.title) }).end(f.buf); }
  if (P === '/api/tts' && POST) { // depuis le casque : texte -> WAV, fabriqué par le synthétiseur de la machine qui l'a branché (client/tts_worker.py)
    const text = clip(String(JSON.parse(await readBody(req, 8192)).text || '').trim(), 600); if (!text) return void res.writeHead(400).end('texte vide');
    if (Date.now() - ttsSeen > 45000) return void res.writeHead(503).end('aucun synthétiseur actif'); if (ttsWait.size >= 4) return void res.writeHead(429).end('trop de demandes');
    const rid = crypto.randomBytes(5).toString('hex'), job = { rid, text }; const wav = new Promise((ok) => { const t = setTimeout(() => { ttsWait.delete(rid); ok(null); }, 25000); ttsWait.set(rid, (b) => { clearTimeout(t); ttsWait.delete(rid); ok(b); }); });
    const w = ttsPoll.shift(); if (w) w(job); else ttsJobs.push(job);
    const buf = await wav; if (!buf) return void res.writeHead(504).end('synthèse trop lente'); return void res.writeHead(200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' }).end(buf);
  }
  if (P === '/api/tts/status') return json(res, 200, { on: Date.now() - ttsSeen < 45000 });
  if (P === '/api/tts/next') { // long-poll du synthétiseur : un texte à lire, ou 204 au bout de 25 s
    ttsSeen = Date.now(); const j = ttsJobs.shift(); if (j) return json(res, 200, j);
    const job = await new Promise((ok) => { const t = setTimeout(() => { const i = ttsPoll.indexOf(f); if (i >= 0) ttsPoll.splice(i, 1); ok(null); }, 25000); const f = (x) => { clearTimeout(t); ok(x); }; ttsPoll.push(f); req.on('close', () => { const i = ttsPoll.indexOf(f); if (i >= 0) { ttsPoll.splice(i, 1); clearTimeout(t); ok(null); } }); });
    ttsSeen = Date.now(); if (!job) return void res.writeHead(204).end(); if (res.destroyed) { ttsJobs.unshift(job); return; } return json(res, 200, job);
  }
  if (P === '/api/tts/result' && POST) { const chunks = []; let n = 0; for await (const c of req) { n += c.length; if (n > 6e6) throw new Error('audio trop gros'); chunks.push(c); }
    const done = ttsWait.get(String(url.searchParams.get('rid') || '')); if (done) done(Buffer.concat(chunks)); return void res.writeHead(done ? 204 : 410).end(); }
  if (P === '/api/memory/push' && POST) { // une machine envoie sa mémoire
    const b = JSON.parse(await readBody(req, 12 * 1024 * 1024)); const machine = safe(b.machine);
    const list = (Array.isArray(b.memories) ? b.memories : []).slice(0, 2000).map((m) => ({ project: clip(String(m.project), 60), file: clip(String(m.file), 100), name: clip(String(m.name), 120), description: clip(String(m.description || ''), 300),
      type: clip(String(m.type || 'project'), 20), body: clip(String(m.body || ''), 3000), size: +m.size || 0, links: (m.links || []).slice(0, 30).map((l) => clip(String(l), 100)) }));
    fs.writeFileSync(path.join(DATA_DIR, 'memory', `${machine}.json`), JSON.stringify({ machine, at: Date.now(), list })); return void res.writeHead(204).end();
  }
  if (P === '/api/memory') return json(res, 200, { memories: allMemories() });
  if (P === '/api/clientlog' && POST) { // diagnostic casque
    const line = `[client ${new Date().toISOString().slice(11, 19)}] ${(await readBody(req, 4096)).replace(/\n/g, ' ⏎ ')}`;
    console.log(line); fs.appendFileSync(path.join(DATA_DIR, 'client.log'), line + '\n'); return void res.writeHead(204).end();
  }
  if (P === '/api/shot' && POST) { // capture d'écran du casque (PNG), une seule gardée et écrasée à chaque envoi : data/shot.png
    const chunks = []; let n = 0; for await (const c of req) { n += c.length; if (n > 8e6) throw new Error('image trop grosse'); chunks.push(c); }
    const buf = Buffer.concat(chunks); if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return void res.writeHead(400).end('PNG attendu');
    fs.writeFileSync(path.join(DATA_DIR, 'shot.png'), buf); return void res.writeHead(204).end();
  }
  if (P === '/api/stt' && POST) { // WAV brut -> transcription (Jetson)
    if (!STT_URL || !SCRIBE_DICTEE_TOKEN) return void res.writeHead(503).end('STT_URL / SCRIBE_DICTEE_TOKEN absents de .env');
    const chunks = []; let n = 0; for await (const c of req) { n += c.length; if (n > 20e6) throw new Error('audio trop gros'); chunks.push(c); }
    const fd = new FormData(); fd.append('file', new Blob([Buffer.concat(chunks)], { type: 'audio/wav' }), 'audio.wav');
    const up = await fetch(STT_URL, { method: 'POST', headers: { Authorization: `Bearer ${SCRIBE_DICTEE_TOKEN}` }, body: fd }).catch((e) => ({ status: 502, text: async () => String(e) }));
    return void res.writeHead(up.status, { 'Content-Type': 'application/json' }).end(await up.text());
  }
  if (P === '/api/chat' && POST) {
    if (!LLM_BASE_URL || !LLM_API_KEY) return void res.writeHead(503).end('LLM non configuré (.env)');
    const { messages } = JSON.parse(await readBody(req, 512 * 1024));
    const up = await fetch(`${LLM_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LLM_API_KEY}` }, body: JSON.stringify({ model: LLM_MODEL, messages, stream: true }),
    }).catch((e) => ({ ok: false, status: 502, text: async () => String(e) }));
    if (!up.ok) return void res.writeHead(up.status).end(await up.text());
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    for await (const chunk of up.body) res.write(chunk);
    return void res.end();
  }
  // statique (sans cache : le casque doit toujours recevoir la dernière version)
  const pub = path.join(dir, 'public'), file = path.join(pub, P === '/' ? 'index.html' : path.normalize(P));
  if (!file.startsWith(pub + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return void res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

http.createServer((req, res) => handle(req, res).catch((e) => { console.error(e.message); if (!res.headersSent) res.writeHead(400).end('erreur'); else res.end(); }))
  .listen(PORT, HOST, () => console.log(`Quest Lab — ${HOST}:${PORT}\nAccès (ajoute à l'URL publique) : /?k=${TOKEN}\nLLM : ${LLM_BASE_URL ? 'configuré' : 'non configuré'}`));
process.on('SIGTERM', () => { flushRooms(); fs.writeFileSync(STATE, JSON.stringify(state)); process.exit(0); });

// Simulateur d'agents (SIMULATE=1 pour démo)
if (SIMULATE === '1') {
  const agents = ['planner', 'coder', 'reviewer', 'memory', 'tester'], states = ['idle', 'thinking', 'working', 'error'];
  agents.forEach((id) => emit({ type: 'agent.status', id, status: 'idle' }));
  setInterval(() => emit({ type: 'agent.status', id: agents[Math.random() * 5 | 0], status: states[Math.random() * 3 | 0] }), 1500);
}
