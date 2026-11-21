// Appairage par QR : parcours complet, rôles et révocation. Lance un vrai bridge sur un port libre, sans dépendance (node --test).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), MASTER = 'maitre-de-test-0123456789ab', PORT = 18000 + (process.pid % 1000);
const BASE = `http://127.0.0.1:${PORT}`; let srv, data;
const call = (p, { token, cookie, body, method } = {}) => fetch(BASE + p, { method: method || (body ? 'POST' : 'GET'), redirect: 'manual', body: body && JSON.stringify(body),
  headers: { 'x-forwarded-for': '203.0.113.7', ...(token ? { 'x-quest-token': token } : {}), ...(cookie ? { cookie } : {}) } }); // l'en-tête de proxy simule un appel distant

before(async () => {
  data = fs.mkdtempSync(path.join(os.tmpdir(), 'quest-test-'));
  srv = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT, HOST: '127.0.0.1', DATA_DIR: data, ACCESS_TOKEN: MASTER, SIMULATE: '0' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/health')).ok) return; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('bridge non démarré');
});
after(() => { srv?.kill(); fs.rmSync(data, { recursive: true, force: true }); });

async function pairDevice(role) {
  const s = await (await call('/api/pair/start', { body: { name: 'Casque test' } })).json();
  assert.equal((await (await call('/api/pair/poll?id=' + s.id)).json()).status, 'pending');
  assert.equal((await call('/api/pair/approve', { body: { code: s.code, role } })).status, 403, "sans le jeton maître, l'approbation est refusée");
  assert.equal((await call('/api/pair/approve', { token: MASTER, body: { code: s.code, role } })).status, 200);
  const r = await call('/api/pair/poll?id=' + s.id); assert.equal((await r.json()).status, 'approved');
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0]; assert.match(cookie, /^qd=qd_[0-9a-f]{32}$/);
  assert.equal((await (await call('/api/pair/poll?id=' + s.id)).json()).status, 'expired', 'le jeton ne se remet qu\'une fois');
  return cookie;
}

test('sans accès : redirection vers /pair, API refusée, pages d\'appairage publiques', async () => {
  assert.equal((await call('/')).status, 302);
  assert.equal((await call('/poll')).status, 403);
  assert.equal((await call('/pair')).status, 200);
  assert.equal((await call('/api/devices')).status, 403);
});

test('appairage en pilotage : accès aux données, pas aux routes des machines ni à l\'administration', async () => {
  const cookie = await pairDevice('control');
  assert.equal((await call('/poll', { cookie })).status, 200);
  assert.equal((await call('/api/decide', { cookie, body: {} })).status !== 403, true, 'un appareil de pilotage peut décider');
  assert.equal((await call('/api/event', { cookie, body: { type: 'agent.status', id: 'x' } })).status, 403, 'pas de faux événements de machine');
  assert.equal((await call('/api/devices', { cookie })).status, 403);
  assert.equal((await call('/api/pair/approve', { cookie, body: { code: 'AAAAAA' } })).status, 403, 'un appareil ne peut pas en approuver un autre');
});

test('appairage en lecture seule : peut lire, pas piloter', async () => {
  const cookie = await pairDevice('view');
  assert.equal((await call('/poll', { cookie })).status, 200);
  assert.equal((await call('/api/instruct', { cookie, body: { id: 'x', text: 'a' } })).status, 403);
  assert.equal((await call('/api/launch', { cookie, body: {} })).status, 403);
});

test('révocation : le jeton cesse de fonctionner et le code expiré est refusé', async () => {
  const cookie = await pairDevice('control'), list = await (await call('/api/devices', { token: MASTER })).json();
  assert.ok(list.devices.length >= 1); assert.ok(!JSON.stringify(list).includes('qd_'), 'aucun jeton dans la liste');
  for (const d of list.devices) assert.equal((await call('/api/devices/revoke', { token: MASTER, body: { id: d.id } })).status, 200);
  assert.equal((await call('/poll', { cookie })).status, 403);
  assert.equal((await call('/api/pair/approve', { token: MASTER, body: { code: 'ZZZZZZ', role: 'control' } })).status, 404);
  assert.ok(!fs.readFileSync(path.join(data, 'devices.json'), 'utf8').includes('qd_'), 'jetons hachés sur disque');
});
