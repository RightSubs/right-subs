# Configuração

O RightSubs usa dois arquivos na pasta do projeto, ambos fora do git:

| Arquivo | Conteúdo | Criar a partir de |
|---|---|---|
| `config.yaml` | Todas as opções | `cp config.example.yaml config.yaml` |
| `.env` | Segredos (API keys, senhas, URL do Torrentio) | `cp .env.example .env` |

No `config.yaml`, um valor `${NOME}` é substituído pela variável `NOME` do `.env` (ou do ambiente, que tem prioridade).

Depois de editar:

```sh
npm run check-config              # valida e mostra o resumo
sh scripts/rightsubs.sh restart   # aplica
```

Erros apontam a opção exata, por exemplo:

```
providers[opensubtitles-api].apiKey: obrigatório (variável OPENSUBTITLES_API_KEY não definida no .env)
languages.primary: idioma "pt-BRR" desconhecido — exemplos válidos: pt-BR, pt-PT, en-US, es, fr
server: opção desconhecida: prot (erro de digitação?)
```

## `server`

| Opção | Padrão | Descrição |
|---|---|---|
| `host` | `127.0.0.1` | Endereço onde o addon escuta. `127.0.0.1` = só a própria box. |
| `port` | `7000` | Porta. Se mudar, reinstale o addon no Stremio com a nova URL. |

## `languages`

| Opção | Padrão | Descrição |
|---|---|---|
| `primary` | — (obrigatório) | Idioma que você quer ver. |
| `secondary` | — | Usado quando o principal não está disponível. Opcional. |
| `useSecondaryWhen` | `[not_found]` | Quando usar o secundário: `not_found` (não existe legenda no principal). `low_confidence` (existe, mas a sincronização ficou incerta) é aceito, mas **ainda não tem efeito** — depende da fase 4. |

Idiomas aceitos (maiúsculas/minúsculas e `_` ou `-` tanto faz):

| Valor | Idioma |
|---|---|
| `pt-BR` | Português (Brasil) |
| `pt-PT` | Português (Portugal) |
| `en`, `en-US`, `en-GB` | Inglês (fontes de legenda não distinguem variantes) |
| `es` | Espanhol |
| `fr`, `de`, `it`, `nl`, `pl`, `ru`, `tr`, `ar`, `ja`, `ko`, `zh-CN`, `zh-TW` | Outros |

Os códigos internos de cada serviço (Stremio, OpenSubtitles) são convertidos automaticamente — tabela em `src/languages/languages.ts`.

Dica: no Stremio, deixe a legenda padrão igual ao `primary` e a secundária igual ao `secondary`.

## `providers`

Lista de fontes de legenda, **em ordem de prioridade**. Campos comuns:

| Opção | Descrição |
|---|---|
| `id` | Nome único, livre (aparece nos logs e no `/health`). |
| `type` | Tipo da fonte (abaixo). |
| `enabled` | `true`/`false`. Desabilitado = ignorado, sem validar as demais opções. Padrão `true`. |

### `type: stremio-addon`

Qualquer addon de legendas do Stremio — sem escrever código.

| Opção | Padrão | Descrição |
|---|---|---|
| `url` | — | URL do `manifest.json` do addon. |
| `timeoutMs` | `8000` | Tempo máximo de resposta. |

### `type: opensubtitles-api`

API oficial do OpenSubtitles (conta gratuita).

| Opção | Padrão | Descrição |
|---|---|---|
| `apiKey` | — | API key (perfil → API consumers). |
| `username`, `password` | — | Login da conta. Opcionais, mas aumentam a cota diária de downloads; informe os dois juntos. |
| `downloadVia` | — | `id` de outro provedor habilitado usado para baixar os arquivos sem gastar a cota (ex.: `opensubtitles-v3`). |
| `timeoutMs` | `8000` | Tempo máximo de resposta. |

Para adicionar outros tipos de fonte, veja [NOVO-PROVEDOR.md](NOVO-PROVEDOR.md).

## `streams`

Indexadores de streams (Torrentio, Sootio…) já configurados com o Real-Debrid. O RightSubs consulta todos em paralelo e devolve ao Stremio as listas **sem alterar nada** (nomes, ordem, links), na ordem do config. Em troca, ele sabe qual arquivo está tocando e lê o fps real e as faixas embutidas (ffprobe, só o cabeçalho, sem baixar o vídeo). Depois de ligar, **desinstale os indexadores do Stremio** e reinstale o RightSubs (o manifest passa a declarar streams).

```yaml
streams:
  indexers:
    - id: torrentio
      enabled: true
      url: ${TORRENTIO_URL}
    - id: sootio
      enabled: true
      url: ${SOOTIO_URL}
```

| Opção | Padrão | Descrição |
|---|---|---|
| `id` | — | Nome do indexador nos logs e no `/health`. |
| `enabled` | `true` | `false` mantém a entrada sem usá-la (a URL deixa de ser obrigatória). |
| `url` | — | URL do **manifest** do addon (termina em `/manifest.json`). Guarde no `.env`: ela contém sua chave do RD. O RightSubs nunca a escreve nos logs. |
| `timeoutMs` | `10000` | Tempo máximo de espera por este indexador; um indexador lento ou fora do ar não bloqueia os demais. |

## `sync`

Quando a legenda escolhida foi feita para outro release do mesmo vídeo, o RightSubs a confere, nesta ordem, parando no primeiro que se aplica:

1. contra uma legenda do OpenSubtitles feita para o arquivo exato (qualquer idioma) — corrige deslocamento e fps;
2. se a legenda é da **mesma origem e resolução** do arquivo (BluRay 2160p para um BluRay 2160p), considera provavelmente sincronizada e não lê nada do vídeo (`likely_synced`);
3. contra uma legenda **embutida no arquivo** (`embedded`);
4. sem nada para comparar, corrige só o fps, se o fps real do arquivo (lido via indexadores + ffprobe) for diferente do da legenda.

| Opção | Padrão | Descrição |
|---|---|---|
| `enabled` | `true` | Liga/desliga a sincronização automática. |
| `budgetSeconds` | `15` | Tempo máximo para preparar a legenda depois que o player a pede; passado isso, entrega a melhor disponível. |
| `minConfidence` | `0.7` | Confiança mínima (0–1, fração das falas que coincidem) para aplicar a correção. Além disso, a correção precisa melhorar pelo menos 0,1 sobre não corrigir. |
| `embedded.enabled` | `true` | Sem legenda de referência no OpenSubtitles, usa uma legenda **em texto embutida no arquivo** (SRT/ASS; não PGS) como referência. Precisa dos indexadores (para saber a URL do arquivo) e do ffmpeg. |
| `embedded.windows` | `3` | Quantos trechos do vídeo ler, um por terço do filme, nas partes com mais fala (guiado pela própria legenda). |
| `embedded.windowSeconds` | `45` | Duração de cada trecho. Os trechos são lidos ao mesmo tempo: num 4K, ~40 MB cada, ~5 s no total; **nada é gravado em disco** — só as falas extraídas (poucos KB) vão para o cache. O player recebe a legenda **depois** dessa leitura (ele usa a primeira que recebe até o fim do filme); nas próximas vezes é instantâneo. |
| `audio.samples` | `8` | Reservado para a sincronização pelo áudio (fase 4, ainda não implementada). |
| `audio.sampleSeconds` | `45` | Idem. |

## `resources`

Controla quanto da box o RightSubs usa. Ele só trabalha quando o Stremio pede; fora disso, fica no mínimo.

| Opção | Padrão | Descrição |
|---|---|---|
| `idleAfterMinutes` | `10` | Sem pedidos do Stremio por este tempo, o addon entra em modo ocioso: libera caches em memória, limpa temporários e o cache em disco, e força a coleta de lixo. |
| `maxIdleMemoryMB` | `80` | Se a memória continuar acima disso depois da limpeza, o serviço reinicia limpo (volta em ~1s). |
| `maxConcurrentJobs` | `1` | Quantas sincronizações podem rodar ao mesmo tempo. |
| `lowPriority` | `true` | O serviço e o ffmpeg rodam com prioridade baixa, cedendo a CPU para o Stremio. |

Acompanhe pelo `/health` (`sh scripts/rightsubs.sh status`): `resources.state` (`active`/`idle`), `rssMB` (memória) e `cacheMB`.

## `cache`

| Opção | Padrão | Descrição |
|---|---|---|
| `dir` | `~/.rightsubs/cache` | Onde guardar legendas prontas. |
| `maxSizeMB` | `50` | Tamanho máximo. Uma legenda tem ~50–100 KB, então cabem centenas de filmes. As menos usadas saem primeiro. |
| `maxAgeDays` | `10` | Legendas não usadas há mais tempo são apagadas (reassistir é raro; uma legenda apagada é simplesmente buscada de novo). |

A limpeza roda na inicialização e sempre que o addon fica ocioso.

## `log`

| Opção | Padrão | Descrição |
|---|---|---|
| `level` | `info` | `debug`, `info`, `warn` ou `error`. |

Logs em `~/.rightsubs/logs/rightsubs.log` (pasta alterável pela variável de ambiente `RIGHTSUBS_HOME`), com rotação em 2 MB — no máximo 4 MB no total.

## Memória do Node

O supervisor inicia o Node com heap limitado (`--max-old-space-size=128 --max-semi-space-size=2 --expose-gc`). Para mudar, defina `RIGHTSUBS_NODE_FLAGS` antes de iniciar o serviço.
