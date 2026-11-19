// Lit la mémoire Claude Code d'une machine : ~/.claude/projects/*/memory/*.md (partagé par le bridge et le hook).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function loadMemories(root = path.join(os.homedir(), '.claude', 'projects')) {
  const out = []; let dirs = []; try { dirs = fs.readdirSync(root); } catch {}
  for (const d of dirs) {
    const md = path.join(root, d, 'memory'); let files = [];
    try { files = fs.readdirSync(md).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md'); } catch { continue; }
    const project = d.replace(/^-home-[^-]+-?/, '').replace(/^projects-/, '') || 'home';
    for (const f of files) {
      let txt; try { txt = fs.readFileSync(path.join(md, f), 'utf8'); } catch { continue; }
      const m = txt.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/); const fm = m ? m[1] : '', body = (m ? m[2] : txt).trim();
      const get = (k) => (fm.match(new RegExp('^\\s*' + k + ':\\s*(.*)$', 'm')) || [])[1]?.trim().replace(/^"(.*)"$/, '$1') || '';
      const file = f.replace(/\.md$/, '');
      out.push({ project, file, name: get('name') || file, description: get('description'), type: get('type') || 'project',
        body: body.slice(0, 3000), size: body.length, links: [...body.matchAll(/\[\[([^\]]+)\]\]/g)].map((x) => x[1]) });
    }
  }
  return out;
}
