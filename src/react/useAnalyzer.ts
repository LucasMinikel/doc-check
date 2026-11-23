import { useCallback, useEffect, useRef } from 'react';
import { analyzeDocument, type CheckOptions, type CheckResult } from '../core/check';
import type { Img } from '../core/image';

export interface AnalyzerOutput {
  result: CheckResult;
  /** Documento recortado e endireitado; só vem quando pedido (foto final). */
  document?: Img;
}

/**
 * Análise fora da thread da interface: um Web Worker com o mesmo núcleo.
 * Sem suporte a worker de módulo, cai para a thread principal (mais lento, mesmo resultado).
 * Enquanto uma análise está em curso, `busy()` é verdadeiro: a câmera pula quadros em vez
 * de enfileirar, e o retorno sempre corresponde a um quadro recente.
 */
export function useAnalyzer() {
  const worker = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, (r: AnalyzerOutput) => void>());
  const seq = useRef(0);

  useEffect(() => {
    let w: Worker | null = null;
    try {
      w = new Worker(new URL('../core/worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<{ id: number } & AnalyzerOutput>) => {
        const done = pending.current.get(e.data.id);
        pending.current.delete(e.data.id);
        done?.({ result: e.data.result, document: e.data.document });
      };
      w.onerror = () => {
        worker.current = null;
      };
    } catch {
      w = null;
    }
    worker.current = w;
    return () => {
      w?.terminate();
      worker.current = null;
      pending.current.clear();
    };
  }, []);

  const analyze = useCallback(
    (img: Img, options?: CheckOptions, withDocument = false) =>
      new Promise<AnalyzerOutput>((resolve) => {
        const w = worker.current;
        if (!w) {
          const a = analyzeDocument(img, options);
          return resolve({ result: a.result, document: withDocument ? a.document : undefined });
        }
        const id = ++seq.current;
        pending.current.set(id, resolve);
        // O buffer é transferido, não copiado: quem chama não usa mais esse quadro.
        w.postMessage({ id, img, options, withDocument }, [img.data.buffer]);
      }),
    [],
  );

  const busy = useCallback(() => pending.current.size > 0, []);

  return { analyze, busy };
}
