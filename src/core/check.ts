/**
 * Decisão: transforma as medições em ok / atenção / falha, com uma explicação e uma instrução
 * curta para orientar a pessoa ao vivo. Aqui só se mede a gravidade; se uma falha bloqueia
 * o envio ou só avisa é escolha de quem usa o componente (policy.ts).
 *
 * Todos os limites estão em THRESHOLDS; as medições usadas para escolhê-los estão em
 * docs/calibracao.md.
 */
import { findDocument, type Detection } from './detect';
import { insetQuad, quadSize, rectify, scaleQuad, skew, type Quad } from './geometry';
import { toGray, type Img } from './image';
import { AXIS_RATIO, edgeSharpness, exposure, glare, textAxis, textHeight, type Region } from './metrics';

export type CheckId = 'framing' | 'resolution' | 'sharpness' | 'exposure' | 'glare' | 'orientation';
export type Status = 'ok' | 'warn' | 'fail';

export interface Check {
  id: CheckId;
  label: string;
  status: Status;
  /** Valor medido e limite usado: a interface mostra os dois, sem caixa-preta. */
  value: number;
  threshold: number;
  /** Explicação completa, para a lista. */
  message: string;
  /** Instrução curta e imperativa, para sobrepor à câmera ("Aproxime", "Segure firme"). */
  hint?: string;
  /** Onde está o problema, em frações do documento endireitado (0–1). */
  region?: Region;
}

export interface DocumentInfo {
  /** Cantos do documento em frações da imagem analisada; null se não foi encontrado. */
  quad: Quad | null;
  /**
   * Área efetivamente medida (o documento com margem interna), em frações da imagem.
   * As regiões das verificações (ex.: o reflexo) são frações deste quadrilátero.
   */
  measured: Quad | null;
  /** Fração da foto ocupada pelo documento. */
  area: number;
  /** Razão entre lados opostos (1 = fotografado de frente). */
  skew: number;
}

export interface CheckResult {
  /** Nenhuma verificação em falha. Não decide o envio: isso é da política (policy.ts). */
  ready: boolean;
  checks: Check[];
  document: DocumentInfo;
  /** Tempo de análise, em ms. */
  ms: number;
}

export const THRESHOLDS = {
  /** Fração da foto ocupada pelo documento e inclinação (lado maior ÷ lado oposto). */
  framing: { smallWarn: 0.2, skewWarn: 1.35, fillsFrame: 0.9 },
  /**
   * Altura típica da letra na foto original, em px. Abaixo de ~10 px o OCR começa a errar;
   * abaixo de 7 px até uma pessoa tem dificuldade. Sem texto encontrado, vale o menor lado
   * do documento (fail 480 / warn 720 px).
   */
  resolution: { letterFail: 7, letterWarn: 10, sideFail: 480, sideWarn: 720 },
  /**
   * Índice de legibilidade = nitidez das bordas × (altura da letra)², na escala de 640 px:
   * o borrão medido em relação ao tamanho do texto. Página A4 real (1080 × 1518, letra ≈ 6 px):
   * original 100, borrão de 1 px 50 e de 1,5 px 34 (legíveis), 2 px 9 (no limite), 3 px 4 (ilegível).
   */
  sharpness: { fail: 8, warn: 20 },
  /** Altura de letra usada quando não há texto para medir (px na escala de 640). */
  defaultLetter: 8,
  /** Nível do papel (percentil 90 do brilho, 0–255) e contraste papel − tinta. */
  exposure: { darkFail: 100, darkWarn: 150, contrastWarn: 80 },
  /** Fração do documento coberta pela maior mancha de reflexo. */
  glare: { fail: 0.015, warn: 0.003 },
  /** Razão entre a oscilação rápida das linhas e a das colunas para decidir o eixo do texto. */
  orientation: AXIS_RATIO,
} as const;

const T = THRESHOLDS;
const pct = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')}%`;
const where = (r: Region) => {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const v = cy < 0.33 ? 'superior' : cy > 0.66 ? 'inferior' : 'central';
  const h = cx < 0.33 ? 'esquerda' : cx > 0.66 ? 'direita' : '';
  return v === 'central' && !h ? 'no centro' : `na parte ${v}${h ? ` ${h}` : ''}`;
};
const SIDE = { top: 'de cima', right: 'da direita', bottom: 'de baixo', left: 'da esquerda' } as const;
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`);

export interface CheckOptions {
  /**
   * Tamanho original da foto, quando a análise recebe uma cópia reduzida (ex.: quadros
   * da câmera reduzidos antes de ir ao worker). A resolução é julgada pelo original.
   */
  source?: { width: number; height: number };
}

export interface Analysis {
  result: CheckResult;
  /** O documento recortado e endireitado (ou a imagem inteira, se não foi encontrado). */
  document: Img;
}

function framing(det: Detection | null, sk: number): Check {
  const base = { id: 'framing' as const, label: 'Enquadramento', value: det?.area ?? 0, threshold: T.framing.smallWarn };
  if (!det) {
    return {
      ...base,
      status: 'warn',
      message: 'Não encontrei as bordas do documento. Use um fundo liso que contraste com ele, como uma mesa escura, e mostre o documento inteiro.',
      hint: 'Use um fundo escuro e liso',
    };
  }
  const cut = det.touches.length > 0 && det.area < T.framing.fillsFrame;
  if (cut) {
    return {
      ...base,
      status: 'fail',
      message: `Documento cortado na borda ${list(det.touches.map((t) => SIDE[t]))}: afaste o celular ou centralize o documento.`,
      hint: 'Afaste um pouco',
    };
  }
  if (det.area < T.framing.smallWarn) {
    return { ...base, status: 'warn', message: `O documento ocupa só ${pct(det.area)} da foto: aproxime para as letras ficarem maiores.`, hint: 'Aproxime' };
  }
  if (sk > T.framing.skewWarn) {
    return {
      ...base,
      status: 'warn',
      message: 'Foto muito inclinada. A imagem foi endireitada, mas o lado mais distante perde nitidez: fique de frente para o documento.',
      hint: 'Fique de frente',
    };
  }
  return {
    ...base,
    status: 'ok',
    message: det.area >= T.framing.fillsFrame ? 'O documento ocupa a imagem inteira.' : `Documento encontrado e endireitado (${pct(det.area)} da foto).`,
  };
}

/** Margem interna da área medida (fração do documento). */
const INSET = 0.04;

/** Analisa e devolve também o documento endireitado (o worker usa para a foto final). */
export function analyzeDocument(img: Img, options: CheckOptions = {}): Analysis {
  const t0 = performance.now();
  const source = options.source ?? img;
  const scale = source.width / img.width;

  // 1. Onde está o documento (em escala pequena: só a forma importa).
  const det = findDocument(toGray(img, 320));
  const quadPx = det ? scaleQuad(det.quad, img.width, img.height) : null;
  const sk = quadPx ? skew(quadPx) : 1;
  // 2. Todas as medições seguintes são sobre o documento endireitado, sem a mesa. A medição
  //    usa uma margem interna de 4%: se o canto errar por 1 px, uma lasca fina da mesa na borda
  //    pareceria uma linha nítida. A foto final (document) mantém o recorte inteiro.
  const doc = quadPx ? rectify(img, quadPx) : img;
  const g = toGray(quadPx ? rectify(img, insetQuad(quadPx, INSET)) : img);
  const checks: Check[] = [framing(det, sk)];

  // 3. Resolução: a altura da letra na foto original decide se dá para ler.
  const letter = textHeight(g);
  const docSize = quadPx ? quadSize(quadPx) : { width: img.width, height: img.height };
  const toSource = (Math.max(docSize.width, docSize.height) / Math.max(g.w, g.h)) * scale;
  if (letter) {
    const px = Math.round(letter * toSource);
    checks.push({
      id: 'resolution',
      label: 'Resolução',
      value: px,
      threshold: T.resolution.letterWarn,
      ...(px < T.resolution.letterFail
        ? { status: 'fail' as const, message: `Letras com cerca de ${px} px de altura na foto: pequenas demais para ler. Aproxime o documento.`, hint: 'Aproxime' }
        : px < T.resolution.letterWarn
          ? { status: 'warn' as const, message: `Letras com cerca de ${px} px de altura: legíveis, mas no limite. Se der, aproxime um pouco.`, hint: 'Aproxime um pouco' }
          : { status: 'ok' as const, message: `Letras com cerca de ${px} px de altura na foto.` }),
    });
  } else {
    const side = Math.round(Math.min(docSize.width, docSize.height) * scale);
    checks.push({
      id: 'resolution',
      label: 'Resolução',
      value: side,
      threshold: T.resolution.sideWarn,
      ...(side < T.resolution.sideFail
        ? { status: 'fail' as const, message: `Documento com ${side} px no lado menor: pequeno demais. Aproxime.`, hint: 'Aproxime' }
        : side < T.resolution.sideWarn
          ? { status: 'warn' as const, message: `Documento com ${side} px no lado menor: no limite.`, hint: 'Aproxime um pouco' }
          : { status: 'ok' as const, message: `Documento com ${side} px no lado menor.` }),
    });
  }

  // 4. Nitidez em relação ao tamanho da letra.
  const legibility = edgeSharpness(g) * (letter || T.defaultLetter) ** 2;
  checks.push({
    id: 'sharpness',
    label: 'Nitidez',
    value: legibility,
    threshold: T.sharpness.warn,
    ...(legibility < T.sharpness.fail
      ? { status: 'fail' as const, message: 'Foto borrada para o tamanho da letra: apoie o celular, espere focar e não mexa ao fotografar.', hint: 'Segure firme' }
      : legibility < T.sharpness.warn
        ? { status: 'warn' as const, message: 'Nitidez no limite: o texto pequeno pode ficar ilegível. Segure firme ou aproxime um pouco.', hint: 'Segure firme' }
        : { status: 'ok' as const, message: letter ? 'Letras com bordas definidas para o tamanho delas.' : 'Bordas bem definidas (não encontrei letras para comparar o tamanho).' }),
  });

  // 5. Iluminação pelo papel.
  const e = exposure(g);
  const contrast = e.paper - e.ink;
  checks.push({
    id: 'exposure',
    label: 'Iluminação',
    value: e.paper,
    threshold: T.exposure.darkWarn,
    ...(e.paper < T.exposure.darkFail
      ? { status: 'fail' as const, message: 'Foto escura demais: vá para um lugar mais claro ou acenda a luz.', hint: 'Mais luz' }
      : e.paper < T.exposure.darkWarn
        ? { status: 'warn' as const, message: 'Um pouco escura: mais luz ajuda a leitura.', hint: 'Mais luz' }
        : contrast < T.exposure.contrastWarn
          ? { status: 'warn' as const, message: 'Texto apagado, com pouco contraste: evite luz direta forte sobre o documento.', hint: 'Menos luz direta' }
          : { status: 'ok' as const, message: 'Luz adequada.' }),
  });

  // 6. Reflexo.
  const gl = glare(g, e.paper);
  checks.push({
    id: 'glare',
    label: 'Reflexo',
    value: gl.area,
    threshold: T.glare.warn,
    region: gl.region ?? undefined,
    ...(!gl.applicable
      ? { status: 'ok' as const, message: 'Fundo branco puro (arquivo digital ou digitalização): sem reflexo de luz para medir.' }
      : gl.area >= T.glare.fail && gl.region
        ? { status: 'fail' as const, message: `Reflexo ${where(gl.region)} cobrindo ${pct(gl.area)} do documento. Incline um pouco o documento ou mude de posição.`, hint: 'Incline para tirar o reflexo' }
        : gl.area >= T.glare.warn && gl.region
          ? { status: 'warn' as const, message: `Pequeno reflexo ${where(gl.region)}: confira se não cobre nenhum dado.`, hint: 'Incline para tirar o reflexo' }
          : { status: 'ok' as const, message: 'Sem reflexo.' }),
  });

  // 7. Orientação do texto.
  const ax = textAxis(g);
  checks.push({
    id: 'orientation',
    label: 'Orientação',
    value: ax.cols > 0 ? ax.rows / ax.cols : 0,
    threshold: T.orientation,
    ...(ax.axis === 'vertical'
      ? { status: 'fail' as const, message: 'Documento deitado: gire 90° para o texto ficar na horizontal.', hint: 'Gire o documento' }
      : ax.axis === 'indefinido'
        ? { status: 'warn' as const, message: 'Não deu para confirmar a direção do texto. Enquadre só o documento.' }
        : { status: 'ok' as const, message: 'Texto na horizontal.' }),
  });

  return {
    result: {
      ready: checks.every((c) => c.status !== 'fail'),
      checks,
      document: { quad: det?.quad ?? null, measured: det ? insetQuad(det.quad, INSET) : null, area: det?.area ?? 0, skew: sk },
      ms: performance.now() - t0,
    },
    document: doc,
  };
}

export function checkDocument(img: Img, options: CheckOptions = {}): CheckResult {
  return analyzeDocument(img, options).result;
}
