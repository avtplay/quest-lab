// Récupère les schémas dessinés dans le casque : « [[board:<id>]] » dans une consigne devient le chemin d'une image locale à lire.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export async function resolveBoards(text, base, token) {
  const re = /\[\[board:([A-Za-z0-9._-]{1,80})\]\]/g; let out = String(text), m;
  for (const [tag, id] of [...String(text).matchAll(re)]) {
    try {
      const r = await fetch(`${base}/api/board?id=${encodeURIComponent(id)}`, { headers: { 'x-quest-token': token }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const dir = path.join(os.homedir(), '.quest-lab', 'boards'); fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${id}-${Date.now()}.png`); fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
      for (const f of fs.readdirSync(dir).sort().slice(0, -10)) fs.rmSync(path.join(dir, f), { force: true }); // garde les 10 derniers
      out = out.replace(tag, `${file} (lis cette image avec l'outil Read)`);
    } catch (e) { out = out.replace(tag, `(schéma indisponible : ${e.message})`); }
  }
  return out;
}
