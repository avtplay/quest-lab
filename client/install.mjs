// Installe les hooks Quest Lab dans ~/.claude/settings.json (fusion, sauvegarde, idempotent).
//   node client/install.mjs --url https://quest.exemple.fr --token XXXX [--machine nom] [--no-post-tool]
//   node client/install.mjs --uninstall
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2), arg = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : undefined; };
const settingsPath = path.join(os.homedir(), '.claude', 'settings.json'), homeDir = path.join(os.homedir(), '.quest-lab');
const hook = path.join(path.dirname(fileURLToPath(import.meta.url)), 'hook.js'), MARK = 'QUEST_LAB_HOOK=1';
let s = {}; try { s = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch {}
if (fs.existsSync(settingsPath)) fs.copyFileSync(settingsPath, settingsPath + '.bak-questlab');
const mine = (h) => (h.command || '').includes(MARK) || /quest-lab\/(client\/)?hook\.js/.test(h.command || '');
for (const ev of Object.keys(s.hooks || {})) { // retire nos anciennes entrées (aussi l'ancien emplacement)
  s.hooks[ev] = s.hooks[ev].map((e) => ({ ...e, hooks: (e.hooks || []).filter((h) => !mine(h)) })).filter((e) => e.hooks.length);
  if (!s.hooks[ev].length) delete s.hooks[ev];
}
if (args.includes('--uninstall')) { if (!Object.keys(s.hooks || {}).length) delete s.hooks; fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2)); console.log('Hooks Quest Lab retirés.'); process.exit(0); }

const url = arg('url'); fs.mkdirSync(homeDir, { recursive: true });
if (url) { fs.writeFileSync(path.join(homeDir, 'config.json'), JSON.stringify({ url, token: arg('token') || '', machine: arg('machine') || os.hostname() }, null, 2), { mode: 0o600 }); }
else if (!fs.existsSync(path.join(homeDir, 'config.json'))) console.log('Aucune --url : le hook enverra à http://localhost:8080');
const local = !url || /localhost|127\.0\.0\.1/.test(url);
const events = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Notification', 'Stop', 'SessionEnd'];
if (local && !args.includes('--no-post-tool') || args.includes('--post-tool')) events.push('PostToolUse'); // coûte un aller-retour réseau de plus par outil
for (const ev of events) ((s.hooks ??= {})[ev] ??= []).push({ hooks: [{ type: 'command', command: `${MARK} node "${hook}"`, timeout: 3 }] });
fs.mkdirSync(path.dirname(settingsPath), { recursive: true }); fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2));
console.log(`Hooks installés (${events.join(', ')}).\nBridge : ${url || 'http://localhost:8080'}\nSauvegarde : ${settingsPath}.bak-questlab\nLes sessions Claude Code déjà ouvertes doivent être relancées pour les prendre en compte.`);
