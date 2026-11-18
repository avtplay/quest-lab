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

// ---- mémoire : celle de cette machine + celles poussées par les autres (hooks)
const safe = (s) => String(s || '').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 40) || 'inconnue';
function allMemories() {
  const sets = [];
  const local = loadMemories(); if (local.length) sets.push({ machine: safe(os.hostname()), list: local });
  for (const f of fs.readdirSync(path.join(DATA_DIR, 'memory')).filter((x) => x.endsWith('.json'))) {
    try { const j = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'memory', f), 'utf8')); if (j.machine !== sets[0]?.machine) sets.push(j); } catch {}
  }
  const multi = sets.length > 1;
  return sets.flatMap((s) => s.list.map((m) => ({ ...m, machine: s.machine, id: `${s.machine}/${m.project}/${m.file}`, cluster: multi ? `${s.machine} · ${m.project}` : m.project })));
}

const readBody = async (req, max = 256 * 1024) => { let b = '', n = 0; for await (const c of req) { n += c.length; if (n > max) throw new Error('trop gros'); b += c; } return b; };
const json = (res, code, obj) => res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(obj));
const EVENTS = new Set(['agent.status', 'agent.remove', 'agent.message']);

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') { res.writeHead(200).end('ok'); return; }
  if (!authorized(req, res, url)) { res.writeHead(403).end('403'); return; }
  const P = url.pathname, POST = req.method === 'POST';

  if (P === '/poll') { // lecture régulière : robuste derrière tunnel / proxy
    const since = +url.searchParams.get('since') || 0;
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
    for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
    emit(out); return void res.writeHead(204).end();
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
