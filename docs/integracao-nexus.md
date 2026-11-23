# Integração no NEXUS

Nada disto está feito ainda. É o plano para quando for decidido levar o componente para o site.

## Como entra

1. **Dependência git**, sem publicar no npm:
   `npm i github:LucasMinikel/doc-check#v0.1.0` (o repositório precisa existir no GitHub antes; hoje é só local).
   Para testar sem publicar: `npm i ../doc-check` (link local).
2. O pacote exporta TypeScript direto (`doc-check/core`, `doc-check/react`). O Vite do Astro compila;
   o worker (`new URL('../core/worker.ts', import.meta.url)`) é empacotado sozinho, como na demo.
3. Página `src/pages/projetos/documentos.astro`:

   ```astro
   ---
   import Base from '../../layouts/Base.astro';
   import PageHead from '../../components/hud/PageHead.astro';
   import DocCheckDemo from '../../components/doc-check/DocCheckDemo';
   ---
   <Base title="Foto de documento" description="Validação da foto antes do envio, no navegador.">
     <PageHead index="02" section="Projetos / 02" title="A foto, conferida antes do envio." />
     <DocCheckDemo client:only="react" />
   </Base>
   ```

   `client:only`: câmera, canvas e worker não existem no build estático.
4. Entrada em `projects` (`src/data/experiments.ts`) com `runtimes: ['browser']`; o grafo da home e o
   console ganham o nó sozinhos (`getSiteItems()`), com palavras-chave como `documento`, `foto`, `câmera`.
5. Visual: o CSS do componente já lê os tokens do NEXUS (`--signal`, `--ok`, `--bad`, `--line`, `--font-mono`…)
   e só usa valores próprios quando roda fora do site.

## Aviso ou bloqueio

Recomendação inicial: tudo como aviso (`policy` vazio). A pessoa é orientada e sempre consegue enviar; o servidor
repete `checkDocument` + `applyPolicy` na foto recebida e decide. Bloquear no navegador só melhora a experiência
quando a regra é certa (ex.: `sharpness: 'block'` depois de calibrar com fotos reais) e nunca substitui a
verificação no servidor, porque quem controla o aparelho pode contorná-la.

Na página do NEXUS, a demo mostra o seletor de política e o código equivalente, para quem quiser integrar.

## Teste no Lab

Uma hipótese medida, no padrão dos testes existentes:

> "A nitidez separa foto legível de ilegível em ≥ 90% dos casos."

O teste gera N cartões sintéticos com borrão aleatório, rotula "legível" pela verdade do gerador e mede
acerto, falsos positivos e a curva por limite. O veredito sai calculado no navegador, como os outros.

## Custo e privacidade

- Custo de servidor zero: tudo roda no navegador do visitante.
- Nenhuma imagem sai do aparelho. Se um dia houver OCR na nuvem (fase 3), ela vira um serviço Cloud Run
  com `min-instances = 0`, declarado em OpenTofu em `infra/`, e a página passa a dizer claramente o que é enviado.
