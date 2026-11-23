/**
 * Geometria do enquadramento: quadriláteros, homografia (mapa projetivo entre dois planos)
 * e retificação, que "endireita" o documento fotografado de lado num retângulo.
 */
import type { Img } from './image';

export interface Pt {
  x: number;
  y: number;
}

/** Cantos do documento em sentido horário a partir do superior esquerdo. */
export type Quad = [tl: Pt, tr: Pt, br: Pt, bl: Pt];

/** Matriz 3×3 em ordem de linhas, com h[8] = 1. */
export type Homography = Float64Array;

/**
 * Homografia que leva `from[i]` em `to[i]` (4 pares): sistema linear 8×8 resolvido por
 * eliminação de Gauss com pivotamento parcial.
 */
export function homography(from: Quad, to: Quad): Homography {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    const d = A[c][c] || 1e-12;
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / d;
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  const h = new Float64Array(9);
  for (let i = 0; i < 8; i++) h[i] = A[i][8] / (A[i][i] || 1e-12);
  h[8] = 1;
  return h;
}

export function project(h: Homography, p: Pt): Pt {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Área pela fórmula do laço (shoelace), em unidades ao quadrado. */
export function quadArea(q: Quad): number {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/** Tamanho do documento endireitado: média dos lados opostos. */
export function quadSize(q: Quad): { width: number; height: number } {
  const [tl, tr, br, bl] = q;
  return { width: (dist(tl, tr) + dist(bl, br)) / 2, height: (dist(tl, bl) + dist(tr, br)) / 2 };
}

/** Quanto a foto está de lado: maior razão entre lados opostos (1 = de frente). */
export function skew(q: Quad): number {
  const [tl, tr, br, bl] = q;
  const r = (a: number, b: number) => Math.max(a, b) / Math.max(1e-9, Math.min(a, b));
  return Math.max(r(dist(tl, tr), dist(bl, br)), r(dist(tl, bl), dist(tr, br)));
}

/** Aproxima cada canto do centro por uma fração `f` (margem interna). */
export function insetQuad(q: Quad, f: number): Quad {
  const cx = q.reduce((s, p) => s + p.x, 0) / 4;
  const cy = q.reduce((s, p) => s + p.y, 0) / 4;
  return q.map((p) => ({ x: p.x + (cx - p.x) * f, y: p.y + (cy - p.y) * f })) as Quad;
}

export const scaleQuad = (q: Quad, sx: number, sy: number): Quad =>
  q.map((p) => ({ x: p.x * sx, y: p.y * sy })) as Quad;

/**
 * Recorta e endireita: para cada pixel do retângulo de saída, a homografia inversa diz
 * de onde ele vem na foto, e o valor é interpolado (bilinear). `quad` em pixels de `img`.
 * Sem ampliar: a saída tem no máximo o tamanho real do documento na foto.
 */
export function rectify(img: Img, quad: Quad, maxSide = 1600): Img {
  const size = quadSize(quad);
  const k = Math.min(1, maxSide / Math.max(size.width, size.height));
  const W = Math.max(1, Math.round(size.width * k));
  const H = Math.max(1, Math.round(size.height * k));
  const h = homography(
    [
      { x: 0, y: 0 },
      { x: W - 1, y: 0 },
      { x: W - 1, y: H - 1 },
      { x: 0, y: H - 1 },
    ],
    quad,
  );
  const out = new Uint8ClampedArray(W * H * 4);
  const { width: iw, height: ih, data } = img;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = project(h, { x, y });
      const x0 = Math.max(0, Math.min(iw - 2, Math.floor(p.x)));
      const y0 = Math.max(0, Math.min(ih - 2, Math.floor(p.y)));
      const fx = Math.max(0, Math.min(1, p.x - x0));
      const fy = Math.max(0, Math.min(1, p.y - y0));
      const o = (y * W + x) * 4;
      const i00 = (y0 * iw + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + iw * 4;
      const i11 = i01 + 4;
      for (let c = 0; c < 3; c++) {
        const top = data[i00 + c] * (1 - fx) + data[i10 + c] * fx;
        const bottom = data[i01 + c] * (1 - fx) + data[i11 + c] * fx;
        out[o + c] = top * (1 - fy) + bottom * fy;
      }
      out[o + 3] = 255;
    }
  }
  return { width: W, height: H, data: out };
}
