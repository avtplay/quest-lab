// Écouteur de consignes : à lancer par la session via l'outil Monitor (node listen.js <id-de-session>).
// Chaque ligne affichée sur stdout est une consigne dictée dans le casque : elle réveille la session, même inactive.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const id = process.argv[2];
if (!id) { console.error('usage : node listen.js <id-de-session>'); process.exit(1); }
let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.quest-lab', 'config.json'), 'utf8')); } catch {}
const BASE = (process.env.QUEST_LAB_URL || cfg.url || 'http://localhost:8080').replace(/\/$/, '');
const TOKEN = process.env.QUEST_LAB_TOKEN || cfg.token || '';

let fails = 0;
for (;;) {
  try {
    const r = await fetch(`${BASE}/api/listen?id=${encodeURIComponent(id)}&secs=25`, { headers: { 'x-quest-token': TOKEN }, signal: AbortSignal.timeout(35000) });
    if (r.status === 404) process.exit(0); // session inconnue ou terminée : on arrête
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const { texts = [] } = await r.json(); fails = 0;
    for (const t of texts) console.log(`[Quest Lab] Consigne dictée par l'utilisateur dans son casque : ${t.replace(/\s+/g, ' ')}`);
  } catch { await new Promise((ok) => setTimeout(ok, Math.min(30000, 1000 * 2 ** Math.min(fails++, 5)))); }
}
