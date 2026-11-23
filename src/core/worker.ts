/// <reference lib="webworker" />
/**
 * Análise fora da linha principal: a câmera e a interface continuam fluidas enquanto
 * cada quadro é medido. A imagem chega por transferência (sem cópia) e nunca sai do aparelho.
 * Com `withDocument`, devolve também o documento recortado e endireitado (foto final).
 */
import { analyzeDocument, type CheckOptions } from './check';
import type { Img } from './image';

export interface WorkerRequest {
  id: number;
  img: Img;
  options?: CheckOptions;
  withDocument?: boolean;
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, img, options, withDocument } = e.data;
  const { result, document } = analyzeDocument(img, options);
  if (withDocument) self.postMessage({ id, result, document }, [document.data.buffer]);
  else self.postMessage({ id, result });
};
