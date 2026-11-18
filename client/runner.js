// Lanceur de sessions : à démarrer À LA MAIN sur une machine (node runner.js). Il attend les ordres du bridge (casque) :
//   launch : démarre une session Claude Code dans un dossier AUTORISÉ avec une première consigne ;
//   say    : écrit une consigne dans l'entrée d'une session qu'il a lancée ; stop : l'arrête.
// Config (~/.quest-lab/config.json) : "runner": { "dirs": ["/chemin/projet"], "claude": "claude", "permissionMode": "default", "maxSessions": 3 }
// Les permissions passent par tes boutons du casque (hook PermissionRequest) ; sans réponse, une session sans terminal les refuse.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.quest-lab', 'config.json'), 'utf8')); } catch {}
const R = cfg.runner || {};
const BASE = (process.env.QUEST_LAB_URL || cfg.url || 'http://localhost:8080').replace(/\/$/, '');
const TOKEN = process.env.QUEST_LAB_TOKEN || cfg.token || '';
const MACHINE = (process.env.QUEST_LAB_MACHINE || cfg.machine || os.hostname()).replace(/[^a-zA-Z0-9._-]/g, '-');
const CLAUDE = process.env.QUEST_LAB_CLAUDE || R.claude || 'claude';
const MODE = R.permissionMode || 'default', MAX = R.maxSessions || 3;
const real = (d) => { try { return fs.realpathSync(d); } catch { return null; } };
const DIRS = (process.env.QUEST_LAB_RUNNER_DIRS ? process.env.QUEST_LAB_RUNNER_DIRS.split(':') : R.dirs || []).map(real).filter(Boolean);
if (!DIRS.length) { console.error('Aucun dossier autorisé : ajoute "runner": { "dirs": [...] } à ~/.quest-lab/config.json'); process.exit(1); }

const H = { 'content-type': 'application/json', 'x-quest-token': TOKEN };
const api = (p, body, ms = 10000) => fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: H, body: body && JSON.stringify(body), signal: AbortSignal.timeout(ms) });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const report = (o) => api('/api/runner/report', { machine: MACHINE, ...o }).catch(() => {});
const children = new Map(); // session_id -> { child, id }

function launch({ rid, dir, prompt }) {
  const d = real(dir);
  if (!d || !DIRS.includes(d)) return report({ rid, event: 'failed', error: 'dossier non autorisé par ce lanceur' });
  if (children.size >= MAX) return report({ rid, event: 'failed', error: `maximum de ${MAX} sessions atteint` });
  const child = spawn(CLAUDE, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-mode', MODE], { cwd: d, env: { ...process.env, QUEST_LAB_MACHINE: MACHINE }, stdio: ['pipe', 'pipe', 'pipe'] });
  let sid = null, id = null, buf = '', failed = false;
  child.on('error', (e) => report({ rid, event: 'failed', error: 'impossible de lancer claude : ' + e.message }));
  child.stderr.on('data', (c) => log('stderr', String(c).trim().slice(0, 200)));
  child.stdout.on('data', (c) => {
    buf += c; let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1); if (!line) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.type === 'system' && o.subtype === 'init' && !sid) { sid = o.session_id; id = `cc-${MACHINE}-${String(sid).slice(0, 6)}`; children.set(sid, { child, id }); log('session démarrée', id, d); report({ rid, event: 'started', sid, id }); }
      if (o.type === 'result' && o.is_error && !failed) { failed = true; report({ rid, event: 'failed', id, error: String(o.result || 'erreur').slice(0, 200) }); }
    }
  });
  child.on('exit', (code) => { if (sid) { children.delete(sid); if (!failed) report({ rid, event: 'exited', id }); } log('session terminée', id ?? '(sans id)', 'code', code); });
  send(child, prompt);
}
const send = (child, text) => child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n');

async function main() {
  log(`lanceur ${MACHINE} → ${BASE} · dossiers : ${DIRS.join(', ')} · claude : ${CLAUDE}`);
  let fails = 0;
  for (let i = 0; ; i++) {
    try {
      if (i % 1 === 0) await api('/api/runner/hello', { machine: MACHINE, dirs: DIRS });
      const r = await api(`/api/runner/poll?machine=${encodeURIComponent(MACHINE)}`, null, 35000); if (!r.ok) throw new Error('HTTP ' + r.status);
      const { cmds = [] } = await r.json(); fails = 0;
      for (const c of cmds) {
        if (c.type === 'launch') launch(c);
        else if (c.type === 'say') { const x = children.get(c.sid); if (x) send(x.child, c.text); }
        else if (c.type === 'stop') children.get(c.sid)?.child.kill();
      }
    } catch (e) { log('bridge injoignable :', e.message); await new Promise((ok) => setTimeout(ok, Math.min(30000, 1000 * 2 ** Math.min(fails++, 5)))); }
  }
}
process.on('SIGINT', () => { for (const { child } of children.values()) child.kill(); process.exit(0); });
main();
