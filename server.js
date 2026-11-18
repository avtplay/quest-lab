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
    if (e.type === 'agent.remove') { if (names[out.id]) { delete names[out.id]; saveNames(); } autoLabels.delete(out.id); runnerSessions.delete(out.id); queues.delete(out.id); transcripts.delete(out.id); clearTimeout(listening.get(out.id)); listening.delete(out.id); for (const [rid, a] of asks) if (a.id === out.id) endAsk(rid, 'pass', 'fin de session'); }
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
    const r = runners.get(m) ?? { queue: [], waiter: null, on: false }; r.dirs = dirs; r.seen = Date.now(); runners.set(m, r);
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
  if (P === '/api/runners') return json(res, 200, { runners: [...runners].map(([machine, r]) => ({ machine, dirs: r.dirs, on: runnerOnline(r) })) });
  if (P === '/api/launch' && POST) { // depuis le casque : démarre une nouvelle session sur une machine
    const b = JSON.parse(await readBody(req, 8192)), m = safe(b.machine), r = runners.get(m), dir = String(b.dir || ''), prompt = clip(String(b.prompt || '').trim(), 2000);
    if (!runnerOnline(r)) return void res.writeHead(409).end('aucun lanceur actif sur cette machine');
    if (!okDir(r, dir)) return void res.writeHead(403).end('dossier non autorisé');
    if (!prompt) return void res.writeHead(400).end('consigne vide');
    const rid = crypto.randomBytes(5).toString('hex'); runnerPush(m, { type: 'launch', rid, dir, prompt });
    audit(`lancement demandé machine=${m} dossier=${dir} rid=${rid} consigne=${JSON.stringify(prompt)}`); emit({ type: 'launch.update', rid, machine: m, status: 'queued' });
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
    const b = JSON.parse(await readBody(req, 4096)), id = clip(String(b.id || ''), 80), text = clip(String(b.text || '').trim(), 500);
    if (!text || !state[id]?.control) return void res.writeHead(404).end('session non pilotable');
    const q = queues.get(id) ?? []; if (q.length >= 5) return void res.writeHead(429).end('trop de consignes en attente');
    q.push({ text, at: Date.now() }); queues.set(id, q);
    const rs = runnerSessions.get(id); // session lancée depuis le casque : on écrit directement dans son entrée
    if (rs && runnerPush(rs.machine, { type: 'say', sid: rs.sid, text })) { audit(`consigne envoyée au lanceur machine=${rs.machine} session=${id} texte=${JSON.stringify(text)}`); emit({ type: 'agent.instruct', id, text, status: 'delivered' }); return void res.writeHead(204).end(); }
    audit(`consigne en attente machine=${state[id].machine} session=${id} texte=${JSON.stringify(text)}`);
    emit({ type: 'agent.instruct', id, text, status: 'queued' }); wake(id); return void res.writeHead(204).end();
  }
  if (P === '/api/memory/push' && POST) { // une machine envoie sa mémoire
    const b = JSON.parse(await readBody(req, 4 * 1024 * 1024)); const machine = safe(b.machine);
    const list = (Array.isArray(b.memories) ? b.memories : []).slice(0, 2000).map((m) => ({ project: clip(String(m.project), 60), file: clip(String(m.file), 100), name: clip(String(m.name), 120), description: clip(String(m.description || ''), 300),
      type: clip(String(m.type || 'project'), 20), body: clip(String(m.body || ''), 700), size: +m.size || 0, links: (m.links || []).slice(0, 30).map((l) => clip(String(l), 100)) }));
    fs.writeFileSync(path.join(DATA_DIR, 'memory', `${machine}.json`), JSON.stringify({ machine, at: Date.now(), list })); return void res.writeHead(204).end();
  }
  if (P === '/api/memory') return json(res, 200, { memories: allMemories() });
  if (P === '/api/clientlog' && POST) { // diagnostic casque
    const line = `[client ${new Date().toISOString().slice(11, 19)}] ${(await readBody(req, 4096)).replace(/\n/g, ' ⏎ ')}`;
    console.log(line); fs.appendFileSync(path.join(DATA_DIR, 'client.log'), line + '\n'); return void res.writeHead(204).end();
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
process.on('SIGTERM', () => { fs.writeFileSync(STATE, JSON.stringify(state)); process.exit(0); });

// Simulateur d'agents (SIMULATE=1 pour démo)
if (SIMULATE === '1') {
  const agents = ['planner', 'coder', 'reviewer', 'memory', 'tester'], states = ['idle', 'thinking', 'working', 'error'];
  agents.forEach((id) => emit({ type: 'agent.status', id, status: 'idle' }));
  setInterval(() => emit({ type: 'agent.status', id: agents[Math.random() * 5 | 0], status: states[Math.random() * 3 | 0] }), 1500);
}
