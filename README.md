# doc-check

Confere a foto de um documento **no navegador, antes do envio**, e diz à pessoa o que corrigir:

| Verificação | O que pega |
| --- | --- |
| Enquadramento | documento não encontrado, cortado na borda, pequeno na foto ou muito inclinado |
| Resolução | letras pequenas demais na foto (documento longe) |
| Nitidez | foto borrada para o tamanho da letra (tremida ou fora de foco) |
| Iluminação | foto escura, ou texto apagado por luz forte |
| Reflexo | brilho de luz cobrindo parte do documento, com a região marcada na imagem |
| Orientação | documento deitado (90°) |

O documento é encontrado na foto, recortado e endireitado (homografia); as medições são sobre ele, e é ele que
é enviado. Na câmera, o contorno aparece ao vivo, uma frase curta diz o que fazer ("Afaste um pouco", "Segure
firme") e a foto é tirada sozinha quando tudo fica bom e parado por ~1 s.

Cada item mostra o valor medido e a meta. A análise roda num Web Worker em ~10 ms por quadro, ao vivo na câmera
ou numa foto escolhida. A imagem não sai do aparelho.

## Rodar

```sh
npm install
npm run dev     # demo em http://127.0.0.1:5173
npm test        # testes do núcleo (Vitest)
npm run build   # checagem de tipos + build da demo
```

A demo traz um documento **fictício** desenhado em canvas e controles para degradá-lo (foco, luz, reflexo, posição,
tamanho). Também dá para usar a câmera ou uma foto.

## Usar em outro projeto

```tsx
import { DocumentCheck } from 'doc-check/react';

// Padrão recomendado: tudo orienta, nada bloqueia; o servidor repete a verificação.
<DocumentCheck onSubmit={(foto, resultado, veredito) => enviar(foto, resultado)} />;

// Bloqueando o envio de foto borrada e escondendo a orientação:
<DocumentCheck policy={{ sharpness: 'block', orientation: 'off' }} onSubmit={enviar} />;
```

Regra por verificação: `warn` (padrão) orienta e deixa enviar; `block` impede o envio enquanto houver **falha**;
`off` esconde. "Atenção" nunca bloqueia. Outras props: `autoCapture` (padrão `true`), `crop` (envia o documento
endireitado, padrão `true`), `onResult`.

No servidor (Node), o mesmo núcleo: `checkDocument(imagemRGBA)` + `applyPolicy(resultado, policy)`, de
`doc-check/core`. A verificação no navegador orienta a pessoa; quem garante é o servidor.

## Estrutura

- `src/core/`: detecção do documento, homografia, métricas puras sobre RGBA (sem DOM), decisões e limites, política, worker, gerador sintético.
- `src/react/`: componente `DocumentCheck` e o hook `useAnalyzer`.
- `src/demo/`: página de demonstração.
- `docs/calibracao.md`: medições e limites. `docs/integracao-nexus.md`: plano de integração no NEXUS.

## Fases

1. **MVP:** heurísticas clássicas, sem modelo. ✔
2. **Enquadramento:** detecção do documento, perspectiva, orientação ao vivo, captura automática, política de aviso/bloqueio. ✔
3. OCR para confirmar legibilidade real e 180°: Tesseract.js no navegador, ou um serviço na nuvem
   (OpenTofu, `min-instances = 0`) se o aparelho não der conta.
