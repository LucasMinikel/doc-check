import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { THRESHOLDS, type Check, type CheckId, type CheckResult } from '../core/check';
import { homography, project, type Pt, type Quad } from '../core/geometry';
import type { Img } from '../core/image';
import type { Region } from '../core/metrics';
import { applyPolicy, enforcementOf, type Policy, type Verdict } from '../core/policy';
import { useAnalyzer } from './useAnalyzer';
import './document-check.css';

export interface DocumentCheckProps {
  /**
   * Por verificação: `warn` (padrão) orienta e deixa enviar; `block` impede o envio enquanto
   * houver falha; `off` esconde. "Atenção" nunca bloqueia. Ex.: `{ sharpness: 'block' }`.
   */
  policy?: Policy;
  /** Cada análise concluída (ao vivo na câmera, uma vez por foto). */
  onResult?(result: CheckResult, verdict: Verdict): void;
  /**
   * Envio. Recebe a foto (recortada e endireitada quando o documento foi encontrado), o
   * resultado e o veredito. O servidor deve repetir a verificação: no navegador ela orienta,
   * não garante. Sem `onSubmit`, o botão de envio não aparece.
   */
  onSubmit?(photo: Blob, result: CheckResult, verdict: Verdict): void;
  /** Captura sozinho quando o documento fica bem enquadrado e parado por ~1 s. Padrão: sim. */
  autoCapture?: boolean;
  /** Envia o documento recortado e endireitado (padrão) em vez da foto inteira. */
  crop?: boolean;
  /** Imagem pronta para analisar no lugar de uma foto (a demo usa documentos sintéticos). */
  sample?: Img;
  /** Rótulo do botão de envio. */
  submitLabel?: string;
}

type Mode = 'idle' | 'camera' | 'photo';

/** Maior lado do quadro analisado ao vivo. O núcleo reduz para 640 px; 1280 dá folga. */
const FRAME_MAX = 1280;
/** Maior lado da foto final (a captura e os arquivos são analisados nessa resolução). */
const PHOTO_MAX = 2400;
/** Intervalo da análise ao vivo. Quadros que chegam com o worker ocupado são descartados. */
const LIVE_MS = 300;
/** Quadros bons e parados seguidos para a captura automática (~1 s). */
const STABLE_FRAMES = 3;
/** Quanto os cantos podem se mexer entre quadros e ainda contar como "parado" (fração da foto). */
const STILL = 0.02;

const LABELS: Record<CheckId, string> = {
  framing: 'Enquadramento',
  resolution: 'Resolução',
  sharpness: 'Nitidez',
  exposure: 'Iluminação',
  glare: 'Reflexo',
  orientation: 'Orientação',
};
const ORDER = Object.keys(LABELS) as CheckId[];
/** Ordem da instrução ao vivo: primeiro enquadrar, depois firmar, depois a luz. */
const HINT_PRIORITY: CheckId[] = ['framing', 'resolution', 'sharpness', 'glare', 'exposure', 'orientation'];
const UNIT: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

const num = (n: number, digits = 0) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Medido × meta, sempre visível: a pessoa vê por que a foto passou ou não. */
function measure(c: Check): string {
  const T = THRESHOLDS;
  switch (c.id) {
    case 'framing':
      return c.value ? `${num(c.value * 100)}% da foto · meta ≥ ${num(c.threshold * 100)}%` : 'bordas não encontradas';
    case 'resolution':
      return c.threshold === T.resolution.letterWarn
        ? `letra ≈ ${num(c.value)} px · meta ≥ ${num(c.threshold)}`
        : `${num(c.value)} px · meta ≥ ${num(c.threshold)}`;
    case 'sharpness':
      return `índice ${num(c.value)} · meta ≥ ${num(c.threshold)}`;
    case 'exposure':
      return `papel ${num(c.value)} de 255 · meta ≥ ${T.exposure.darkWarn}`;
    case 'glare':
      return `${num(c.value * 100, 1)}% do documento · meta < ${num(c.threshold * 100, 1)}%`;
    case 'orientation':
      return `linhas ÷ colunas ${num(c.value, 2)} · meta ≥ ${num(c.threshold, 2)}`;
  }
}

function statusText(c: Check, enforcement: string) {
  if (c.status === 'ok') return 'ok';
  if (c.status === 'warn') return 'atenção';
  return enforcement === 'block' ? 'bloqueia o envio' : 'recomendado corrigir';
}

/** Copia uma fonte (vídeo, canvas, bitmap) para um quadro de até `max` px, pronto para o worker. */
function grab(source: CanvasImageSource, width: number, height: number, max = FRAME_MAX): Img {
  const k = Math.min(1, max / Math.max(width, height));
  const w = Math.round(width * k);
  const h = Math.round(height * k);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  return { width: w, height: h, data };
}

function toCanvas(img: Img): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return canvas;
}

/** Leva uma região do documento medido para coordenadas da imagem exibida (polígono em frações). */
function regionPolygon(r: Region, measured: Quad | null, display: Quad | null): Pt[] {
  const corners: Pt[] = [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
  if (!measured) return corners;
  const toFrame = homography(UNIT, measured);
  const fromFrame = display ? homography(display, UNIT) : null;
  return corners.map((p) => {
    const f = project(toFrame, p);
    return fromFrame ? project(fromFrame, f) : f;
  });
}

const points = (ps: Pt[]) => ps.map((p) => `${p.x},${p.y}`).join(' ');
const moved = (a: Quad, b: Quad) => Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y)));

export default function DocumentCheck({
  policy,
  onResult,
  onSubmit,
  autoCapture = true,
  crop = true,
  sample,
  submitLabel = 'Enviar documento',
}: DocumentCheckProps) {
  const { analyze, busy } = useAnalyzer();
  const [mode, setMode] = useState<Mode>('idle');
  const [result, setResult] = useState<CheckResult | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  /** A foto exibida é o documento endireitado (true) ou a imagem inteira. */
  const [rectified, setRectified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [stable, setStable] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const originalRef = useRef<Blob | null>(null);
  const latest = useRef(0);
  const lastQuad = useRef<Quad | null>(null);
  const capturing = useRef(false);

  const verdict = useMemo(() => (result ? applyPolicy(result, policy) : null), [result, policy]);

  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const policyRef = useRef(policy);
  policyRef.current = policy;

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);
  useEffect(() => stopCamera, [stopCamera]);

  /**
   * Foto parada (arquivo, captura ou amostra): analisa em resolução cheia e mostra o
   * documento já recortado e endireitado, que é o que será enviado.
   */
  const showPhoto = useCallback(
    async (source: CanvasImageSource, width: number, height: number, original: Blob | null) => {
      stopCamera();
      const id = ++latest.current;
      setError(null);
      setMode('photo');
      setStable(0);
      originalRef.current = original;
      const { result: r, document: doc } = await analyze(grab(source, width, height, PHOTO_MAX), { source: { width, height } }, true);
      if (id !== latest.current) return;
      const useCrop = crop && !!r.document.quad && !!doc;
      const shown = useCrop ? doc! : null;
      setRectified(useCrop);
      setSize(shown ? { width: shown.width, height: shown.height } : { width, height });
      setResult(r);
      onResultRef.current?.(r, applyPolicy(r, policyRef.current));
      // O canvas existe a partir do render do modo "photo".
      requestAnimationFrame(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const src: CanvasImageSource = shown ? toCanvas(shown) : source;
        canvas.width = shown ? shown.width : width;
        canvas.height = shown ? shown.height : height;
        canvas.getContext('2d')!.drawImage(src, 0, 0, canvas.width, canvas.height);
      });
    },
    [analyze, crop, stopCamera],
  );

  // Amostra vinda de fora (demo): substitui a foto atual a cada mudança.
  useEffect(() => {
    if (!sample) return;
    void showPhoto(toCanvas(sample), sample.width, sample.height, null);
  }, [sample, showPhoto]);

  const openFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Envie uma imagem (JPG, PNG ou HEIC convertido). PDF ainda não é aceito.');
      return;
    }
    try {
      // imageOrientation: a foto aparece como foi tirada, respeitando o EXIF do celular.
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      await showPhoto(bitmap, bitmap.width, bitmap.height, file);
    } catch {
      setError('Não foi possível abrir essa imagem.');
    }
  };

  const startCamera = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Este navegador não oferece câmera aqui. Escolha uma foto do aparelho.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      stopCamera();
      streamRef.current = stream;
      latest.current++;
      lastQuad.current = null;
      capturing.current = false;
      setResult(null);
      setStable(0);
      setRectified(false);
      setMode('camera');
    } catch (e) {
      const denied = e instanceof DOMException && e.name === 'NotAllowedError';
      setError(denied ? 'Acesso à câmera negado. Libere nas permissões do navegador ou escolha uma foto.' : 'Nenhuma câmera disponível. Escolha uma foto do aparelho.');
    }
  };

  /** Congela o quadro atual em resolução cheia; a análise final é sobre ele. */
  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video?.videoWidth || capturing.current) return;
    capturing.current = true;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    canvas.toBlob((blob) => void showPhoto(canvas, canvas.width, canvas.height, blob), 'image/jpeg', 0.92);
  }, [showPhoto]);

  // Câmera: analisa um quadro a cada LIVE_MS e conta quadros bons e parados para a captura automática.
  useEffect(() => {
    if (mode !== 'camera') return;
    const video = videoRef.current;
    if (!video || !streamRef.current) return;
    video.srcObject = streamRef.current;
    void video.play().catch(() => {});
    const onMeta = () => setSize({ width: video.videoWidth, height: video.videoHeight });
    video.addEventListener('loadedmetadata', onMeta);
    let count = 0;
    const timer = setInterval(async () => {
      if (video.readyState < 2 || busy() || !video.videoWidth || capturing.current) return;
      const id = ++latest.current;
      const source = { width: video.videoWidth, height: video.videoHeight };
      const { result: r } = await analyze(grab(video, source.width, source.height), { source });
      if (id !== latest.current) return;
      setResult(r);
      onResultRef.current?.(r, applyPolicy(r, policyRef.current));
      const quad = r.document.quad;
      const framed = r.checks[0].status === 'ok' && !!quad;
      const still = !!quad && !!lastQuad.current && moved(quad, lastQuad.current) < STILL;
      lastQuad.current = quad;
      count = framed && r.ready && still ? count + 1 : 0;
      setStable(count);
      if (autoCapture && count >= STABLE_FRAMES) capture();
    }, LIVE_MS);
    return () => {
      clearInterval(timer);
      video.removeEventListener('loadedmetadata', onMeta);
    };
  }, [mode, busy, analyze, autoCapture, capture]);

  const submit = () => {
    if (!result || !verdict?.canSubmit || !onSubmit) return;
    const send = (blob: Blob | null) => blob && onSubmit(blob, result, verdict);
    if (!rectified && originalRef.current) send(originalRef.current);
    else canvasRef.current?.toBlob(send, 'image/jpeg', 0.92);
  };

  const reset = () => {
    stopCamera();
    latest.current++;
    originalRef.current = null;
    capturing.current = false;
    setMode('idle');
    setResult(null);
    setSize(null);
    setStable(0);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void openFile(e.dataTransfer.files[0]);
  };

  // Veredito em uma linha, conforme a política.
  const blocking = verdict?.blocking.length ?? 0;
  const problems = verdict?.problems.length ?? 0;
  const warnings = verdict?.warnings.length ?? 0;
  const headline = !verdict
    ? mode === 'idle'
      ? 'Aguardando uma foto'
      : 'Analisando…'
    : blocking
      ? `${plural(blocking, 'item impede', 'itens impedem')} o envio`
      : problems
        ? `${plural(problems, 'problema encontrado', 'problemas encontrados')} · ainda dá para enviar`
        : warnings
          ? `Pode enviar · ${plural(warnings, 'ponto de atenção', 'pontos de atenção')}`
          : 'Pronto para enviar';
  const tone = !verdict ? 'idle' : blocking || problems ? 'fail' : warnings ? 'warn' : 'ok';

  // Instrução ao vivo: o problema mais urgente que tem uma instrução curta.
  const live = mode === 'camera' && verdict;
  const top = live
    ? HINT_PRIORITY.map((id) => verdict.visible.find((c) => c.id === id && c.hint && c.status === 'fail')).find(Boolean) ??
      HINT_PRIORITY.map((id) => verdict.visible.find((c) => c.id === id && c.hint && c.status === 'warn')).find(Boolean)
    : undefined;
  const guide = !live
    ? null
    : top
      ? top.hint
      : autoCapture && result?.document.quad
        ? 'Perfeito, segure firme…'
        : result?.document.quad
          ? 'Tudo certo: pode capturar'
          : null;

  // Desenhos sobre a imagem: contorno do documento (câmera) e reflexo (câmera e foto).
  const quad = mode === 'camera' ? result?.document.quad : null;
  const glare = verdict?.visible.find((c) => c.id === 'glare' && c.status !== 'ok' && c.region);
  const glarePoly =
    glare?.region && result
      ? regionPolygon(glare.region, result.document.measured, mode === 'photo' && rectified ? result.document.quad : null)
      : null;
  const quadTone = !result ? 'idle' : result.checks.some((c) => c.status === 'fail') ? 'fail' : result.checks.some((c) => c.status === 'warn') ? 'warn' : 'ok';

  const byId = new Map(verdict?.visible.map((c) => [c.id, c]));
  const shown = ORDER.filter((id) => enforcementOf(id, policy) !== 'off');
  const hasIssues = blocking + problems + warnings > 0;

  return (
    <div className={`dc dc-${mode}`}>
      <div
        className={`dc-stage ${dragging ? 'drag' : ''}`}
        style={size ? { aspectRatio: `${size.width} / ${size.height}` } : undefined}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {mode === 'idle' && (
          <div className="dc-empty">
            <p>Fotografe o documento ou escolha uma foto.</p>
            <p className="dc-hint">Sobre uma mesa escura, com luz de frente e sem flash. A análise roda aqui, no seu aparelho.</p>
          </div>
        )}
        {mode === 'camera' && <video ref={videoRef} className="dc-media" playsInline muted aria-label="Imagem da câmera" />}
        {mode === 'photo' && (
          <canvas
            ref={canvasRef}
            className="dc-media"
            role="img"
            aria-label={rectified ? 'Documento recortado e endireitado' : 'Foto do documento em análise'}
          />
        )}

        {mode === 'camera' && !quad && <div className="dc-guide" aria-hidden="true" />}
        {(quad || glarePoly) && (
          <svg className="dc-overlay" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
            {quad && <polygon className={`dc-quad ${quadTone}`} points={points(quad)} vectorEffect="non-scaling-stroke" />}
            {glarePoly && <polygon className={`dc-glare ${glare!.status}`} points={points(glarePoly)} vectorEffect="non-scaling-stroke" />}
          </svg>
        )}
        {glarePoly && (
          <span
            className={`dc-tag ${glare!.status}`}
            style={{ left: `${Math.min(...glarePoly.map((p) => p.x)) * 100}%`, top: `${Math.max(...glarePoly.map((p) => p.y)) * 100}%` }}
            aria-hidden="true"
          >
            reflexo
          </span>
        )}
        {guide && (
          <div className={`dc-live ${top ? top.status : 'ok'}`} aria-hidden="true">
            <span>{guide}</span>
            {autoCapture && !top && (
              <span className="dc-progress">
                <span style={{ width: `${(Math.min(stable, STABLE_FRAMES) / STABLE_FRAMES) * 100}%` }} />
              </span>
            )}
          </div>
        )}
      </div>

      <div className="dc-panel">
        <p className={`dc-verdict ${tone}`} role="status" aria-live="polite">
          <span className="dc-dot" aria-hidden="true" />
          {headline}
        </p>

        <ol className="dc-checks" aria-label="Verificações da foto">
          {shown.map((id) => {
            const c = byId.get(id);
            const enforcement = enforcementOf(id, policy);
            return (
              <li key={id} className={c ? `${c.status} ${c.status === 'fail' && enforcement === 'block' ? 'blocking' : ''}` : 'pending'}>
                <span className="dc-dot" aria-hidden="true" />
                <div>
                  <p className="dc-check-head">
                    <strong>
                      {LABELS[id]}
                      {enforcement === 'block' && <span className="dc-rule"> · obrigatório</span>}
                    </strong>
                    <span className="dc-status">{c ? statusText(c, enforcement) : '—'}</span>
                  </p>
                  {c && <p className="dc-msg">{c.message}</p>}
                  {c && <p className="dc-measure">{measure(c)}</p>}
                </div>
              </li>
            );
          })}
        </ol>

        {error && (
          <p className="dc-error" role="alert">
            {error}
          </p>
        )}

        <div className="dc-actions">
          {mode !== 'camera' && (
            <button type="button" className="dc-btn" onClick={startCamera}>
              {mode === 'photo' ? 'Tirar outra' : 'Usar câmera'}
            </button>
          )}
          {mode === 'camera' && (
            <button type="button" className={`dc-btn ${result?.ready ? 'primary' : ''}`} onClick={capture}>
              Capturar
            </button>
          )}
          <button type="button" className="dc-btn" onClick={() => fileRef.current?.click()}>
            Escolher foto
          </button>
          {mode !== 'idle' && (
            <button type="button" className="dc-btn quiet" onClick={reset}>
              Recomeçar
            </button>
          )}
          {onSubmit && mode === 'photo' && (
            <button type="button" className="dc-btn primary" onClick={submit} disabled={!verdict?.canSubmit}>
              {verdict && !verdict.canSubmit ? 'Corrija para enviar' : hasIssues ? 'Enviar assim mesmo' : submitLabel}
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              void openFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>

        <p className="dc-foot">
          A imagem não sai do seu aparelho durante a verificação.
          {onSubmit && ' Depois do envio, ela é conferida de novo no servidor.'}
          {result && <> Análise em {num(result.ms)} ms.</>}
        </p>
      </div>
    </div>
  );
}
