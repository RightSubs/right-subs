# RightSubs (addon)

O addon do Stremio que vai dentro do APK: entrega a legenda **certa, no seu idioma e sincronizada** em qualquer arquivo, sem escolher player, legenda ou ajustar atraso. Para instalar, use o APK: [README da raiz](../README.md).

- Oferece ao Stremio **uma única faixa**, já escolhida: o player a seleciona sozinho.
- Escolhe a melhor legenda no idioma principal (padrão pt-BR) pelo hash do arquivo, nome do release, **edição** (DC, Extended…), grupo, origem, resolução e fps. Sem nenhuma no principal, entrega o secundário (padrão pt-PT).
- Sincroniza sozinho quando a legenda é de outro release, contra uma referência: legenda feita para o arquivo exato (qualquer idioma; inglês buscado só como referência), legenda **embutida** no arquivo, ou legenda de outro release da mesma edição, origem e resolução. Corrige deslocamento e fps; sem referência, corrige só o fps pelo valor real do arquivo.
- Acha o arquivo que está tocando pelo Real-Debrid ou, num torrent sem Real-Debrid, pelo servidor local do Stremio.
- Converte para UTF-8 (acentos de legendas antigas) e guarda em cache.
- Fontes de legenda plugáveis (padrão: OpenSubtitles — API gratuita + addon v3, que não gasta cota).
- Anime pelo catálogo Anime Kitsu (converte os ids para IMDb, inclusive numeração absoluta).

Como cada etapa funciona e as limitações conhecidas: [docs/CONFIGURACAO.md](docs/CONFIGURACAO.md#sync).

## Desenvolvimento

Requer Node.js ≥ 22.18 e ffmpeg. Na pasta `rightsubs/`:

```sh
npm install
cp config.example.yaml config.yaml && cp .env.example .env   # preencha o .env
npm run dev               # executa o TypeScript direto: http://127.0.0.1:7000/manifest.json
npm test
npm run typecheck
npm run build             # gera dist/ (JavaScript) — é o que vai no APK
```

O Stremio Desktop aceita o addon local pela mesma URL, para testar sem a TV. `config.yaml` e `.env` ficam fora do git e nunca entram no APK.

No aparelho roda só o JavaScript compilado (TypeScript direto custaria ~20 MB a mais de memória), com as dependências `yaml` e `zod` — JavaScript puro, sem módulos nativos.

## Documentação

| Documento | Conteúdo |
|---|---|
| [CONFIGURACAO.md](docs/CONFIGURACAO.md) | Todas as opções do `config.yaml`, como a sincronização decide, limitações |
| [DESCOBERTAS.md](docs/DESCOBERTAS.md) | Comportamento real do Stremio e do OpenSubtitles, medições e casos de teste reais |
| [PROXIMOS-PASSOS.md](docs/PROXIMOS-PASSOS.md) | Pendências e o que ficou adiado |
| [NOVO-PROVEDOR.md](docs/NOVO-PROVEDOR.md) | Como adicionar uma fonte de legendas |
| [PLANO-DESENVOLVIMENTO.md](docs/PLANO-DESENVOLVIMENTO.md), [PLANO-COMPLEMENTO.md](docs/PLANO-COMPLEMENTO.md), [COMPLEMENTO-SEM-PROXY.md](docs/COMPLEMENTO-SEM-PROXY.md) | Histórico: arquitetura e roteiros (escritos para a instalação antiga, pelo Termux) |
