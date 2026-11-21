// Encodeur de QR code minimal, sans dépendance : mode octets, correction d'erreur L, versions 1 à 9 (jusqu'à 230 octets).
// qrMatrix(texte) renvoie une matrice de booléens (true = module sombre) ; la zone de silence (4 modules) est à ajouter par l'appelant.
const TOTAL = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292]; // mots de code par version
const EC = [null, [7, 1], [10, 1], [15, 1], [20, 1], [26, 1], [18, 2], [20, 2], [24, 2], [30, 2]]; // [mots de correction par bloc, blocs]
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46]];

const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function rsRemainder(data, n) { // reste de la division par le polynôme générateur de degré n
  let g = [1]; for (let i = 0; i < n; i++) { const next = new Array(g.length + 1).fill(0); g.forEach((c, j) => { next[j] ^= c; next[j + 1] ^= mul(c, EXP[i]); }); g = next; }
  const r = new Array(n).fill(0);
  for (const b of data) { const f = b ^ r.shift(); r.push(0); if (f) for (let i = 0; i < n; i++) r[i] ^= mul(g[i + 1], f); }
  return r;
}

export function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(text)];
  let v = 1; for (; v <= 9; v++) { const [ec, nb] = EC[v]; if (bytes.length <= TOTAL[v] - ec * nb - 2) break; }
  if (v > 9) throw new Error('texte trop long pour le QR');
  const [ecLen, nBlocks] = EC[v], dataCw = TOTAL[v] - ecLen * nBlocks;

  // 1. flux de bits : mode octets (0100), longueur sur 8 bits, données, terminaison, remplissage
  const bits = []; const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, 8); bytes.forEach((b) => put(b, 8));
  for (let i = 0; i < 4 && bits.length < dataCw * 8; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const cw = []; for (let i = 0; i < bits.length; i += 8) cw.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; cw.length < dataCw; pad ^= 0xec ^ 0x11) cw.push(pad);

  // 2. blocs, correction d'erreur Reed-Solomon, entrelacement
  const per = dataCw / nBlocks, blocks = [], ecs = [];
  for (let i = 0; i < nBlocks; i++) { const d = cw.slice(i * per, (i + 1) * per); blocks.push(d); ecs.push(rsRemainder(d, ecLen)); }
  const out = []; for (let i = 0; i < per; i++) blocks.forEach((b) => out.push(b[i])); for (let i = 0; i < ecLen; i++) ecs.forEach((e) => out.push(e[i]));

  // 3. motifs de fonction
  const size = 17 + 4 * v, M = Array.from({ length: size }, () => new Array(size).fill(false)), F = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { if (x >= 0 && y >= 0 && x < size && y < size) { M[y][x] = dark; F[y][x] = true; } };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)); set(cx + dx, cy + dy, d !== 2 && d !== 4); }
  const al = ALIGN[v];
  for (const ax of al) for (const ay of al) { if ((ax === 6 && ay === 6) || (ax === 6 && ay === al[al.length - 1]) || (ax === al[al.length - 1] && ay === 6)) continue; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }
  if (v >= 7) { let r = v; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25); const vb = (v << 12) | r; for (let i = 0; i < 18; i++) { const a = size - 11 + (i % 3), b = Math.floor(i / 3), d = ((vb >>> i) & 1) === 1; set(a, b, d); set(b, a, d); } }
  const formatBits = (mask) => { let data = (1 << 3) | mask, r = data; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537); return ((data << 10) | r) ^ 0x5412; }; // niveau L = 01
  const drawFormat = (mask) => {
    const b = formatBits(mask), bit = (i) => ((b >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i)); set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8)); for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i)); for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i)); set(8, size - 8, true);
  };
  drawFormat(0);

  // 4. placement des données en zigzag
  let k = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
      if (!F[y][x] && k < out.length * 8) { M[y][x] = ((out[k >> 3] >>> (7 - (k & 7))) & 1) === 1; k++; }
    }
  }

  // 5. masque : on garde le moins pénalisé
  const MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0, (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0];
  const penalty = (G) => {
    let p = 0; const lines = [];
    for (let i = 0; i < size; i++) { lines.push(G[i].map(Number).join('')); lines.push(G.map((r) => Number(r[i])).join('')); }
    for (const s of lines) { for (const m of s.matchAll(/0{5,}|1{5,}/g)) p += 3 + m[0].length - 5; for (const m of s.matchAll(/(?=(10111010000|00001011101))/g)) p += 40; }
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) if (G[y][x] === G[y][x + 1] && G[y][x] === G[y + 1][x] && G[y][x] === G[y + 1][x + 1]) p += 3;
    const dark = G.flat().filter(Boolean).length, tot = size * size; p += (Math.ceil(Math.abs(dark * 20 - tot * 10) / tot) - 1) * 10; return p;
  };
  let best = null, bestP = Infinity, bestMask = 0;
  for (let m = 0; m < 8; m++) {
    const G = M.map((row, y) => row.map((d, x) => (F[y][x] ? d : d !== MASKS[m](x, y))));
    const saved = M.map((r) => r.slice()); // le format dépend du masque : on l'écrit sur la copie
    const keep = M; for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) keep[y][x] = G[y][x]; drawFormat(m);
    const P = penalty(M); if (P < bestP) { bestP = P; best = M.map((r) => r.slice()); bestMask = m; }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) M[y][x] = saved[y][x];
  }
  return best;
}
