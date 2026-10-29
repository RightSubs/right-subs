# RightSubs

Addon do Stremio que roda na própria box Android/Google TV e garante a legenda **certa, no seu idioma e sincronizada** em qualquer arquivo — sem escolher player, sem escolher legenda, sem ajustar delay.

- Oferece ao Stremio **uma única faixa**, já escolhida: o player a seleciona sozinho
- Escolhe a melhor legenda no idioma principal (padrão: PT-BR) — hash do arquivo, nome do release, grupo, origem, fps
- Sem legenda no idioma principal? Entrega o idioma secundário (padrão: EN)
- Sincroniza automaticamente quando a legenda é de outro release: alinha contra uma legenda feita para o arquivo exato (deslocamento + fps) e corrige o fps pelo valor real do arquivo
- Converte para UTF-8 (acentos de legendas antigas) e guarda em cache
- Fontes de legenda plugáveis (padrão: OpenSubtitles — API gratuita + addon v3, que não gasta cota)
- Passa os streams do Torrentio e do Sootio (com Real-Debrid) sem alterar nada — e assim sabe qual arquivo está tocando
- Anime pelo catálogo Anime Kitsu: converte os ids do Kitsu para os do IMDb (inclusive numeração absoluta de episódios)

**Vai instalar? Comece pelo [guia](docs/GUIA.md)** — requisitos, o que preparar e o passo a passo.

Tudo configurável em um único arquivo — veja [`config.example.yaml`](config.example.yaml) e [docs/CONFIGURACAO.md](docs/CONFIGURACAO.md).

> Fases 0–3 do [plano](docs/PLANO-DESENVOLVIMENTO.md) concluídas e em uso. Sincronização pelo áudio/legenda embutida (fase 4) e tradução automática ficam para quando houver necessidade.

**Atenção:** a lista de addons do Stremio é da conta. Se você usa o Stremio em outros aparelhos com a mesma conta, leia o aviso em [INSTALACAO-BOX.md §6](docs/INSTALACAO-BOX.md#6-instalar-no-stremio-e-remover-os-outros-addons) antes de instalar.

## Instalação na box

[docs/INSTALACAO-BOX.md](docs/INSTALACAO-BOX.md) — Termux, inicialização automática e instalação no Stremio.

## Desenvolvimento

Requer Node.js ≥ 22.18 e ffmpeg.

```sh
npm install
cp config.example.yaml config.yaml && cp .env.example .env   # preencha o .env
npm run dev               # executa o TypeScript direto: http://127.0.0.1:7000/manifest.json
npm test
npm run typecheck
npm run build             # gera dist/ (JavaScript) — é o que roda na box
```

O Stremio Desktop aceita o addon local pela mesma URL, para testar sem a box.

Na box roda só o JavaScript compilado (executar TypeScript direto custaria ~20 MB a mais de memória), com as dependências de runtime `yaml` e `zod` — JavaScript puro, sem módulos nativos. Metas e mecanismos de uso de recursos: [plano §6.1](docs/PLANO-DESENVOLVIMENTO.md).

## Documentação

| Documento | Conteúdo |
|---|---|
| [GUIA.md](docs/GUIA.md) | **Comece aqui:** requisitos, o que preparar, passo a passo, atualizar |
| [PLANO-DESENVOLVIMENTO.md](docs/PLANO-DESENVOLVIMENTO.md) | Objetivo, arquitetura, fases |
| [INSTALACAO-BOX.md](docs/INSTALACAO-BOX.md) | Instalação e operação na box |
| [CONFIGURACAO.md](docs/CONFIGURACAO.md) | Todas as opções do `config.yaml` |
| [NOVO-PROVEDOR.md](docs/NOVO-PROVEDOR.md) | Como adicionar uma fonte de legendas |
| [PROXIMOS-PASSOS.md](docs/PROXIMOS-PASSOS.md) | Onde paramos e como retomar |
| [DESCOBERTAS.md](docs/DESCOBERTAS.md) | Comportamento real do Stremio, do OpenSubtitles e dos casos analisados |
