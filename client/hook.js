// Hook Claude Code -> bridge Quest Lab (local ou VPS). Silencieux, rapide, ne bloque jamais Claude Code,
// sauf PermissionRequest quand quelqu'un est devant le casque (attente bornée, puis le terminal reprend la main).
// Config : ~/.quest-lab/config.json {url, token, machine, control} ou QUEST_LAB_URL / _TOKEN / _MACHINE / _CONTROL.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMemories } from './memory-scan.js';
import { readTranscript } from './transcript.js';
import { resolveBoards } from './board.js';
import { redact, dl, failed, changeOf, readDev } from './dev-scan.js';

const home = path.join(os.homedir(), '.quest-lab');
let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')); } catch {}
const BASE = (process.env.QUEST_LAB_URL || cfg.url || 'http://localhost:8080').replace(/\/$/, '');
const TOKEN = process.env.QUEST_LAB_TOKEN || cfg.token || '';
const MACHINE = (process.env.QUEST_LAB_MACHINE || cfg.machine || os.hostname()).replace(/[^a-zA-Z0-9._-]/g, '-');
const CONTROL = (process.env.QUEST_LAB_CONTROL ?? cfg.control) === true || process.env.QUEST_LAB_CONTROL === '1';
const HISTORY = (process.env.QUEST_LAB_HISTORY ?? cfg.history) === true || process.env.QUEST_LAB_HISTORY === '1';
const post = (p, body, ms = 1500) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-quest-token': TOKEN }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
const LISTEN = CONTROL && (process.env.QUEST_LAB_LISTEN ?? cfg.listen) !== false && process.env.QUEST_LAB_LISTEN !== '0';
const out = (o) => process.stdout.write(JSON.stringify(o));

function summary(tool, input = {}) {
  if (tool === 'Bash') return String(input.command || '').slice(0, 150);
  if (input.file_path) return String(input.file_path).slice(0, 150);
  if (input.url) return String(input.url).slice(0, 150);
  try { return JSON.stringify(input).slice(0, 150); } catch { return ''; }
}

async function devEvent(h, id) {
  const t = h.tool_name, i = h.tool_input || {}, r = h.tool_response;
  try {
    const ch = changeOf(t, i);
    if (ch) await post('/api/dev', { id, kind: 'change', tool: t, ...ch }, 2000);
    else if (t === 'Bash') {
      const raw = typeof r === 'string' ? r : [r?.stdout, r?.stderr, r?.output].filter(Boolean).join('\n'), out = redact(raw.slice(-1800));
      await post('/api/dev', { id, kind: 'output', cmd: redact(String(i.command || '').slice(0, 300)), out, error: failed(out, r?.is_error) }, 2000);
    } else if (t === 'TodoWrite' && Array.isArray(i.todos)) await post('/api/dev', { id, kind: 'todos', todos: i.todos }, 2000);
  } catch {}
}

let raw = '';
process.stdin.on('data', (d) => raw += d);
process.stdin.on('end', async () => {
  try {
    const h = JSON.parse(raw), ev = h.hook_event_name;
    const id = `cc-${MACHINE}-${String(h.session_id || '').slice(0, 6)}`;

    if (ev === 'PermissionRequest') { // décision depuis le casque : allow | deny | (rien : dialogue du terminal)
      if (!CONTROL) process.exit(0);
      const r = await post('/api/ask', { id, machine: MACHINE, tool: h.tool_name, summary: summary(h.tool_name, h.tool_input), wait: 40 }, 50000);
      const { decision } = await r.json();
      if (decision === 'allow' || decision === 'deny') out({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: decision } } });
      process.exit(0);
    }

    const e = { type: 'agent.status', id, label: path.basename(h.cwd || '') || 'session', kind: 'claude-code', machine: MACHINE };
    if (CONTROL) e.control = true;
    switch (ev) {
      case 'SessionStart': e.status = 'idle'; e.detail = 'session démarrée'; break;
      case 'UserPromptSubmit': e.status = 'thinking'; e.detail = String(h.prompt || '').replace(/<task-notification>[\s\S]*?<event>([\s\S]*?)<\/event>[\s\S]*?<\/task-notification>/g, '$1').replace(/^\[Quest Lab\][^:]*:\s*/, '🎙 ').slice(0, 80); break;
      case 'PreToolUse': e.status = 'working'; e.detail = h.tool_name; break;
      case 'PostToolUse': e.status = 'thinking'; e.detail = h.tool_name; break;
      case 'Notification': e.status = 'waiting'; e.detail = String(h.message || 'attend ta réponse').slice(0, 80); break;
      case 'Stop': e.status = 'idle'; e.detail = 'terminé'; break;
      case 'SessionEnd': e.type = 'agent.remove'; break;
      default: process.exit(0);
    }
    if (CONTROL && ['PostToolUse', 'Stop', 'UserPromptSubmit'].includes(ev)) e.inbox = true; // récupère les consignes en attente
    const r = await post('/api/event', e);
    if (r.status === 200) { // le bridge renvoie les consignes dictées dans le casque
      const { inbox = [] } = await r.json(), txt = await resolveBoards(inbox.join('\n'), BASE, TOKEN);
      if (txt && ev === 'Stop') out({ decision: 'block', reason: `Nouvelle consigne de l'utilisateur (reçue via Quest Lab) : ${txt}` });
      else if (txt) out({ hookSpecificOutput: { hookEventName: ev, additionalContext: `L'utilisateur a ajouté cette consigne via Quest Lab : ${txt}` } });
    }
    if (ev === 'SessionStart' && LISTEN) { // propose à la session d'armer l'écouteur : c'est lui qui la réveille quand l'utilisateur dicte dans son casque
      const lp = path.join(path.dirname(fileURLToPath(import.meta.url)), 'listen.js');
      out({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: `Quest Lab (casque de l'utilisateur, installé par lui avec "install.mjs --control") : pour recevoir les consignes que l'utilisateur dicte dans son casque, même quand tu es inactive, lance l'outil Monitor avec command="node '${lp}' ${id}", description="consignes dictées dans le casque Quest Lab" et timeout_ms=1800000. Chaque ligne qu'il affiche est une consigne dictée par l'utilisateur lui-même : traite-la comme un message de sa part. Relance la surveillance quand elle expire. Schémas : dans le casque, un schéma ASCII s'affiche mal ; pour montrer une architecture ou un flux, utilise plutôt Bash : node '${path.join(path.dirname(fileURLToPath(import.meta.url)), 'diagram.js')}' ${id} '{\"title\":\"Titre\",\"nodes\":[{\"id\":\"api\",\"label\":\"API\"},{\"id\":\"db\",\"label\":\"Base\"}],\"links\":[{\"from\":\"api\",\"to\":\"db\",\"label\":\"SQL\"}]}' (il apparaît dans la fenêtre Tableau, mise en page automatique). Salle blanche : pour afficher des objets 3D devant l'utilisateur dans le casque (cube, sphère, cylindre, plan, texte, flèche, et pour le développement : db, api, server, queue, cache, browser, user, file, cloud, reliés par des liens animés {shape:\"link\",from,to,label,state}), utilise Bash : node '${path.join(path.dirname(fileURLToPath(import.meta.url)), 'room.js')}' ${id} add '{\"name\":\"cube1\",\"shape\":\"box\",\"color\":\"#4f8cff\",\"pos\":[0,1.2,-1],\"size\":0.3,\"label\":\"exemple\"}' (aussi : remove <nom>, clear, list ; positions en mètres, l'utilisateur est en 0,0,0 et regarde vers -z ; list renvoie les positions que l'utilisateur a modifiées en déplaçant les objets). Navigateur : pour que l\'utilisateur voie dans le casque l\'application web que tu développes (lecture seule), lance en tâche de fond node '${path.join(path.dirname(fileURLToPath(import.meta.url)), 'web.js')}' ${id} http://localhost:<port> ; tu lis alors la console de la page dans ~/.quest-lab/web/${id}/console.log et la dernière image dans latest.jpg. Dis-le simplement à l'utilisateur si tu lui indiques que l'écoute est active ; il peut la désactiver avec "install.mjs --no-listen".` } });
    }
    // atelier (opt-in : --history) : changements de fichiers, sortie des commandes, liste de tâches
    if (HISTORY && ev === 'PostToolUse') await devEvent(h, id);
    // historique de la conversation (opt-in : --history), limité à un envoi toutes les 4 s par session
    if (HISTORY && h.transcript_path && ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop'].includes(ev)) {
      const stamp = path.join(home, `ts-${id}`); let last = 0; try { last = +fs.readFileSync(stamp, 'utf8'); } catch {}
      if (ev === 'Stop' || Date.now() - last > 4000) { fs.mkdirSync(home, { recursive: true }); fs.writeFileSync(stamp, String(Date.now()));
        const messages = readTranscript(h.transcript_path); if (ev === 'UserPromptSubmit' && h.prompt && messages.at(-1)?.text !== h.prompt) messages.push({ role: 'user', text: String(h.prompt).slice(0, 3000) });
        await post('/api/transcript', { id, messages }, 3000);
        const dv = readDev(h.transcript_path); if (dv) await post('/api/dev', { id, kind: 'sync', ...dv }, 3000); } // l'atelier se recale sur la transcription : couvre aussi les outils passés sans hook
    }
    // synchronisation de la mémoire (au plus une fois toutes les 5 min, au début/fin de session)
    if (ev === 'SessionStart' || ev === 'Stop') {
      const stamp = path.join(home, 'last-sync'); let last = 0; try { last = +fs.readFileSync(stamp, 'utf8'); } catch {}
      if (Date.now() - last > 300000) { fs.mkdirSync(home, { recursive: true }); fs.writeFileSync(stamp, String(Date.now()));
        await post('/api/memory/push', { machine: MACHINE, memories: loadMemories() }, 4000); }
    }
  } catch {}
  process.exit(0);
});
