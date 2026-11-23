/**
 * Documento sintético e degradações controladas (borrar, escurecer, reflexo, girar).
 * Servem para calibrar e testar as verificações sem usar documento real de ninguém (LGPD).
 * A demo usa as mesmas degradações sobre um documento-modelo desenhado em canvas.
 */
import { createImg, type Img } from './image';
import { homography, project, type Quad } from './geometry';
import { rng } from './random';

/**
 * Cartão de identidade fictício: fundo de mesa, cartão cor de papel, foto 3×4,
 * linhas de "palavras" (barras escuras de larguras variadas) e ruído leve de câmera.
 */
export function specimen(width = 1200, height = 760, seed = 1): Img {
  const r = rng(seed);
  const img = createImg(width, height, 70); // mesa
  const set = (x: number, y: number, v: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
  };
  const rect = (x0: number, y0: number, w: number, h: number, v: number) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, v);
  };
  const m = Math.round(width * 0.06);
  rect(m, m, width - 2 * m, height - 2 * m, 228); // cartão
  rect(m + 40, m + 60, Math.round(width * 0.2), Math.round(height * 0.42), 120); // foto 3×4
  const textX = m + 80 + Math.round(width * 0.2);
  for (let line = 0; line < 9; line++) {
    let x = textX;
    const y = m + 60 + line * 46;
    const end = width - m - 40;
    while (x < end) {
      const word = 20 + Math.floor(r() * 90);
      rect(x, y, Math.min(word, end - x), 14, 35);
      x += word + 14;
    }
  }
  // Ruído de sensor: sem ele, o Laplaciano de uma imagem perfeita seria irreal.
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * 6;
    img.data[i] = img.data[i] + n;
    img.data[i + 1] = img.data[i + 1] + n;
    img.data[i + 2] = img.data[i + 2] + n;
  }
  return img;
}

/** Desfoque de caixa separável, aplicado `passes` vezes (aproxima uma gaussiana). */
export function blur(src: Img, radius: number, passes = 2): Img {
  let img: Img = { ...src, data: new Uint8ClampedArray(src.data) };
  for (let p = 0; p < passes; p++) {
    img = boxPass(boxPass(img, radius, true), radius, false);
  }
  return img;
}

function boxPass(src: Img, r: number, horizontal: boolean): Img {
  const { width: w, height: h } = src;
  const out = new Uint8ClampedArray(src.data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 4; c++) {
        let s = 0;
        let n = 0;
        for (let k = -r; k <= r; k++) {
          const xx = horizontal ? x + k : x;
          const yy = horizontal ? y : y + k;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          s += src.data[(yy * w + xx) * 4 + c];
          n++;
        }
        out[(y * w + x) * 4 + c] = s / n;
      }
    }
  }
  return { width: w, height: h, data: out };
}

/** Multiplica o brilho (0,3 = foto escura; 1,6 = estourada). */
export function exposureShift(src: Img, factor: number): Img {
  const data = new Uint8ClampedArray(src.data.length);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = src.data[i] * factor;
    data[i + 1] = src.data[i + 1] * factor;
    data[i + 2] = src.data[i + 2] * factor;
    data[i + 3] = 255;
  }
  return { width: src.width, height: src.height, data };
}

/** Reflexo de luz: mancha circular estourada, com borda suave, centrada em (cx, cy) em frações. */
export function addGlare(src: Img, cx: number, cy: number, radius: number): Img {
  const data = new Uint8ClampedArray(src.data);
  const R = radius * Math.min(src.width, src.height);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const d = Math.hypot(x - cx * src.width, y - cy * src.height);
      if (d > R * 1.3) continue;
      const k = d < R ? 1 : 1 - (d - R) / (R * 0.3);
      const i = (y * src.width + x) * 4;
      for (let c = 0; c < 3; c++) data[i + c] = data[i + c] + (255 - data[i + c]) * k;
    }
  }
  return { width: src.width, height: src.height, data };
}

/** Gira 90° no sentido horário. */
export function rotate90(src: Img): Img {
  const { width: w, height: h } = src;
  const data = new Uint8ClampedArray(src.data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const from = (y * w + x) * 4;
      const to = (x * h + (h - 1 - y)) * 4;
      for (let c = 0; c < 4; c++) data[to + c] = src.data[from + c];
    }
  }
  return { width: h, height: w, data };
}

/**
 * Página A4 de arquivo digital (como um PDF exportado ou print): fundo branco puro (255),
 * letra pequena (barras de 8 px, linhas a cada 20 px), sem ruído de câmera. Reproduz o caso
 * que fazia a versão anterior acusar "reflexo" no fundo e não perceber o borrão.
 */
export function page(width = 1080, height = 1520, seed = 3): Img {
  const r = rng(seed);
  const img = createImg(width, height, 255);
  const m = Math.round(width * 0.06);
  for (let y = m; y + 8 < height - m; y += 20) {
    if (r() < 0.12) continue; // parágrafos
    let x = m;
    const end = width - m - Math.floor(r() * width * 0.3);
    while (x < end) {
      const word = 12 + Math.floor(r() * 50);
      for (let yy = y; yy < y + 8; yy++) {
        for (let xx = x; xx < Math.min(x + word, end); xx++) {
          const i = (yy * width + xx) * 4;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = 20;
        }
      }
      x += word + 7;
    }
  }
  return img;
}

/** Retângulo do cartão dentro de `specimen(width, height)`, em pixels. */
export function specimenQuad(width = 1200, height = 760): Quad {
  const m = Math.round(width * 0.06);
  return [
    { x: m, y: m },
    { x: width - m, y: m },
    { x: width - m, y: height - m },
    { x: m, y: height - m },
  ];
}

/**
 * Fotografa o documento de outro ângulo: o retângulo `from` (pixels de `src`) vai para os
 * cantos `to` (frações da nova foto), sobre uma mesa de tom `desk` com ruído leve.
 * Partes fora da foto ficam cortadas, como numa foto mal enquadrada.
 */
export function place(src: Img, from: Quad, to: Quad, width = 1280, height = 960, desk = 70, seed = 5): Img {
  const r = rng(seed);
  const target = to.map((p) => ({ x: p.x * width, y: p.y * height })) as Quad;
  const h = homography(target, from);
  const [tl, , br] = from;
  const img = createImg(width, height, desk);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = project(h, { x, y });
      const o = (y * width + x) * 4;
      if (p.x >= tl.x && p.y >= tl.y && p.x < br.x - 1 && p.y < br.y - 1) {
        const i = (Math.floor(p.y) * src.width + Math.floor(p.x)) * 4;
        img.data[o] = src.data[i];
        img.data[o + 1] = src.data[i + 1];
        img.data[o + 2] = src.data[i + 2];
      } else {
        const n = desk + (r() - 0.5) * 6;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = n;
      }
    }
  }
  return img;
}

/** Reduz por média de blocos (simula o documento fotografado de mais longe). */
export function resize(src: Img, k: number): Img {
  const w = Math.max(1, Math.round(src.width * k));
  const h = Math.max(1, Math.round(src.height * k));
  const sum = new Float64Array(w * h * 3);
  const n = new Uint32Array(w * h);
  for (let y = 0; y < src.height; y++) {
    const ty = Math.min(h - 1, Math.floor(y * k));
    for (let x = 0; x < src.width; x++) {
      const t = ty * w + Math.min(w - 1, Math.floor(x * k));
      const i = (y * src.width + x) * 4;
      sum[t * 3] += src.data[i];
      sum[t * 3 + 1] += src.data[i + 1];
      sum[t * 3 + 2] += src.data[i + 2];
      n[t]++;
    }
  }
  const data = new Uint8ClampedArray(w * h * 4);
  for (let t = 0; t < w * h; t++) {
    for (let c = 0; c < 3; c++) data[t * 4 + c] = sum[t * 3 + c] / n[t];
    data[t * 4 + 3] = 255;
  }
  return { width: w, height: h, data };
}
