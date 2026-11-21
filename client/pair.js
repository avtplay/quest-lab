#!/usr/bin/env node
// Appairage depuis le terminal (machine déjà configurée) : approuver un code affiché par un appareil, lister, révoquer.
//   node pair.js approve K7M4QX [view|control]     node pair.js devices     node pair.js revoke <id>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.quest-lab', 'config.json'), 'utf8')); } catch {}
const BASE = (process.env.QUEST_LAB_URL || cfg.url || 'http://localhost:8080').replace(/\/$/, ''), TOKEN = process.env.QUEST_LAB_TOKEN || cfg.token || '';
const [cmd, a, b] = process.argv.slice(2);
const api = async (p, body) => { const r = await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { 'x-quest-token': TOKEN, 'content-type': 'application/json' }, body: body && JSON.stringify(body), signal: AbortSignal.timeout(10000) }); if (!r.ok) { console.error(`refusé (${r.status}) : ${await r.text()}`); process.exit(1); } return r.json(); };
if (cmd === 'approve' && a) { await api('/api/pair/approve', { code: a, role: b === 'view' ? 'view' : 'control' }); console.log('appareil autorisé'); }
else if (cmd === 'devices') { const { devices } = await api('/api/devices'); for (const d of devices) console.log(`${d.id}  ${d.name}  ${d.role}  expire ${new Date(d.exp).toISOString().slice(0, 10)}`); if (!devices.length) console.log('aucun appareil appairé'); }
else if (cmd === 'revoke' && a) { await api('/api/devices/revoke', { id: a }); console.log('appareil révoqué'); }
else { console.error('usage : node pair.js approve <code> [view|control] | devices | revoke <id>'); process.exit(1); }
