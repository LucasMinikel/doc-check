# Calibração

Todos os limites ficam em `THRESHOLDS` (`src/core/check.ts`). Foram ajustados **só com imagens sintéticas**
(`specimen()` nos testes e o cartão fictício da demo). Não há documento real de ninguém no repositório (LGPD).

## Métricas

| Verificação | Métrica | Escala |
| --- | --- | --- |
| Resolução | menor lado da imagem **original** | px |
| Nitidez | índice de legibilidade = nitidez das bordas × (altura da letra)² | adimensional |
| Iluminação | nível do papel (percentil 90 do brilho) e contraste papel − tinta (percentil 2) | 0–255 |
| Reflexo | maior mancha de blocos 8×8 estourados (≥ 250), só se o papel estiver abaixo de 245 | fração da imagem |
| Orientação | CV² do perfil de pixels escuros por linha ÷ por coluna | razão; ≥ 1,3 = texto horizontal |

- **Nitidez das bordas:** energia do Laplaciano ÷ energia do gradiente nos 3% de pixels de borda mais forte
  (cai com 1/σ² do desfoque, não depende de contraste nem de quanto texto há).
- **Altura da letra:** binarização local (±15 px) + componentes conectados; mediana da altura dos que têm
  forma de letra/palavra. A legibilidade depende do borrão *em relação* à letra.

## Teste com imagem real (v2)

A v1 foi calibrada só com sintéticos e errou numa página real (print de um PDF, 1080 × 1518, fundo branco puro,
letra pequena), enviada pelo usuário em 17/11/2026. A imagem não está no repositório.

| Variação | v1 | v2 | Esperado (olho) |
| --- | --- | --- | --- |
| original | **reflexo 64%** (falha) + "muito clara" | pronto | pronto |
| borrão 1 px | — | índice 50, ok | legível |
| borrão 1,5 px | — | índice 34, ok | legível |
| borrão 2 px | — | índice 11, atenção | no limite |
| borrão 3 px | **nitidez ok** | índice 5, falha | ilegível |
| brilho × 0,35 | "um pouco escura" | papel 89, falha | escura demais |
| girada 90° | falha | falha | deitado |
| reflexo pintado em branco | falha (pelo motivo errado) | **não detecta** | ver abaixo |

Por que a v1 errou:
- **Reflexo e brilho por limite fixo:** o fundo 255 de um arquivo digital é "estourado" por definição.
  Agora o reflexo só é medido quando o papel está abaixo de 245 (toda foto de câmera); senão a verificação
  diz que não se aplica. O brilho passou a ser o nível do papel, não a média.
- **Nitidez sem escala da letra:** a v1 dividia pela variância da imagem inteira e não sabia o tamanho do
  texto; numa página com tabelas a variância é alta e o borrão passava despercebido.

## Medições (v2)

| Imagem | Letra (px) | Índice por borrão |
| --- | --- | --- |
| página real | 5–6 | 0 → 100 · 1 px → 50 · 1,5 → 34 · 2 → 9 · 3 → 4 |
| cartão da demo (canvas) | 10–12 | 0 → 284 · 2 px → 33 · 3 → 14 · 6 → 7 · 8 → 5 |
| `specimen()` | 8–10 | 0 → 197 · box 1 → 29 · 2 → 12 · 4 → 7 |
| `page()` | 4 | 0 → 46 · box 1 → 6 |

Câmera falsa do Chrome (padrão verde, sem texto): ~10–20 ms por quadro; orientação "indefinido" (correto).

## Limites atuais

```ts
resolution: { fail: 480, warn: 720 }
sharpness:  { fail: 8, warn: 20 }          // índice de legibilidade
exposure:   { darkFail: 100, darkWarn: 150, contrastWarn: 80 }   // nível do papel
glare:      { fail: 0.015, warn: 0.003 }   // só com papel < 245
orientation: razão ≥ 1,3
```

## Fase 2: enquadramento (19/11/2026)

| Mudança | Por quê | Verificado em |
| --- | --- | --- |
| Medir sobre o documento endireitado, com margem interna de 4% | sem a mesa, as medições dependem só do documento; a margem evita que uma lasca de mesa (canto errado em 1 px) pareça uma linha nítida | specimen borrado: índice 260 → 12 com a margem |
| Resolução = altura da letra na foto original (fail < 7 px, warn < 10 px) | o que decide a leitura é a letra, não o tamanho da imagem | cartão "longe" (9% da foto): letra ≈ 8 px, atenção |
| Orientação pela oscilação rápida dos perfis (média móvel ±8 px), razão ≥ 1,15 | a foto 3×4 do cartão recortado dominava o perfil das colunas e o cartão em pé saía "deitado" | cartão em pé 1,32 / deitado 0,63; página real 72 / 0,01 |
| Documento = tudo que não é fundo ligado à borda, com fechamento morfológico | procurar só a parte clara deixava de fora o cabeçalho escuro do cartão | teste de regressão com faixa escura; câmera falsa: recorte 952 × 478 com cabeçalho |

Câmera falsa (vídeo MJPEG do cartão fictício, 1280 × 720): "Afaste um pouco" com o cartão cortado, contorno
vermelho; ao entrar no quadro, "Perfeito, segure firme…", barra de progresso e captura automática em ~1 s.

## O que falta

- **Mais fotos reais.** Uma página real já corrigiu a v1; falta foto de *câmera* (papel não branco puro, ruído,
  JPEG, foco parcial, perspectiva). A margem entre "legível" (1,5 px → 34) e "no limite" (2 px → 11) é curta.
  Proposta: um conjunto de fotos do *próprio* documento fictício impresso, em vários celulares, rotuladas
  "legível / ilegível" por uma pessoa, e os limites escolhidos para ≥ 90% de acerto. As fotos ficam fora
  do repositório se tiverem qualquer dado pessoal.
- **Reflexo em arquivo digital/digitalização:** com fundo 255, um "reflexo" não se distingue do papel pelo
  brilho. Detectar texto apagado exigiria comparar com o layout esperado do documento (fase 2/3).
- **Superexposição de foto:** papel estourado em foto de câmera cai no mesmo caso acima; o contraste
  papel − tinta (< 80) é o único aviso.
- **180°** (de cabeça para baixo): o perfil de linhas/colunas é igual a 0°. Exige OCR (fase 3).
- **Detecção sem contraste:** documento branco em mesa branca não é encontrado (segue sobre a foto inteira).
  Faixa escura que vai até a borda do cartão, sem papel acima, fica fora do recorte. Ambos pedem detecção por
  bordas (gradiente + linhas), não só por brilho.
- **Letra mediana:** com borrão forte no cartão, o nome (letra grande) ainda se lê e os rótulos pequenos não;
  como a altura usada é a mediana, o resultado é "atenção", não "falha".
