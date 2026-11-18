// Rendu Markdown léger sur canvas : titres, gras, italique, code, listes, citations, tableaux, liens, séparateurs.
const SANS = (b, i, size) => `${i ? 'italic ' : ''}${b ? '700 ' : ''}${size}px system-ui, sans-serif`;
const MONO = (size) => `${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;

function inline(src) {
  const runs = [], re = /(\*\*\*[^*\n]+\*\*\*|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\s][^*\n]*\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\n]+\))/g;
  let last = 0, m;
  while ((m = re.exec(src))) {
    if (m.index > last) runs.push({ t: src.slice(last, m.index) });
    const k = m[0];
    if (k.startsWith('***')) runs.push({ t: k.slice(3, -3), b: 1, i: 1 });
    else if (k.startsWith('**') || k.startsWith('__')) runs.push({ t: k.slice(2, -2), b: 1 });
    else if (k[0] === '*') runs.push({ t: k.slice(1, -1), i: 1 });
    else if (k[0] === '`') runs.push({ t: k.slice(1, -1), code: 1 });
    else runs.push({ t: k.match(/\[([^\]]+)\]/)[1], link: 1 });
    last = m.index + k.length;
  }
  if (last < src.length) runs.push({ t: src.slice(last) });
  return runs;
}
// coupe des runs stylés en lignes de segments { text, font, color, bg }
function layout(g, runs, maxW, { size = 34, color = '#f1e8d6', bold = false, italic = false } = {}) {
  const lines = [[]]; let x = 0;
  for (const r of runs) {
    const font = r.code ? MONO(size - 4) : SANS(r.b || bold, r.i || italic, size), col = r.code ? '#ffd9a8' : r.link ? '#8fb4ff' : color;
    for (const tok of r.t.split(/(\s+)/).filter(Boolean)) {
      g.font = font; const space = !tok.trim(); let w = g.measureText(tok).width;
      if (space && x === 0) continue;
      if (x + w > maxW && x > 0 && !space) { lines.push([]); x = 0; }
      if (w > maxW) { // mot plus large que la ligne (chemin, URL) : on le découpe
        let piece = '';
        for (const ch of tok) { if (g.measureText(piece + ch).width > maxW - x) { lines.at(-1).push({ text: piece, font, color: col, bg: r.code }); lines.push([]); x = 0; piece = ''; } piece += ch; }
        w = g.measureText(piece).width; if (piece) { lines.at(-1).push({ text: piece, font, color: col, bg: r.code }); x += w; }
        continue;
      }
      lines.at(-1).push({ text: tok, font, color: col, bg: r.code }); x += w;
    }
  }
  return lines.filter((l, i) => l.length || lines.length === 1 || i === 0);
}
function chunk(g, text, maxW) { // découpe monospace par caractères
  const out = []; let cur = '';
  for (const ch of text) { if (g.measureText(cur + ch).width > maxW) { out.push(cur); cur = ''; } cur += ch; }
  out.push(cur); return out;
}

export function mdRows(g, text, maxW, color = '#f1e8d6') {
  const rows = []; let code = false;
  for (const raw of String(text).split('\n')) {
    if (/^\s*```/.test(raw)) { code = !code; rows.push({ h: code ? 10 : 14 }); continue; }
    if (code) { g.font = MONO(28); for (const part of chunk(g, raw || ' ', maxW - 50)) rows.push({ h: 38, x: 80, bgRow: true, segs: [{ text: part, font: MONO(28), color: '#cfe3ff' }] }); continue; }
    if (!raw.trim()) { rows.push({ h: 14 }); continue; }
    let m;
    if ((m = raw.match(/^(#{1,6})\s+(.*)$/))) {
      const size = m[1].length === 1 ? 44 : m[1].length === 2 ? 40 : 36;
      for (const ln of layout(g, inline(m[2]), maxW, { size, bold: true, color: '#c4d4ff' })) rows.push({ h: size + 16, x: 60, segs: ln });
    } else if ((m = raw.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/))) {
      const ind = Math.min(3, Math.floor(m[1].length / 2)) * 36, bullet = /\d/.test(m[2]) ? m[2] : '•';
      layout(g, inline(m[3]), maxW - ind - 44, { color }).forEach((ln, k) => rows.push({ h: 46, x: 60 + ind + 44, bullet: k === 0 ? bullet : null, bx: 60 + ind + 6, segs: ln }));
    } else if ((m = raw.match(/^>\s?(.*)$/))) {
      for (const ln of layout(g, inline(m[1]), maxW - 40, { color: '#a9b6e0', italic: true })) rows.push({ h: 46, x: 100, bar: true, segs: ln });
    } else if (/^\s*([-*_])\1{2,}\s*$/.test(raw)) rows.push({ h: 30, hr: true });
    else if (/^\s*\|.*\|\s*$/.test(raw)) {
      if (/^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(raw) && /-/.test(raw)) continue; // ligne de séparation d'un tableau
      const cells = raw.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim().replace(/\*\*|`/g, '')).join('  │  ');
      g.font = MONO(28); for (const part of chunk(g, cells, maxW)) rows.push({ h: 38, x: 60, segs: [{ text: part, font: MONO(28), color: '#d9e2ff' }] });
    } else for (const ln of layout(g, inline(raw), maxW, { color })) rows.push({ h: 46, x: 60, segs: ln });
  }
  return rows;
}

// dessine une ligne ; y = haut de la ligne
export function drawRow(g, r, y, maxW) {
  if (r.bgRow) { g.fillStyle = 'rgba(8,12,30,.85)'; g.fillRect(60, y, maxW + 20, r.h); }
  if (r.hr) { g.fillStyle = 'rgba(140,160,255,.35)'; g.fillRect(60, y + r.h / 2, maxW, 2); return; }
  if (r.bar) { g.fillStyle = 'rgba(120,150,255,.55)'; g.fillRect(66, y + 4, 6, r.h - 8); }
  if (r.bullet) { g.font = SANS(false, false, 34); g.fillStyle = '#9db4ff'; g.fillText(r.bullet, r.bx, y + r.h - 12); }
  if (r.segs) { let x = r.x; for (const s of r.segs) { g.font = s.font; const w = g.measureText(s.text).width;
    if (s.bg) { g.fillStyle = 'rgba(120,150,255,.2)'; g.fillRect(x - 3, y + 6, w + 6, r.h - 12); }
    g.fillStyle = s.color; g.fillText(s.text, x, y + r.h - 12); x += w; } }
  else if (r.text) { g.font = r.font; g.fillStyle = r.color; g.fillText(r.text, r.x, y + r.h - 10); }
}
