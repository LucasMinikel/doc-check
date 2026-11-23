/**
 * Imagem RGBA mínima: compatível com ImageData do navegador e fácil de criar em teste.
 * Todo o núcleo trabalha sobre ela, sem DOM, para rodar igual no worker, na página e no Vitest.
 */
export interface Img {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Luminância em tons de cinza (0–255), já reduzida para o lado maior caber em `maxSide`. */
export interface Gray {
  w: number;
  h: number;
  v: Float32Array;
}

export function createImg(width: number, height: number, fill = 0): Img {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = fill;
    data[i + 3] = 255;
  }
  return { width, height, data };
}

/**
 * Converte para cinza e reduz por média de blocos. As métricas são calculadas numa
 * escala fixa: assim os limites não mudam com a resolução da câmera, e a análise
 * ao vivo cabe em poucos milissegundos.
 */
export function toGray(img: Img, maxSide = 640): Gray {
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const v = new Float32Array(w * h);
  const sum = new Float32Array(w * h);
  const count = new Uint32Array(w * h);
  for (let y = 0; y < img.height; y++) {
    const gy = Math.min(h - 1, Math.floor(y * scale));
    for (let x = 0; x < img.width; x++) {
      const gx = Math.min(w - 1, Math.floor(x * scale));
      const i = (y * img.width + x) * 4;
      // Rec. 601: o olho pesa mais o verde.
      sum[gy * w + gx] += 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
      count[gy * w + gx]++;
    }
  }
  for (let i = 0; i < v.length; i++) v[i] = count[i] ? sum[i] / count[i] : 0;
  return { w, h, v };
}
