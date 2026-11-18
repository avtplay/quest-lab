// Hook Claude Code -> bridge Quest Lab (local ou VPS). Silencieux, rapide, ne bloque jamais Claude Code.
// Config : ~/.quest-lab/config.json {url, token, machine} ou variables QUEST_LAB_URL / QUEST_LAB_TOKEN / QUEST_LAB_MACHINE.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadMemories } from './memory-scan.js';

const home = path.join(os.homedir(), '.quest-lab');
let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')); } catch {}
const BASE = (process.env.QUEST_LAB_URL || cfg.url || 'http://localhost:8080').replace(/\/$/, '');
const TOKEN = process.env.QUEST_LAB_TOKEN || cfg.token || '';
const MACHINE = (process.env.QUEST_LAB_MACHINE || cfg.machine || os.hostname()).replace(/[^a-zA-Z0-9._-]/g, '-');
const post = (p, body, ms = 1500) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-quest-token': TOKEN }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });

let raw = '';
process.stdin.on('data', (d) => raw += d);
process.stdin.on('end', async () => {
  try {
    const h = JSON.parse(raw), ev = h.hook_event_name;
    const e = { type: 'agent.status', id: `cc-${MACHINE}-${String(h.session_id || '').slice(0, 6)}`, label: path.basename(h.cwd || '') || 'session', kind: 'claude-code', machine: MACHINE };
    switch (ev) {
      case 'SessionStart': e.status = 'idle'; e.detail = 'session démarrée'; break;
      case 'UserPromptSubmit': e.status = 'thinking'; e.detail = String(h.prompt || '').slice(0, 80); break;
      case 'PreToolUse': e.status = 'working'; e.detail = h.tool_name; break;
      case 'PostToolUse': e.status = 'thinking'; e.detail = h.tool_name; break;
      case 'Notification': e.status = 'waiting'; e.detail = String(h.message || 'attend ta réponse').slice(0, 80); break;
      case 'Stop': e.status = 'idle'; e.detail = 'terminé'; break;
      case 'SessionEnd': e.type = 'agent.remove'; break;
      default: process.exit(0);
    }
    await post('/api/event', e);
    // synchronisation de la mémoire (au plus une fois toutes les 5 min, au début/fin de session)
    if (ev === 'SessionStart' || ev === 'Stop') {
      const stamp = path.join(home, 'last-sync'); let last = 0; try { last = +fs.readFileSync(stamp, 'utf8'); } catch {}
      if (Date.now() - last > 300000) { fs.mkdirSync(home, { recursive: true }); fs.writeFileSync(stamp, String(Date.now()));
        await post('/api/memory/push', { machine: MACHINE, memories: loadMemories() }, 4000); }
    }
  } catch {}
  process.exit(0);
});
