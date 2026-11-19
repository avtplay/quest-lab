#!/usr/bin/env node
// Salle blanche d'une session : affiche des objets 3D dans le casque.
//   node room.js <id-de-session> add '<json>'   |  remove <nom>  |  clear  |  list
// Objet : {name, shape: box|sphere|cylinder|plane|text|arrow, color: "#rrggbb", pos: [x,y,z] (m, l'utilisateur est en 0,0,0 face à -z),
//          size: nombre ou [l,h,p], rot: [rx,ry,rz] degrés, to: [x,y,z] (flèche), text, label}
// Objets de développement : shape db | api | server | queue | cache | browser | user | file | cloud, avec state ok|warn|error|idle (voyant coloré).
// Lien entre deux objets : {name, shape:"link", from:"<nom>", to:"<nom>", label, state, color} : suit les objets, impulsions dans le sens des données.
// Un tableau JSON ajoute plusieurs objets d'un coup ; sans pos, ils sont rangés en rangée devant l'utilisateur.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const [id, cmd, arg] = process.argv.slice(2);
if (!id || !['add', 'remove', 'clear', 'list'].includes(cmd)) { console.error('usage : node room.js <id-de-session> add \'<json>\' | remove <nom> | clear | list'); process.exit(1); }
let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.quest-lab', 'config.json'), 'utf8')); } catch {}
const BASE = (process.env.QUEST_LAB_URL || cfg.url || 'http://localhost:8080').replace(/\/$/, ''), TOKEN = process.env.QUEST_LAB_TOKEN || cfg.token || '';
const H = { 'x-quest-token': TOKEN, 'content-type': 'application/json' };
try {
  if (cmd === 'list') { const r = await fetch(`${BASE}/api/room?id=${encodeURIComponent(id)}`, { headers: H }); console.log(JSON.stringify((await r.json()).objects)); process.exit(0); }
  const send = async (body) => { const r = await fetch(`${BASE}/api/room`, { method: 'POST', headers: H, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) }); return r.status === 204 ? 'ok' : `refusé (${r.status}) : ${await r.text()}`; };
  if (cmd !== 'add') console.log(await send({ id, op: cmd, ...(cmd === 'remove' ? { name: arg } : {}) }));
  else { // un objet, ou un tableau : les objets sans pos sont rangés sur une rangée devant l'utilisateur (liens exclus)
    let objs = JSON.parse(arg); if (!Array.isArray(objs)) objs = [objs]; const free = objs.filter((o) => !o.pos && o.shape !== 'link'); free.forEach((o, i) => { o.pos = [(i - (free.length - 1) / 2) * 0.7, 1.2, -1.6]; });
    const out = []; for (const o of objs) out.push(`${o.name}: ${await send({ id, op: 'set', obj: o })}`); console.log(out.join('\n')); }
} catch (e) { console.error('échec : ' + e.message); process.exit(1); }
