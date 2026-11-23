import type { Quad } from '../core/geometry';
import type { Img } from '../core/image';

/**
 * Documento-modelo para a demo, desenhado em canvas: nenhum dado é de pessoa real.
 * Diferente de `specimen()` (barras no lugar de letras, para teste), este tem texto de
 * verdade, para a pessoa ver como o borrão e o reflexo afetam a leitura.
 */
export function drawCard(width = 1400, height = 900): Img {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Mesa: tom escuro com leve gradiente, como uma foto real tirada de cima.
  const desk = ctx.createLinearGradient(0, 0, width, height);
  desk.addColorStop(0, '#4a4540');
  desk.addColorStop(1, '#2f2b28');
  ctx.fillStyle = desk;
  ctx.fillRect(0, 0, width, height);

  const m = width * 0.07;
  const cw = width - 2 * m;
  const ch = cw / 1.586; // proporção ID-1
  const cy = (height - ch) / 2;
  ctx.save();
  ctx.shadowColor = 'rgb(0 0 0 / 0.45)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = '#e4e2d8';
  ctx.beginPath();
  ctx.roundRect(m, cy, cw, ch, 28);
  ctx.fill();
  ctx.restore();

  const u = cw / 100; // unidade relativa ao cartão
  const x0 = m + 4 * u;

  ctx.fillStyle = '#2d5a4a';
  ctx.fillRect(m, cy + 3 * u, cw, 7 * u);
  ctx.fillStyle = '#f4f2ea';
  ctx.font = `700 ${3.2 * u}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText('REPÚBLICA FICTÍCIA · DOCUMENTO DE EXEMPLO', x0, cy + 6.5 * u);

  // Foto 3×4: silhueta genérica.
  const px = x0;
  const py = cy + 14 * u;
  const pw = 22 * u;
  const ph = 29 * u;
  ctx.fillStyle = '#9aa3a8';
  ctx.fillRect(px, py, pw, ph);
  ctx.fillStyle = '#6d777d';
  ctx.beginPath();
  ctx.arc(px + pw / 2, py + ph * 0.38, pw * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(px + pw / 2, py + ph, pw * 0.42, ph * 0.32, 0, Math.PI, 0);
  ctx.fill();

  const fx = px + pw + 5 * u;
  const fields: [string, string][] = [
    ['NOME', 'MARIA EXEMPLO DA SILVA'],
    ['DATA DE NASCIMENTO', '01/01/1990'],
    ['REGISTRO', '000.000.000-00'],
    ['FILIAÇÃO', 'ANA EXEMPLO · JOÃO EXEMPLO'],
    ['NATURALIDADE', 'CIDADE MODELO / UF'],
  ];
  fields.forEach(([label, value], i) => {
    const y = cy + 16 * u + i * 6.4 * u;
    ctx.fillStyle = '#5b625f';
    ctx.font = `600 ${1.7 * u}px system-ui, sans-serif`;
    ctx.fillText(label, fx, y);
    ctx.fillStyle = '#16191a';
    ctx.font = `600 ${2.7 * u}px ui-monospace, monospace`;
    ctx.fillText(value, fx, y + 2.9 * u);
  });

  // Faixa legível por máquina (estilo MRZ), também fictícia.
  ctx.fillStyle = '#16191a';
  ctx.font = `500 ${2.5 * u}px ui-monospace, monospace`;
  ctx.fillText('IDXEX<<EXEMPLO<<MARIA<<<<<<<<<<<<<<<<<<<<<', x0, cy + ch - 9 * u);
  ctx.fillText('0000000000XEX9001011F3001019<<<<<<<<<<<<<<0', x0, cy + ch - 5 * u);

  // Marca d'água.
  ctx.save();
  ctx.translate(m + cw * 0.62, cy + ch * 0.55);
  ctx.rotate(-0.18);
  ctx.fillStyle = 'rgb(200 60 60 / 0.16)';
  ctx.font = `800 ${11 * u}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('FICTÍCIO', 0, 0);
  ctx.restore();

  // Ruído leve de sensor.
  const img = ctx.getImageData(0, 0, width, height);
  let s = 7;
  for (let i = 0; i < img.data.length; i += 4) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const n = ((s / 0x7fffffff) - 0.5) * 6;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  return { width, height, data: img.data };
}

/** Retângulo do cartão dentro de `drawCard(width, height)`, em pixels. */
export function cardRect(width = 1400, height = 900): Quad {
  const m = width * 0.07;
  const cw = width - 2 * m;
  const ch = cw / 1.586;
  const cy = (height - ch) / 2;
  return [
    { x: m, y: cy },
    { x: m + cw, y: cy },
    { x: m + cw, y: cy + ch },
    { x: m, y: cy + ch },
  ];
}
