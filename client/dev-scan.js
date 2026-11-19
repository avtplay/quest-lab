// Atelier : extrait d'une transcription Claude Code les fichiers modifiés (diffs), les commandes (sortie) et la liste de tâches.
import fs from 'node:fs';

export const redact = (t) => String(t).replace(/((?:api[_-]?key|token|secret|password|passwd|authorization)["']?\s*[=:]\s*["']?)[^\s"']+/gi, '$1***').replace(/\b(sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{16,})/g, '***');
export const dl = (pfx, t, n = 14) => { const ls = String(t ?? '').split('\n'); return ls.slice(0, n).map((l) => pfx + l.slice(0, 160)).join('\n') + (ls.length > n ? `\n${pfx}… (+${ls.length - n} lignes)` : ''); };
export const failed = (out, isErr) => isErr === true || /\b(error|erreur|failed|fail|traceback|exception|not found)\b/i.test(String(out).slice(-600));
// diff lisible d'un appel d'outil d'écriture, ou null
export function changeOf(tool, i = {}) {
  if (tool === 'Edit') return { file: i.file_path, diff: redact(dl('- ', i.old_string, 8) + '\n' + dl('+ ', i.new_string, 8)) };
  if (tool === 'MultiEdit') return { file: i.file_path, diff: redact((i.edits || []).slice(0, 3).map((e) => dl('- ', e.old_string, 4) + '\n' + dl('+ ', e.new_string, 4)).join('\n')) };
  if (tool === 'Write') return { file: i.file_path, diff: redact(dl('+ ', i.content, 12)) };
  return null;
}
const text = (c) => typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : '';

export function readDev(file) {
  let fd; try { fd = fs.openSync(file, 'r'); } catch { return null; }
  try {
    const size = fs.fstatSync(fd).size, len = Math.min(size, 6 * 1024 * 1024), b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, size - len);
    let raw = b.toString('utf8'); if (size > len) raw = raw.slice(raw.indexOf('\n') + 1);
    const uses = new Map(), results = new Map(), order = []; let todos = null;
    for (const l of raw.split('\n')) {
      if (l.length > 1500000 || !l.includes('tool_')) continue; let o; try { o = JSON.parse(l); } catch { continue; } if (o.isSidechain) continue;
      const c = o.message?.content; if (!Array.isArray(c)) continue; const t = Date.parse(o.timestamp) || 0;
      for (const x of c) {
        if (o.type === 'assistant' && x.type === 'tool_use') { uses.set(x.id, { name: x.name, input: x.input || {}, t }); order.push(x.id); if (x.name === 'TodoWrite' && Array.isArray(x.input?.todos)) todos = x.input.todos; }
        else if (o.type === 'user' && x.type === 'tool_result') results.set(x.tool_use_id, { out: text(x.content), err: x.is_error === true });
      }
    }
    const changes = [], output = [];
    for (const id of order) { const u = uses.get(id), r = results.get(id);
      const ch = changeOf(u.name, u.input); if (ch) changes.push({ t: u.t, tool: u.name, ...ch });
      else if (u.name === 'Bash') { const out = redact((r?.out || '').slice(-1800)); output.push({ t: u.t, cmd: redact(String(u.input.command || '').slice(0, 300)), out, error: failed(out, r?.err) }); } }
    return { changes: changes.slice(-60), output: output.slice(-40), todos };
  } catch { return null; } finally { fs.closeSync(fd); }
}
