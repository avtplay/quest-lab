#!/usr/bin/env node
// Montre dans le casque l'application web en cours de développement (lecture seule, sans dépendance npm).
//   node web.js <id-de-session> <url> [--allow-host=nom] [--size=1280x800]
// Lance un Chromium sans écran (CHROME_PATH, sinon chromium / chrome / Playwright), pilote via le protocole DevTools
// et envoie ses images au bridge (fenêtre « Web » de l'Atelier). Ne sert que des adresses locales sauf --allow-host.
// Pour Claude : ~/.quest-lab/web/<id>/latest.jpg (dernière image) et console.log (console et erreurs de la page).
// À lancer en tâche de fond ; Ctrl-C ou SIGTERM ferme le navigateur. Node 22+ (WebSocket intégré).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const args = process.argv.slice(2), flag = (n, d) => (args.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3) || d;
const [id, target] = args.filter((a) => !a.startsWith('--'));
if (!id || !target) { console.error("usage : node web.js <id-de-session> <url> [--allow-host=nom] [--size=1280x800]"); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('Node 22 ou plus récent requis (WebSocket intégré).'); process.exit(1); }
const [W, H] = flag('size', '1280x800').split('x').map((n) => Math.max(320, Math.min(1920, +n || 0)));
const allowed = new Set(['localhost', '127.0.0.1', '[::1]', ...args.filter((a) => a.startsWith('--allow-host=')).map((a) => a.slice(13))]);
const okUrl = (u) => { try { const x = new URL(u); return u === 'about:blank' || (/^https?:$/.test(x.protocol) && allowed.has(x.hostname)); } catch { return false; } };
if (!okUrl(target) || target === 'about:blank') { console.error(`adresse refusée : seules ${[...allowed].join(', ')} sont permises (ajoute --allow-host=nom pour en autoriser une autre).`); process.exit(1); }

let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.quest-lab', 'config.json'), 'utf8')); } catch {}
const BASE = (process.env.QUEST_LAB_URL || cfg.url || 'http://localhost:8080').replace(/\/$/, ''), TOKEN = process.env.QUEST_LAB_TOKEN || cfg.token || '';
const OUT = path.join(os.homedir(), '.quest-lab', 'web', id.replace(/[^\w.-]/g, '_')); fs.mkdirSync(OUT, { recursive: true });

function findChrome() {
  const c = [process.env.CHROME_PATH, ...['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'].map((n) => spawnSync('which', [n], { encoding: 'utf8' }).stdout.trim())];
  const pw = path.join(os.homedir(), '.cache', 'ms-playwright');
  try { for (const d of fs.readdirSync(pw).sort().reverse()) for (const sub of fs.readdirSync(path.join(pw, d))) for (const bin of ['chrome-headless-shell', 'headless_shell', 'chrome']) c.push(path.join(pw, d, sub, bin)); } catch {}
  return c.find((p) => p && fs.existsSync(p));
}
const chrome = findChrome(); if (!chrome) { console.error('Aucun Chromium trouvé : installe-le ou donne son chemin dans CHROME_PATH.'); process.exit(1); }
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'quest-web-'));
const proc = spawn(chrome, ['--headless', '--disable-gpu', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `--window-size=${W},${H}`, ...(process.env.QUEST_WEB_NO_SANDBOX ? ['--no-sandbox'] : []), 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const stop = (code = 0) => { try { proc.kill(); } catch {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(code); };
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop()); let errTail = ''; proc.stderr.on('data', (d) => { errTail = (errTail + d).slice(-600); });
proc.on('exit', () => { console.error('navigateur fermé' + (/sandbox/i.test(errTail) ? " : le bac à sable de Chromium est refusé par ce système (Ubuntu 24.04). Relance avec QUEST_WEB_NO_SANDBOX=1 si tu acceptes de ne le lancer que sur tes propres pages locales." : '')); stop(1); });

const port = await new Promise((ok, ko) => { let buf = ''; const t = setTimeout(() => ko(new Error('le navigateur ne répond pas')), 15000);
  proc.stderr.on('data', (d) => { buf += d; const m = buf.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//); if (m) { clearTimeout(t); ok(+m[1]); } }); }).catch((e) => { console.error(e.message); stop(1); });
const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const page = pages.find((p) => p.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = () => ko(new Error('connexion DevTools impossible')); }).catch((e) => { console.error(e.message); stop(1); });
let seq = 0; const waiting = new Map(), listeners = new Map();
const send = (method, params = {}) => new Promise((ok) => { const i = ++seq; waiting.set(i, ok); ws.send(JSON.stringify({ id: i, method, params })); });
const on = (m, f) => listeners.set(m, f);
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id) { waiting.get(m.id)?.(m.result ?? m.error); waiting.delete(m.id); } else listeners.get(m.method)?.(m.params); };

// console et erreurs de la page : 200 lignes, gardées pour la session de développement
const lines = []; let logTimer;
const note = (kind, text) => { lines.push(`${new Date().toISOString().slice(11, 19)} [${kind}] ${String(text).replace(/\s+/g, ' ').slice(0, 400)}`); if (lines.length > 200) lines.shift();
  clearTimeout(logTimer); logTimer = setTimeout(() => fs.writeFile(path.join(OUT, 'console.log'), lines.join('\n') + '\n', () => {}), 300); };
const show = (a) => (a.value !== undefined ? (typeof a.value === 'string' ? a.value : JSON.stringify(a.value)) : a.description || a.type);
on('Runtime.consoleAPICalled', (p) => note(p.type, p.args.map(show).join(' ')));
on('Runtime.exceptionThrown', (p) => note('exception', p.exceptionDetails.exception?.description || p.exceptionDetails.text));
on('Log.entryAdded', (p) => note(p.entry.level, `${p.entry.text} ${p.entry.url || ''}`));
on('Page.frameNavigated', (p) => { if (!p.frame.parentId && !okUrl(p.frame.url)) { note('bloqué', `navigation refusée vers ${p.frame.url}`); send('Page.navigate', { url: target }); } });

// images : on garde la plus récente et on l'envoie au plus 6 fois par seconde ; ré-envoi toutes les 20 s (le bridge peut avoir redémarré)
let latest = null, sent = 0, pageUrl = target, title = '', busy = false, lastFile = 0;
async function push() {
  if (!latest || busy || (latest.sent && Date.now() - sent < 20000)) return; busy = true; const f = latest; f.sent = true; sent = Date.now();
  try { const r = await fetch(`${BASE}/api/web?id=${encodeURIComponent(id)}&url=${encodeURIComponent(pageUrl)}&title=${encodeURIComponent(title)}`, { method: 'POST', headers: { 'x-quest-token': TOKEN, 'content-type': 'image/jpeg' }, body: f.buf, signal: AbortSignal.timeout(8000) });
    if (!r.ok && r.status !== 204) note('bridge', `image refusée (${r.status})`); } catch (e) { note('bridge', 'envoi impossible : ' + e.message); }
  busy = false;
}
on('Page.screencastFrame', (p) => { send('Page.screencastFrameAck', { sessionId: p.sessionId }); latest = { buf: Buffer.from(p.data, 'base64'), sent: false };
  if (Date.now() - lastFile > 2000) { lastFile = Date.now(); fs.writeFile(path.join(OUT, 'latest.jpg'), latest.buf, () => {}); } });
setInterval(push, 160); setInterval(() => { if (latest) latest.sent = false; }, 20000);
setInterval(async () => { const r = await send('Runtime.evaluate', { expression: 'JSON.stringify([location.href, document.title])', returnByValue: true }); try { [pageUrl, title] = JSON.parse(r.result.value); } catch {} }, 2000);

await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.startScreencast', { format: 'jpeg', quality: 62, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
await send('Page.navigate', { url: target });
console.log(`navigateur lancé sur ${target} (${W}x${H}) · images : ${OUT}/latest.jpg · console : ${OUT}/console.log`);
