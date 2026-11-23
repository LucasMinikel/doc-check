import { describe, expect, it } from 'vitest';
import { findDocument } from './detect';
import { type Quad } from './geometry';
import { createImg, toGray } from './image';
import { page, place, specimen, specimenQuad } from './synthetic';

const card = specimen();
const from = specimenQuad();
const err = (a: Quad, b: Quad) => Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y)));
const detect = (img: ReturnType<typeof specimen>) => findDocument(toGray(img, 320));

describe('detecção do documento', () => {
  it('acha os quatro cantos do cartão de frente', () => {
    const d = detect(card)!;
    const truth = from.map((p) => ({ x: p.x / card.width, y: p.y / card.height })) as Quad;
    expect(err(d.quad, truth)).toBeLessThan(0.01);
    expect(d.touches).toEqual([]);
  });

  it('acha os cantos com perspectiva e rotação', () => {
    const to: Quad = [
      { x: 0.2, y: 0.15 },
      { x: 0.82, y: 0.22 },
      { x: 0.78, y: 0.8 },
      { x: 0.15, y: 0.7 },
    ];
    const d = detect(place(card, from, to))!;
    expect(err(d.quad, to)).toBeLessThan(0.012);
  });

  it('documento passando da borda é marcado como cortado', () => {
    const to: Quad = [
      { x: 0.35, y: 0.2 },
      { x: 1.15, y: 0.2 },
      { x: 1.15, y: 0.8 },
      { x: 0.35, y: 0.8 },
    ];
    expect(detect(place(card, from, to))!.touches).toContain('right');
  });

  it('faixa escura de ponta a ponta (cabeçalho) fica dentro do documento', () => {
    // Como no cartão da demo: tira de papel em cima, faixa encostando na mesa pelas laterais.
    const banded = { ...card, data: new Uint8ClampedArray(card.data) };
    const [tl, tr] = from;
    for (let y = tl.y + 12; y < tl.y + 72; y++) {
      for (let x = tl.x; x < tr.x; x++) {
        const i = (y * card.width + x) * 4;
        banded.data[i] = 30;
        banded.data[i + 1] = 70;
        banded.data[i + 2] = 50;
      }
    }
    const d = detect(banded)!;
    expect(Math.abs(d.quad[0].y - tl.y / card.height)).toBeLessThan(0.015);
  });

  it('sem documento (mesa lisa) não inventa cantos', () => {
    expect(detect(createImg(800, 600, 90))).toBeNull();
  });

  it('página digital que ocupa a imagem toda vira o próprio documento', () => {
    const d = detect(page())!;
    expect(d.area).toBeGreaterThan(0.9);
  });
});
