/**
 * Onde está o documento na foto. Sem modelo treinado:
 * 1. Otsu separa claro de escuro (papel × mesa) pelo limiar que melhor divide o histograma;
 * 2. a maior região conectada de um dos lados é a candidata;
 * 3. o contorno convexo dela dá os pontos extremos, e o quadrilátero de maior área com
 *    vértices nesse contorno são os quatro cantos;
 * 4. a candidata só vale se for de fato um quadrilátero cheio (a região preenche o quadrilátero).
 * Funciona com fundo que contrasta com o documento; sem contraste, devolve null e a análise
 * segue sobre a foto inteira.
 */
import { quadArea, type Pt, type Quad } from './geometry';
import type { Gray } from './image';

export interface Detection {
  /** Cantos em frações da imagem (0–1), horário a partir do superior esquerdo. */
  quad: Quad;
  /** Fração da foto ocupada pelo documento. */
  area: number;
  /** Lados da foto em que o documento encosta (provavelmente cortado). */
  touches: Array<'top' | 'right' | 'bottom' | 'left'>;
}

function otsu(g: Gray): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < g.v.length; i++) hist[Math.max(0, Math.min(255, Math.round(g.v[i])))]++;
  const n = g.v.length;
  let sum = 0;
  for (let b = 0; b < 256; b++) sum += b * hist[b];
  let wB = 0;
  let sumB = 0;
  let best = 0;
  let t = 128;
  for (let b = 0; b < 256; b++) {
    wB += hist[b];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += b * hist[b];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > best) {
      best = between;
      t = b;
    }
  }
  return t;
}

/** Soma em caixa (2r+1)² por imagem integral: base de dilatação e erosão em O(n). */
function boxCount(mask: Uint8Array, w: number, h: number, r: number): Int32Array {
  const I = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += mask[y * w + x];
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row;
    }
  }
  const out = new Int32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      out[y * w + x] = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
    }
  }
  return out;
}

/**
 * Fechamento (dilata e depois erode): une partes do documento separadas por faixas escuras
 * finas, como um cabeçalho que encosta na mesa pelas laterais, sem arredondar os cantos.
 */
function close(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const grown = boxCount(mask, w, h, r);
  const dil = new Uint8Array(mask.length);
  for (let i = 0; i < dil.length; i++) dil[i] = grown[i] > 0 ? 1 : 0;
  const kept = boxCount(dil, w, h, r);
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    const ny = Math.min(h, y + r + 1) - Math.max(0, y - r);
    for (let x = 0; x < w; x++) {
      const nx = Math.min(w, x + r + 1) - Math.max(0, x - r);
      out[y * w + x] = kept[y * w + x] === nx * ny ? 1 : 0;
    }
  }
  return out;
}

/** Erosão 3×3: corta pontes finas entre o documento e objetos claros encostados nele. */
function erode(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      out[i] = mask[i] & mask[i - 1] & mask[i + 1] & mask[i - w] & mask[i + w];
    }
  }
  return out;
}

/** Maior componente conectado: para cada linha, o pixel mais à esquerda e o mais à direita. */
function largest(mask: Uint8Array, w: number, h: number) {
  const label = new Int32Array(mask.length).fill(-1);
  let best = { size: 0, id: -1 };
  let id = 0;
  const stack: number[] = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || label[s] >= 0) continue;
    let size = 0;
    label[s] = id;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j >= 0 && j < mask.length && mask[j] && label[j] < 0) {
          label[j] = id;
          stack.push(j);
        }
      }
    }
    if (size > best.size) best = { size, id };
    id++;
  }
  if (best.id < 0) return null;
  const left: Pt[] = [];
  const right: Pt[] = [];
  let span = 0;
  for (let y = 0; y < h; y++) {
    let x0 = -1;
    let x1 = -1;
    for (let x = 0; x < w; x++) {
      if (label[y * w + x] !== best.id) continue;
      if (x0 < 0) x0 = x;
      x1 = x;
    }
    if (x0 < 0) continue;
    // Bordas do pixel, não o centro: o contorno cobre a linha inteira.
    left.push({ x: x0, y }, { x: x0, y: y + 1 });
    right.push({ x: x1 + 1, y }, { x: x1 + 1, y: y + 1 });
    span += x1 - x0 + 1; // área com os buracos (texto, foto 3×4) preenchidos
  }
  return { points: [...left, ...right], span, size: best.size };
}

/** Contorno convexo (cadeia monótona de Andrew). */
function hull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/**
 * Quadrilátero de maior área com vértices no contorno: parte dos extremos diagonais e
 * melhora um canto de cada vez até estabilizar (poucas voltas bastam).
 */
function maxQuad(h: Pt[]): Quad {
  const pick = (f: (p: Pt) => number) => h.reduce((a, b) => (f(b) > f(a) ? b : a));
  const q: Quad = [pick((p) => -p.x - p.y), pick((p) => p.x - p.y), pick((p) => p.x + p.y), pick((p) => -p.x + p.y)];
  for (let round = 0; round < 6; round++) {
    let changed = false;
    for (let c = 0; c < 4; c++) {
      let best = quadArea(q);
      for (const p of h) {
        const trial = [...q] as Quad;
        trial[c] = p;
        const a = quadArea(trial);
        if (a > best + 1e-6) {
          best = a;
          q[c] = p;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return q;
}

/** Ordena em sentido horário a partir do canto superior esquerdo (menor x + y). */
function order(q: Pt[]): Quad {
  const cx = q.reduce((s, p) => s + p.x, 0) / 4;
  const cy = q.reduce((s, p) => s + p.y, 0) / 4;
  const byAngle = [...q].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let start = 0;
  for (let i = 1; i < 4; i++) if (byAngle[i].x + byAngle[i].y < byAngle[start].x + byAngle[start].y) start = i;
  return [0, 1, 2, 3].map((i) => byAngle[(start + i) % 4]) as Quad;
}

/**
 * Fundo = pixels do lado "mesa" do limiar que se ligam à borda da foto; documento = o resto.
 * Assim faixas escuras, foto 3×4 e texto dentro do documento continuam sendo documento
 * (procurar só a parte clara deixava de fora, por exemplo, o cabeçalho verde de um cartão).
 */
function documentMask(v: Float32Array, w: number, h: number, isBackground: (x: number) => boolean): Uint8Array {
  const bg = new Uint8Array(w * h);
  const stack: number[] = [];
  const seed = (i: number) => {
    if (!bg[i] && isBackground(v[i])) {
      bg[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) seed(x), seed((h - 1) * w + x);
  for (let y = 0; y < h; y++) seed(y * w), seed(y * w + w - 1);
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (i >= w) seed(i - w);
    if (i < w * (h - 1)) seed(i + w);
  }
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = bg[i] ? 0 : 1;
  return mask;
}

/** Bordas encostadas: 1,5% da foto. */
const EDGE = 0.015;

export function findDocument(g: Gray): Detection | null {
  const { w, h, v } = g;
  if (w < 16 || h < 16) return null;
  const t = otsu(g);
  // Documento claro na mesa escura é o caso comum; documento escuro em mesa clara é a 2ª tentativa.
  for (const bright of [true, false]) {
    const mask = documentMask(v, w, h, (x) => (bright ? x <= t : x > t));
    const comp = largest(erode(close(mask, w, h, Math.round(Math.min(w, h) * 0.05)), w, h), w, h);
    if (!comp || comp.size < w * h * 0.03) continue;
    // A erosão encolheu a região 1 px de cada lado: devolve esse pixel aos cantos.
    const raw = order(maxQuad(hull(comp.points)));
    const cx = raw.reduce((a, q) => a + q.x, 0) / 4;
    const cy = raw.reduce((a, q) => a + q.y, 0) / 4;
    const quad = raw.map((q) => ({ x: q.x + Math.sign(q.x - cx), y: q.y + Math.sign(q.y - cy) })) as Quad;
    const area = quadArea(quad);
    // Precisa ser um quadrilátero cheio: a região (com buracos preenchidos) cobre o quadrilátero.
    const fill = comp.span / Math.max(1, area);
    if (fill < 0.88 || area < w * h * 0.03) continue;
    const frac = quad.map((p) => ({ x: p.x / w, y: p.y / h })) as Quad;
    const touches: Detection['touches'] = [];
    if (frac.some((p) => p.y < EDGE)) touches.push('top');
    if (frac.some((p) => p.x > 1 - EDGE)) touches.push('right');
    if (frac.some((p) => p.y > 1 - EDGE)) touches.push('bottom');
    if (frac.some((p) => p.x < EDGE)) touches.push('left');
    // No lado escuro, a "região" que encosta em 3 ou 4 bordas é a mesa em volta de um documento claro.
    if (!bright && touches.length >= 3) continue;
    return { quad: frac, area: area / (w * h), touches };
  }
  return null;
}
