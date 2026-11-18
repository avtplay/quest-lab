// Installe les hooks Quest Lab dans ~/.claude/settings.json (fusion, sauvegarde, idempotent).
//   node client/install.mjs --url https://quest.exemple.fr --token XXXX [--machine nom] [--no-post-tool]
//   (le jeton peut aussi arriver par stdin : --token-stdin)
//   node client/install.mjs --control        (autorise le pilotage depuis le casque : permissions + consignes)
//   node client/install.mjs --no-control     (le retire)
//   node client/install.mjs --history        (partage la conversation avec le bridge, pour la lire dans le casque ; --no-history pour retirer)
//   node client/install.mjs --no-listen      (n'arme pas l'écouteur de réveil au démarrage des sessions)
//   node client/install.mjs --runner-dir ~/projets/x   (autorise ce dossier pour le lanceur de sessions ; répétable)
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

const tokenIn = args.includes('--token-stdin') ? fs.readFileSync(0, 'utf8').trim() : undefined; // le jeton passe par stdin : il n'apparaît pas dans la liste des processus
const url = arg('url'); fs.mkdirSync(homeDir, { recursive: true });
const cfgPath = path.join(homeDir, 'config.json'); let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch {}
if (url) { cfg.url = url; cfg.token = arg('token') || tokenIn || ''; cfg.machine = arg('machine') || os.hostname(); }
else if (arg('machine')) cfg.machine = arg('machine');
if (args.includes('--history')) cfg.history = true; if (args.includes('--no-history')) cfg.history = false;
for (let k = 0; k < args.length; k++) if (args[k] === '--runner-dir' && args[k + 1]) { // autorise un dossier pour le lanceur de sessions (répétable)
  const d = path.resolve(args[k + 1].replace(/^~(?=\/|$)/, os.homedir())); if (!fs.existsSync(d)) { console.error(`Dossier introuvable : ${d}`); process.exit(1); }
  cfg.runner ??= {}; cfg.runner.dirs ??= []; if (!cfg.runner.dirs.includes(d)) cfg.runner.dirs.push(d); k++;
}
if (args.includes('--no-listen')) cfg.listen = false; if (args.includes('--listen')) cfg.listen = true;
if (args.includes('--control')) cfg.control = true; if (args.includes('--no-control')) cfg.control = false;
if (Object.keys(cfg).length) fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), { mode: 0o600 });
else console.log('Aucune --url : le hook enverra à http://localhost:8080');
const local = !(url || cfg.url) || /localhost|127\.0\.0\.1/.test(url || cfg.url);
const events = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Notification', 'Stop', 'SessionEnd'];
if (local && !args.includes('--no-post-tool') || args.includes('--post-tool') || cfg.control) events.push('PostToolUse'); // un aller-retour réseau de plus par outil ; indispensable au pilotage
if (cfg.control) events.push('PermissionRequest');
for (const ev of events) ((s.hooks ??= {})[ev] ??= []).push({ hooks: [{ type: 'command', command: `${MARK} node "${hook}"`, timeout: ev === 'PermissionRequest' ? 60 : 3 }] });
fs.mkdirSync(path.dirname(settingsPath), { recursive: true }); fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2));
console.log(`Hooks installés (${events.join(', ')}).\nBridge : ${cfg.url || 'http://localhost:8080'}\nHistorique partagé : ${cfg.history ? 'OUI (conversation visible dans le casque)' : 'non'}\nRéveil des sessions inactives : ${cfg.control && cfg.listen !== false ? 'OUI (écouteur armé au démarrage des sessions)' : 'non'}\nLanceur de sessions : ${cfg.runner?.dirs?.length ? cfg.runner.dirs.length + ' dossier(s) autorisé(s) — à démarrer avec : node ' + path.join(path.dirname(hook), 'runner.js') : 'aucun dossier autorisé'}\nPilotage depuis le casque : ${cfg.control ? 'ACTIVÉ (permissions + consignes)' : 'désactivé (--control pour l\'activer)'}\nSauvegarde : ${settingsPath}.bak-questlab\nLes sessions Claude Code déjà ouvertes doivent être relancées pour les prendre en compte.`);
