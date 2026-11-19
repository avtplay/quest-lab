#!/usr/bin/env node
// Affiche un schéma dans le Tableau du casque : node diagram.js <id-de-session> '<json>'
//   {"title":"...", "nodes":[{"id":"api","label":"API","color":"#4f8cff"}, ...], "links":[{"from":"api","to":"db","label":"SQL"}, ...]}
// Mise en page automatique, de gauche à droite ; 30 nœuds et 60 liens au maximum.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const [id, arg] = process.argv.slice(2);
if (!id || !arg) { console.error('usage : node diagram.js <id-de-session> \'<json>\''); process.exit(1); }
let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.quest-lab', 'config.json'), 'utf8')); } catch {}
const BASE = (process.env.QUEST_LAB_URL || cfg.url || 'http://localhost:8080').replace(/\/$/, ''), TOKEN = process.env.QUEST_LAB_TOKEN || cfg.token || '';
try {
  const r = await fetch(`${BASE}/api/dev`, { method: 'POST', headers: { 'x-quest-token': TOKEN, 'content-type': 'application/json' }, body: JSON.stringify({ id, kind: 'diagram', ...JSON.parse(arg) }), signal: AbortSignal.timeout(8000) });
  console.log(r.status === 204 ? 'ok' : `refusé (${r.status})`);
} catch (e) { console.error('échec : ' + e.message); process.exit(1); }
