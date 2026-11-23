import { THRESHOLDS as T } from '../core/check';

const num = (n: number) => n.toLocaleString('pt-BR');

/** Documentação da demo: o que cada verificação mede, onde está o código e o que ainda não cobre. */
export default function HowItWorks() {
  return (
    <section className="demo-doc" aria-label="Documentação">
      <details open>
        <summary>
          <h2>Como funciona</h2>
          <span>achar o documento, endireitar, medir e orientar, sem modelo e sem servidor</span>
        </summary>
        <ol>
          <li>
            <strong>A imagem fica no aparelho.</strong> A foto ou o quadro da câmera é enviado a um <em>Web Worker</em>, um
            processo separado do navegador. A análise roda nele, em algumas dezenas de milissegundos, sem travar a tela. Na
            câmera, isso acontece cerca de 3 vezes por segundo, e quadros que chegam com a análise anterior em curso são
            descartados. Nada é enviado pela rede.
          </li>
          <li>
            <strong>Achar o documento.</strong> Numa cópia pequena da foto (320 px):
            <ul>
              <li>
                <em>Otsu</em> escolhe o limiar de brilho que melhor separa o papel da mesa;
              </li>
              <li>a maior região clara é a candidata;</li>
              <li>do contorno convexo dela sai o quadrilátero de maior área, que dá os quatro cantos.</li>
            </ul>
            A candidata só vale se preencher o quadrilátero; senão, a análise segue sobre a foto inteira e pede um fundo que
            contraste.
          </li>
          <li>
            <strong>Endireitar.</strong> Uma <em>homografia</em> (mapa projetivo entre dois planos, calculado pelos quatro
            cantos) leva o documento fotografado de lado para um retângulo. Todas as medições seguintes são sobre esse
            retângulo, sem a mesa, e é ele que é enviado. O enquadramento avisa quando o documento está cortado numa borda,
            pequeno na foto (menos de {num(T.framing.smallWarn * 100)}%) ou inclinado demais.
          </li>
          <li>
            <strong>Resolução pela altura da letra.</strong> O que decide se dá para ler é o tamanho da letra na foto
            original, não o tamanho da imagem. Abaixo de {T.resolution.letterFail} px a foto é reprovada; abaixo de{' '}
            {T.resolution.letterWarn} px aparece um aviso.
          </li>
          <li>
            <strong>Nitidez em relação ao tamanho da letra.</strong> Um borrão de 2 px apaga a letra pequena de uma página
            A4 e não atrapalha a letra grande de um cartão. Por isso são duas medidas:
            <ul>
              <li>
                <em>Nitidez das bordas</em>: a energia do Laplaciano (segunda derivada) dividida pela do gradiente (primeira
                derivada), nas bordas mais fortes. Ela cai com o quadrado do borrão e não depende de brilho nem de contraste.
              </li>
              <li>
                <em>Altura da letra</em>: cada pixel mais escuro que a vizinhança vira tinta; os pixels de tinta vizinhos
                são agrupados, e a mediana da altura dos grupos com forma de letra ou palavra é a altura da letra.
              </li>
            </ul>
            <code>índice = nitidez das bordas × altura da letra²</code>: falha abaixo de {T.sharpness.fail}, aviso abaixo
            de {T.sharpness.warn}.
          </li>
          <li>
            <strong>Iluminação pelo papel, não pela média.</strong> O nível do papel é o brilho que só 10% dos pixels
            superam (percentil 90). Abaixo de {T.exposure.darkFail} a foto é reprovada; abaixo de {T.exposure.darkWarn}{' '}
            aparece um aviso. Se a tinta ficar a menos de {T.exposure.contrastWarn} níveis do papel, o texto está apagado.
          </li>
          <li>
            <strong>Reflexo.</strong> Blocos de 8×8 px quase todos no branco máximo formam manchas; a maior é o reflexo,
            marcado sobre a imagem e descrito em palavras ("na parte superior direita"). Só vale quando o papel fica abaixo
            do branco máximo, como em qualquer foto de câmera.
          </li>
          <li>
            <strong>Orientação.</strong> Linhas de texto formam faixas: a quantidade de tinta por linha da imagem oscila
            muito mais que por coluna. Se acontece o contrário, o documento está deitado.
          </li>
          <li>
            <strong>Orientação ao vivo e captura automática.</strong> Na câmera:
            <ul>
              <li>o contorno do documento aparece sobre a imagem, na cor do pior estado;</li>
              <li>
                uma frase curta diz o que fazer agora, sempre o problema mais urgente primeiro: enquadrar, depois firmar,
                depois a luz ("Afaste um pouco", "Segure firme", "Incline para tirar o reflexo");
              </li>
              <li>quando tudo fica bom e parado por cerca de 1 segundo, a foto é tirada sozinha.</li>
            </ul>
          </li>
          <li>
            <strong>Aviso ou bloqueio é escolha de quem integra.</strong> Cada verificação tem uma regra:
            <ul>
              <li><code>warn</code> (padrão): orienta e deixa enviar;</li>
              <li><code>block</code>: uma falha impede o envio;</li>
              <li><code>off</code>: a verificação não aparece.</li>
            </ul>
            "Atenção" nunca bloqueia. A recomendação é deixar tudo como aviso e repetir a verificação no servidor: no
            navegador ela orienta a pessoa, mas não garante nada, porque quem controla o aparelho pode contorná-la. O núcleo
            é TypeScript puro, então o mesmo código roda no servidor.
          </li>
        </ol>
      </details>

      <details>
        <summary>
          <h2>Implementação</h2>
          <span>onde está cada parte do código</span>
        </summary>
        <ul className="demo-files">
          <li><code>src/core/detect.ts</code><span>Achar o documento: Otsu, maior região, contorno convexo, quadrilátero de maior área.</span></li>
          <li><code>src/core/geometry.ts</code><span>Homografia (sistema 8×8), retificação com interpolação bilinear, inclinação.</span></li>
          <li><code>src/core/metrics.ts</code><span>Medições: nitidez das bordas, altura da letra, papel e tinta, reflexo, eixo do texto.</span></li>
          <li><code>src/core/check.ts</code><span>Limites (THRESHOLDS), gravidade de cada item, mensagem e instrução curta.</span></li>
          <li><code>src/core/policy.ts</code><span>Regra de cada verificação (aviso, bloqueio, desligado) e o veredito de envio.</span></li>
          <li><code>src/core/worker.ts</code><span>Web Worker que roda a análise fora da tela.</span></li>
          <li><code>src/core/synthetic.ts</code><span>Documentos sintéticos, perspectiva e degradações controladas para os testes.</span></li>
          <li><code>src/core/*.test.ts</code><span>Testes de detecção, de cada verificação, da política e a regressão da página branca.</span></li>
          <li><code>src/react/DocumentCheck.tsx</code><span>Componente: câmera com orientação ao vivo, captura automática, arquivo e envio.</span></li>
          <li><code>docs/calibracao.md</code><span>Todas as medições usadas para escolher os limites, com o antes e depois.</span></li>
        </ul>
      </details>

      <details>
        <summary>
          <h2>Limitações</h2>
          <span>o que esta versão ainda não resolve</span>
        </summary>
        <ul>
          <li>
            Achar o documento depende de contraste com o fundo. Documento branco em mesa branca não é encontrado, e a
            análise segue sobre a foto inteira.
          </li>
          <li>
            Os limites foram calibrados com documentos sintéticos e <strong>uma</strong> página real. Ainda faltam fotos de
            celular, com ruído, compressão JPEG e foco parcial.
          </li>
          <li>
            Não lê o texto. Confirmar que um campo está legível, ou que o documento não está de cabeça para baixo (180°),
            exige OCR, previsto para a fase 3.
          </li>
          <li>Num arquivo digital ou digitalizado, com fundo branco puro, um reflexo não se distingue do papel pelo brilho.</li>
          <li>Não verifica se o documento é autêntico; só se a foto está boa para ser lida.</li>
        </ul>
      </details>
    </section>
  );
}
