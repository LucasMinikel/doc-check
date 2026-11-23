/**
 * Medições da foto. Cada função recebe a imagem em cinza e devolve números, sem decidir nada:
 * a decisão (ok / atenção / falha) fica em check.ts, com os limites explícitos.
 */
import type { Gray } from './image';

const mean = (xs: ArrayLike<number>) => {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return xs.length ? s / xs.length : 0;
};
const variance = (xs: ArrayLike<number>) => {
  const m = mean(xs);
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += (xs[i] - m) ** 2;
  return xs.length ? s / xs.length : 0;
};

/**
 * Nitidez das bordas: energia do Laplaciano ÷ energia do gradiente, só nos 3% de pixels
 * com borda mais forte. Para uma borda desfocada por σ, a razão cai com 1/σ² e não depende
 * de contraste, brilho nem de quanto texto há na foto. (Dividir pela variância da imagem
 * inteira dependia do conteúdo: uma página branca com tabelas parecia nítida mesmo borrada.)
 */
export function edgeSharpness(g: Gray, top = 0.03): number {
  const { w, h, v } = g;
  if (w < 3 || h < 3) return 0;
  const n = (w - 2) * (h - 2);
  const grad = new Float32Array(n);
  const lap = new Float32Array(n);
  let k = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = (v[i + 1] - v[i - 1]) / 2;
      const gy = (v[i + w] - v[i - w]) / 2;
      grad[k] = gx * gx + gy * gy;
      lap[k++] = v[i - w] + v[i + w] + v[i - 1] + v[i + 1] - 4 * v[i];
    }
  }
  // Limiar do gradiente pelo percentil, sem ordenar tudo: histograma em escala log.
  const bin = (g2: number) => Math.min(255, Math.floor(Math.log2(1 + g2) * 12));
  const bins = new Uint32Array(256);
  for (let i = 0; i < n; i++) bins[bin(grad[i])]++;
  let acc = 0;
  let cut = 255;
  while (cut > 0 && acc + bins[cut] <= n * top) acc += bins[cut--];
  // Bordas fracas (gradiente < 8 níveis) são ruído ou papel liso, não texto.
  const min = Math.max(cut, bin(64));
  let L = 0;
  let G = 0;
  for (let i = 0; i < n; i++) {
    if (bin(grad[i]) < min) continue;
    L += lap[i] * lap[i];
    G += grad[i];
  }
  return G > 0 ? L / G : 0;
}

/**
 * Altura típica da letra, em px na escala de `g` (0 se não há texto). É a escala que decide
 * a legibilidade: o mesmo borrão apaga letra de 2 mm e não atrapalha letra de 5 mm.
 *
 * Pré-processamento clássico de OCR: binarização local (pixel mais escuro que a vizinhança
 * de ±15 px), componentes conectados, e a mediana da altura dos que têm forma de letra ou
 * palavra. Mesa, foto 3×4 e faixas viram componentes grandes demais e ficam de fora.
 */
export function textHeight(g: Gray): number {
  const { w, h, v } = g;
  const R = 15;
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += v[y * w + x];
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + row;
    }
  }
  const ink = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - R);
    const y1 = Math.min(h, y + R + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - R);
      const x1 = Math.min(w, x + R + 1);
      const sum = integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
      const local = sum / ((x1 - x0) * (y1 - y0));
      if (v[y * w + x] < local - 12) ink[y * w + x] = 1;
    }
  }
  const heights: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < ink.length; start++) {
    if (ink[start] !== 1) continue;
    ink[start] = 2;
    stack.push(start);
    let x0 = w;
    let x1 = 0;
    let y0 = h;
    let y1 = 0;
    let area = 0;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w;
      const y = (i - x) / w;
      area++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && ink[i - 1] === 1) (ink[i - 1] = 2), stack.push(i - 1);
      if (x < w - 1 && ink[i + 1] === 1) (ink[i + 1] = 2), stack.push(i + 1);
      if (y > 0 && ink[i - w] === 1) (ink[i - w] = 2), stack.push(i - w);
      if (y < h - 1 && ink[i + w] === 1) (ink[i + w] = 2), stack.push(i + w);
    }
    const bh = y1 - y0 + 1;
    const bw = x1 - x0 + 1;
    // Letra ou palavra: altura plausível, não muito mais alta que larga, com tinta suficiente.
    if (bh >= 3 && bh <= h / 8 && bh <= bw * 3 && area >= 6 && area >= bw * bh * 0.15) heights.push(bh);
  }
  if (heights.length < 8) return 0;
  heights.sort((p, q) => p - q);
  return heights[Math.floor(heights.length / 2)];
}

export interface Exposure {
  /** Brilho médio, 0–255. */
  mean: number;
  /**
   * Nível do papel: percentil 90 do brilho. O documento é a parte clara da foto; a média
   * misturava mesa, papel e tinta e fazia uma página branca parecer "clara demais".
   */
  paper: number;
  /** Nível da tinta: percentil 2. */
  ink: number;
}

function percentile(g: Gray, p: number): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < g.v.length; i++) hist[Math.max(0, Math.min(255, Math.round(g.v[i])))]++;
  const target = p * g.v.length;
  let acc = 0;
  for (let b = 0; b < 256; b++) if ((acc += hist[b]) >= target) return b;
  return 255;
}

export function exposure(g: Gray): Exposure {
  return { mean: mean(g.v), paper: percentile(g, 0.9), ink: percentile(g, 0.02) };
}

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Glare {
  /**
   * Falso quando o próprio papel já está no branco máximo (arquivo digital, digitalização):
   * aí um reflexo não se distingue do fundo pelo brilho.
   */
  applicable: boolean;
  /** Fração da imagem coberta pela maior mancha de reflexo. */
  area: number;
  /** Onde está a maior mancha, em frações da imagem (0–1), para a interface desenhar. */
  region: Region | null;
}

/** Com o papel acima disto, a foto já está no branco máximo: reflexo não é mensurável pelo brilho. */
export const GLARE_PAPER_MAX = 245;

/**
 * Reflexo: blocos de 8×8 px quase todos estourados (≥ 250) formam manchas; a maior
 * mancha conectada é o reflexo. Só vale quando o papel fica abaixo do branco máximo, como
 * em toda foto de câmera (papel bem iluminado fica perto de 230). Em arquivo digital ou
 * digitalização o fundo já é 255, e o brilho sozinho não separa reflexo de papel.
 */
export function glare(g: Gray, paper = percentile(g, 0.9), block = 8): Glare {
  const bw = Math.floor(g.w / block);
  const bh = Math.floor(g.h / block);
  if (paper >= GLARE_PAPER_MAX) return { applicable: false, area: 0, region: null };
  if (bw === 0 || bh === 0) return { applicable: true, area: 0, region: null };
  const hot = new Uint8Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let n = 0;
      for (let y = by * block; y < (by + 1) * block; y++) {
        for (let x = bx * block; x < (bx + 1) * block; x++) if (g.v[y * g.w + x] >= 250) n++;
      }
      hot[by * bw + bx] = n > block * block * 0.6 ? 1 : 0;
    }
  }
  // Maior componente conectado (4-vizinhança) de blocos estourados.
  const seen = new Uint8Array(hot.length);
  let best = { size: 0, x0: 0, y0: 0, x1: 0, y1: 0 };
  for (let start = 0; start < hot.length; start++) {
    if (!hot[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    const c = { size: 0, x0: bw, y0: bh, x1: 0, y1: 0 };
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % bw;
      const y = (i - x) / bw;
      c.size++;
      c.x0 = Math.min(c.x0, x);
      c.y0 = Math.min(c.y0, y);
      c.x1 = Math.max(c.x1, x);
      c.y1 = Math.max(c.y1, y);
      for (const j of [x > 0 ? i - 1 : -1, x < bw - 1 ? i + 1 : -1, y > 0 ? i - bw : -1, y < bh - 1 ? i + bw : -1]) {
        if (j >= 0 && hot[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    if (c.size > best.size) best = c;
  }
  if (best.size === 0) return { applicable: true, area: 0, region: null };
  return {
    applicable: true,
    area: best.size / (bw * bh),
    region: { x: best.x0 / bw, y: best.y0 / bh, w: (best.x1 - best.x0 + 1) / bw, h: (best.y1 - best.y0 + 1) / bh },
  };
}

export interface TextAxis {
  /** Energia da alternância rápida (linha de texto × entrelinha) no perfil das linhas e no das colunas. */
  rows: number;
  cols: number;
  /** horizontal: texto de pé ou de cabeça para baixo; vertical: deitado (girado 90°). */
  axis: 'horizontal' | 'vertical' | 'indefinido';
}

/** Razão rows ÷ cols a partir da qual o eixo é decidido. */
export const AXIS_RATIO = 1.15;

/**
 * Energia da parte rápida de um perfil: o perfil menos a sua média móvel de ±W px, ao
 * quadrado, normalizada pela média. Blocos grandes (foto 3×4, faixas, mesa) variam devagar
 * e somem; o que fica é a alternância linha de texto / entrelinha.
 */
function fastEnergy(p: Float64Array, W = 8): number {
  const n = p.length;
  const sums = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) sums[i + 1] = sums[i] + p[i];
  const mu = sums[n] / n;
  let e = 0;
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - W);
    const hi = Math.min(n, i + W + 1);
    e += (p[i] - (sums[hi] - sums[lo]) / (hi - lo)) ** 2;
  }
  return mu > 0 ? e / n / (mu * mu) : 0;
}

/**
 * Orientação pelo texto: linhas de texto deixam faixas escuras e claras alternadas, então o
 * perfil de tinta por linha da imagem oscila rápido; o perfil por coluna, bem menos. Só a
 * oscilação rápida conta: sem isso, a foto 3×4 de um cartão (um bloco escuro largo) dominava
 * o perfil das colunas e o cartão em pé parecia deitado.
 * Não distingue 0° de 180°: para isso é preciso ler o texto (OCR).
 */
export function textAxis(g: Gray): TextAxis {
  // Escuro relativo à própria foto (média − 1 desvio): funciona também em foto escura.
  const t = mean(g.v) - Math.sqrt(variance(g.v));
  const rowsP = new Float64Array(g.h);
  const colsP = new Float64Array(g.w);
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (g.v[y * g.w + x] < t) {
        rowsP[y]++;
        colsP[x]++;
      }
    }
  }
  const rows = fastEnergy(rowsP);
  const cols = fastEnergy(colsP);
  const axis = rows > cols * AXIS_RATIO ? 'horizontal' : cols > rows * AXIS_RATIO ? 'vertical' : 'indefinido';
  return { rows, cols, axis };
}
