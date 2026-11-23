import { describe, expect, it } from 'vitest';
import { checkDocument, type CheckId, type Status } from './check';
import type { Quad } from './geometry';
import { applyPolicy } from './policy';
import { addGlare, blur, exposureShift, page, place, resize, rotate90, specimen, specimenQuad } from './synthetic';

const base = specimen();
const status = (img: ReturnType<typeof specimen>, id: CheckId): Status => checkDocument(img).checks.find((c) => c.id === id)!.status;
const ALL_OK = ['framing:ok', 'resolution:ok', 'sharpness:ok', 'exposure:ok', 'glare:ok', 'orientation:ok'];

describe('documento bom', () => {
  it('passa em tudo', () => {
    const r = checkDocument(base);
    expect(r.checks.map((c) => `${c.id}:${c.status}`)).toEqual(ALL_OK);
    expect(r.ready).toBe(true);
  });

  it('vale para outro documento sintético (outro tamanho e outro texto)', () => {
    expect(checkDocument(specimen(1000, 640, 9)).ready).toBe(true);
  });
});

describe('enquadramento', () => {
  const from = specimenQuad();
  it('documento inclinado é encontrado, endireitado e medido como um de frente', () => {
    const to: Quad = [
      { x: 0.12, y: 0.14 },
      { x: 0.86, y: 0.2 },
      { x: 0.83, y: 0.84 },
      { x: 0.1, y: 0.76 },
    ];
    const r = checkDocument(place(base, from, to));
    expect(r.checks.map((c) => `${c.id}:${c.status}`)).toEqual(ALL_OK);
    expect(r.document.quad).not.toBeNull();
  });

  it('documento cortado na borda falha e diz qual borda', () => {
    const to: Quad = [
      { x: 0.3, y: 0.2 },
      { x: 1.1, y: 0.2 },
      { x: 1.1, y: 0.8 },
      { x: 0.3, y: 0.8 },
    ];
    const f = checkDocument(place(base, from, to)).checks[0];
    expect(f.status).toBe('fail');
    expect(f.message).toMatch(/borda da direita/);
    expect(f.hint).toBe('Afaste um pouco');
  });

  it('documento pequeno na foto pede para aproximar', () => {
    const to: Quad = [
      { x: 0.4, y: 0.4 },
      { x: 0.75, y: 0.4 },
      { x: 0.75, y: 0.68 },
      { x: 0.4, y: 0.68 },
    ];
    expect(checkDocument(place(base, from, to)).checks[0].hint).toBe('Aproxime');
  });
});

describe('nitidez', () => {
  it('desfoque leve passa e médio pede atenção', () => {
    expect(status(blur(base, 1), 'sharpness')).toBe('ok');
    expect(status(blur(base, 4), 'sharpness')).toBe('warn');
  });

  it('o mesmo borrão pesa mais em letra pequena', () => {
    // Raio 1: o cartão (letra grande) passa; a página (letra pequena) reprova.
    expect(status(blur(base, 1), 'sharpness')).toBe('ok');
    expect(status(blur(page(), 1), 'sharpness')).toBe('fail');
    expect(checkDocument(blur(page(), 1)).ready).toBe(false);
  });

  it('foto escura e nítida não é confundida com borrada', () => {
    expect(status(exposureShift(base, 0.5), 'sharpness')).toBe('ok');
  });
});

describe('iluminação', () => {
  it('escura falha; um pouco escura pede atenção', () => {
    expect(status(exposureShift(base, 0.3), 'exposure')).toBe('fail');
    expect(status(exposureShift(base, 0.6), 'exposure')).toBe('warn');
  });
});

describe('reflexo', () => {
  it('mancha grande falha e é localizada no documento', () => {
    const r = checkDocument(addGlare(base, 0.75, 0.25, 0.12));
    const g = r.checks.find((c) => c.id === 'glare')!;
    expect(g.status).toBe('fail');
    expect(g.message).toMatch(/superior direita/);
    expect(g.region!.x + g.region!.w / 2).toBeGreaterThan(0.6);
  });

  it('mancha pequena pede atenção; papel branco bem iluminado não é reflexo', () => {
    expect(status(addGlare(base, 0.5, 0.5, 0.04), 'glare')).toBe('warn');
    expect(status(exposureShift(base, 1.05), 'glare')).toBe('ok');
  });
});

describe('página de arquivo digital (fundo branco puro)', () => {
  // Regressão: a 1ª versão acusava "reflexo cobrindo 64%" e "muito clara" numa página branca.
  it('fundo 255 não é reflexo nem foto clara demais', () => {
    const r = checkDocument(page());
    expect(r.checks.map((c) => `${c.id}:${c.status}`)).toEqual(ALL_OK);
    expect(r.checks.find((c) => c.id === 'glare')!.message).toMatch(/fundo branco/i);
  });

  it('página escura falha', () => {
    expect(status(exposureShift(page(), 0.35), 'exposure')).toBe('fail');
  });
});

describe('orientação e resolução', () => {
  it('documento deitado falha', () => {
    expect(status(rotate90(base), 'orientation')).toBe('fail');
  });

  it('letras pequenas na foto (documento longe) falham', () => {
    expect(status(resize(base, 0.4), 'resolution')).toBe('fail');
  });
});

describe('política de envio', () => {
  const blurred = checkDocument(blur(page(), 1));

  it('padrão: tudo orienta, nada bloqueia', () => {
    const v = applyPolicy(blurred);
    expect(v.canSubmit).toBe(true);
    expect(v.problems.map((c) => c.id)).toContain('sharpness');
    expect(v.blocking).toEqual([]);
  });

  it('com nitidez em "block", a falha impede o envio', () => {
    const v = applyPolicy(blurred, { sharpness: 'block' });
    expect(v.canSubmit).toBe(false);
    expect(v.blocking.map((c) => c.id)).toEqual(['sharpness']);
  });

  it('"atenção" nunca bloqueia, mesmo em "block"', () => {
    const warned = checkDocument(exposureShift(base, 0.6));
    expect(applyPolicy(warned, { exposure: 'block' }).canSubmit).toBe(true);
  });

  it('"off" esconde a verificação', () => {
    const v = applyPolicy(blurred, { sharpness: 'off', orientation: 'off' });
    expect(v.visible.map((c) => c.id)).not.toContain('sharpness');
    expect(v.canSubmit).toBe(true);
  });
});
