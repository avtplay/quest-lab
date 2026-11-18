// Extrait les derniers échanges d'une transcription Claude Code (.jsonl) : toi, Claude, et les outils utilisés.
import fs from 'node:fs';

// les notifications automatiques (écouteur du casque, tâches) deviennent une ligne lisible ; les autres sont masquées
const notif = (m, body) => { const ev = (body.match(/<event>([\s\S]*?)<\/event>/) || [])[1]?.trim() || ''; return ev.startsWith('[Quest Lab]') ? '🎙 ' + ev.replace(/^\[Quest Lab\][^:]*:\s*/, '') : ''; };
const strip = (t) => String(t).replace(/<task-notification>([\s\S]*?)<\/task-notification>/g, notif).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').replace(/<(?:local-command|command)-[a-z-]+>[\s\S]*?<\/(?:local-command|command)-[a-z-]+>/g, '').trim();
function toolLine(b) {
  const i = b.input || {};
  const arg = b.name === 'Bash' ? i.command : (i.file_path || i.pattern || i.url || i.description || '');
  return `${b.name}${arg ? ' : ' + String(arg).replace(/\s+/g, ' ').slice(0, 110) : ''}`;
}
function parse(txt) {
  const out = [];
  for (const l of txt.split('\n')) {
    if (l.length > 1500000) continue; // lignes énormes (captures d'écran en base64) : ignorées
    let o; try { o = JSON.parse(l); } catch { continue; }
    if ((o.type !== 'user' && o.type !== 'assistant') || o.isSidechain || o.isMeta) continue;
    const c = o.message?.content;
    if (o.type === 'user') {
      const t = strip(typeof c === 'string' ? c : (c || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n'));
      if (t) out.push({ role: 'user', text: t.slice(0, 3000) });
    } else for (const b of Array.isArray(c) ? c : []) {
      if (b.type === 'text' && b.text?.trim()) { const last = out[out.length - 1]; if (last?.role === 'assistant') last.text = (last.text + '\n' + b.text.trim()).slice(0, 8000); else out.push({ role: 'assistant', text: b.text.trim().slice(0, 8000) }); }
      else if (b.type === 'tool_use') out.push({ role: 'tool', text: toolLine(b) });
    }
  }
  return out;
}
// Lit la fin du fichier et élargit la fenêtre tant qu'il manque des messages (les captures d'écran gonflent beaucoup de lignes).
export function readTranscript(file, max = 40) {
  let fd; try { fd = fs.openSync(file, 'r'); } catch { return []; }
  try {
    const size = fs.fstatSync(fd).size; let len = 512 * 1024, out = [];
    for (;;) {
      len = Math.min(size, len); const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, size - len);
      let txt = b.toString('utf8'); if (size > len) txt = txt.slice(txt.indexOf('\n') + 1);
      out = parse(txt);
      if (out.length >= max || len >= size || len >= 32 * 1024 * 1024) break; len *= 3;
    }
    return out.slice(-max);
  } catch { return []; } finally { fs.closeSync(fd); }
}
