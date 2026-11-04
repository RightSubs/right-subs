# Configuração

**No APK, o `config.yaml` é gerado pelo app** a cada início (`ConfigWriter.kt`, a partir do `config.example.yaml`): servidor em `127.0.0.1:7000`, Real-Debrid ligado quando há token, fonte `stremio` sempre ligada, idiomas da tela; os segredos vão como variáveis de ambiente do processo, nunca em arquivo. As demais opções seguem os padrões abaixo. Esta página vale para entender o comportamento e para rodar o addon no computador (`npm run dev`).

No computador, o RightSubs usa dois arquivos na pasta `rightsubs/`, ambos fora do git:

| Arquivo | Conteúdo | Criar a partir de |
|---|---|---|
| `config.yaml` | Todas as opções | `cp config.example.yaml config.yaml` |
| `.env` | Segredos (API keys, senhas, URL do Torrentio) | `cp .env.example .env` |

No `config.yaml`, um valor `${NOME}` é substituído pela variável `NOME` do `.env` (ou do ambiente, que tem prioridade).

Depois de editar:

```sh
npm run check-config              # valida e mostra o resumo
npm run dev                       # reinicie para aplicar
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

**Limitação conhecida (2026-11-01):** o secundário só entra quando a busca **não encontra nenhuma** legenda no principal (a escolha é feita na resposta da busca, antes de baixar). Nestes casos ele **não** é usado:

- **Principal existe, mas fora de sincronia** (`no_reference`/`low_confidence`): tenta as outras do principal que não gastam cota e entrega a melhor delas, mesmo sem conferir — nunca troca para o secundário (`low_confidence` em `useSecondaryWhen` ainda não é aplicado no código, só aparece no `/health`).
- **Principal existe, mas nenhum download dá certo** (cota esgotada, arquivo que não é SRT): fica sem legenda (`subtitles.unavailable`).
- Idiomas de `sync.referenceLanguages` nunca são entregues: sem principal nem secundário, não há faixa.

Trocar nesses casos é uma escolha, não só código: uma PT-PT sincronizada costuma ser melhor que uma PT-BR fora de tempo, mas nem toda troca compensa.

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

Sem os indexadores (modo complemento), o RightSubs procura o arquivo que está tocando nestas fontes, nesta ordem; a primeira que acha vence:

### `realdebrid`

Histórico de downloads do Real-Debrid (`RD_TOKEN` no `.env`). O link aparece no 2º pedido de legendas do Stremio.

| Opção | Padrão | Descrição |
|---|---|---|
| `enabled` | `true` | No `config.example.yaml` vem `false`. |
| `token` | — | `${RD_TOKEN}`; obrigatório quando ligado. |
| `lookback` | `20` | Quantos downloads recentes procurar. |
| `timeoutMs` | `3000` | Tempo máximo da consulta. |

### `stremio` (torrent sem Real-Debrid)

O servidor de streaming do próprio Stremio, que baixa o torrent no aparelho. Lista os torrents ativos em `/stats.json`; o RightSubs acha o arquivo pelo nome e tamanho e lê **só o fps e as faixas** (ffprobe, prazo de 15 s). A **legenda embutida não é lida**: o torrent teria que baixar o meio do filme junto com a reprodução (medido: um trecho passou de 5 min e roubou banda do vídeo). Só funciona com o RightSubs no **mesmo aparelho** do Stremio (o APK liga sozinho).

| Opção | Padrão | Descrição |
|---|---|---|
| `enabled` | `true` | No `config.example.yaml` vem `false`. |
| `url` | `http://127.0.0.1:11470` | Endereço do servidor de streaming do Stremio. |
| `timeoutMs` | `2000` | Tempo máximo da consulta ao `/stats.json`. |

## `sync`

Antes de tudo isso, se o arquivo já tem uma faixa de legenda no idioma principal ou secundário (não forçada, texto ou imagem), o RightSubs não busca nem sincroniza nada: só avisa no menu do Stremio (ver o [README](../../README.md#como-a-legenda-é-escolhida-e-sincronizada)).

Quando a legenda escolhida foi feita para outro release do mesmo vídeo, o RightSubs a confere, nesta ordem, parando no primeiro que se aplica:

1. contra uma legenda do OpenSubtitles feita para o arquivo exato (qualquer idioma) — corrige deslocamento e fps. Uma legenda de **outra versão** do filme (sem o "DC", "Extended"… que o arquivo tem, ou o contrário) não conta como exata;
2. se a legenda é da **mesma versão, origem e resolução** do arquivo (BluRay 2160p para um BluRay 2160p), considera provavelmente sincronizada e não lê nada do vídeo (`likely_synced`);
3. contra uma legenda **embutida no arquivo** (`embedded`);
4. contra uma legenda de **outro release da mesma versão, origem e resolução** (ex.: um DC BluRay 1080p de outro grupo), em qualquer idioma (`referenceMatch: same_edit` no log);
5. sem nada para comparar, corrige só o fps, se o fps real do arquivo (lido via indexadores + ffprobe) for diferente do da legenda.

**Limitação:** sem nenhuma referência em texto (nem exata, nem embutida, nem da mesma versão), a legenda sai como baixada (`no_reference`). A etapa 5 depende do fps que o OpenSubtitles informa, e esse dado às vezes está errado (ex.: legenda feita para 23,976 marcada como 24 ou 25). Também não há como saber que dois nomes de versão (ex.: "Extended" e "DC") são o mesmo corte. Esses casos só serão resolvidos com a sincronização pelo áudio, ainda não implementada.

| Opção | Padrão | Descrição |
|---|---|---|
| `enabled` | `true` | Liga/desliga a sincronização automática. |
| `budgetSeconds` | `15` | Tempo máximo para preparar a legenda depois que o player a pede; passado isso, entrega a melhor disponível. |
| `minConfidence` | `0.7` | Confiança mínima (0–1, fração das falas que coincidem) para aplicar a correção. Além disso, a correção precisa melhorar pelo menos 0,1 sobre não corrigir. |
| `referenceLanguages` | `[en]` | Idiomas **só para sincronizar**, nunca entregues ao player: entram na mesma busca do OpenSubtitles (sem gastar cota) para achar legendas do arquivo exato ou da mesma versão, e a faixa embutida nesses idiomas é a preferida (sem ela, qualquer outra de texto: todas têm o mesmo tempo). As legendas de `languages` também servem de referência. A maioria das legendas exatas está em inglês: com `[]` e idiomas que não incluam o inglês, muitos filmes ficam sem referência (Enter the Void DC: `no_reference` em vez de ×0,95904). |
| `embedded.enabled` | `true` | Sem legenda de referência no OpenSubtitles, usa uma legenda **em texto embutida no arquivo** (SRT/ASS; não PGS) como referência. Precisa saber a URL do arquivo (indexadores ou Real-Debrid; nunca em torrent pelo servidor do Stremio) e do ffmpeg. Não confundir com o **aviso de faixa embutida no idioma do usuário**: ele não depende desta opção (só do `ffprobe` e de localizar o arquivo) e acontece antes de qualquer busca. |
| `embedded.windows` | `3` | Quantos trechos do vídeo ler, um por terço do filme, nas partes com mais fala (guiado pela própria legenda). A **tradução pelo DeepL lê sempre 6** (mínimo para conferir as duas metades), com cache à parte, qualquer que seja este valor; o prazo desses trechos extras supõe 25 Mbit/s no total em vez de 50. |
| `embedded.windowSeconds` | `45` | Duração de cada trecho. Os trechos são lidos ao mesmo tempo: num 4K, ~40 MB cada, ~5 s no total; **nada é gravado em disco** — só as falas extraídas (poucos KB) vão para o cache. O player recebe a legenda **depois** dessa leitura (ele usa a primeira que recebe até o fim do filme); nas próximas vezes é instantâneo. Cada trecho tem 15 s para ser lido; em arquivos pesados o prazo cresce com o bitrate (o bastante para ler todos os trechos a ~50 Mbit/s no total, no máximo 2 min; Drive 2011 OpenMatte: ~85 s). Se o player desistir de esperar, a leitura termina mesmo assim e a próxima vez sai sincronizada. **Não diminua para economizar banda:** com trechos de 20 s ou menos, o Drive (2011) sincronizou errado ou não sincronizou. |
| `audio.samples` | `8` | Reservado para a sincronização pelo áudio (fase 4, ainda não implementada). |
| `audio.sampleSeconds` | `45` | Idem. |

## `translation.deepl`

Último recurso: sem nenhuma legenda no idioma principal nem no secundário, traduz uma legenda de **qualquer idioma** do OpenSubtitles cujo tempo foi confirmado pela faixa embutida (6 trechos de 45 s, conferidos nas duas metades; ver [TRADUCAO-DEEPL.md](TRADUCAO-DEEPL.md)). Quando há tradutor, a busca cobre todos os idiomas. Até 8 candidatas, gratuitas (v3) primeiro; vence a de maior confiança (empate: inglês).

A legenda traduzida:

- leva o aviso "[Legenda traduzida por IA (DeepL)]" (aos 0,5 s, aos 60 s e a cada 15 min);
- vem **sem** as tags `<font>` da original, então vale a cor e a borda do Stremio;
- num **filme** sem faixa embutida de texto para conferir o tempo, é traduzida mesmo assim se o fps da legenda for o do arquivo, e o aviso diz "tempo não confirmado" (séries não);
- fica no cache por `cache.maxAgeDays`, e reproduzir de novo não gasta cota.

Na **primeira vez** de um filme ou episódio a tradução leva de 20 a 60 s e o Stremio desiste em 10 s (nas TVs Android, o vídeo nem abre). Por isso, se não estiver pronta em **3 s**, a faixa responde com uma legenda provisória ("Saia do vídeo e abra de novo em cerca de 30 s") e a tradução termina em segundo plano; ao reabrir, sai do cache. Esse prazo não é uma opção do `config.yaml`.

**Real-Debrid:** a conferência do tempo precisa do link direto do arquivo, que só vem do Real-Debrid (`streams.realdebrid`). Em torrent do Stremio (`streams.stremio`) não se lê a faixa embutida: legenda exata é traduzida como está, filme leva "tempo não confirmado", série fica sem tradução. Outros debrids não são suportados. Tabela completa em [TRADUCAO-DEEPL.md](TRADUCAO-DEEPL.md#o-que-depende-de-como-se-assiste-real-debrid-torrent-outros).

| Opção | Padrão | O que faz |
|---|---|---|
| `enabled` | `false` | Liga a tradução. Exige `apiKey`. No APK, liga sozinha quando há chave. |
| `apiKey` | — | Chave do DeepL (`${DEEPL_API_KEY}`); a que termina em `:fx` usa o endpoint gratuito (500 mil caracteres/mês; um episódio gasta ~21 mil). |
| `timeoutMs` | `15000` | Prazo de cada pedido ao DeepL. |
| `forceFrom` | `[]` | **SÓ PARA TESTE.** Com idiomas (ex.: `[en]`), ignora as legendas que já existem no idioma principal e no secundário e traduz **sempre**, só a partir destes idiomas, pela mesma conferência de tempo. O resultado vai para um cache à parte (`translated-forced:`). Serve para ver a tradução de um episódio que já tem legenda em português (Creature Commandos S01E03). Não há campo no app; só no `config.yaml` de um addon rodando no PC. Gasta cota do DeepL a cada episódio. |

## `resources`

Controla quanto da box o RightSubs usa. Ele só trabalha quando o Stremio pede; fora disso, fica no mínimo.

| Opção | Padrão | Descrição |
|---|---|---|
| `idleAfterMinutes` | `10` | Sem pedidos do Stremio por este tempo, o addon entra em modo ocioso: libera caches em memória, limpa temporários e o cache em disco, e força a coleta de lixo. |
| `maxIdleMemoryMB` | `80` | Se a memória continuar acima disso depois da limpeza, o serviço reinicia limpo (volta em ~1s). |
| `maxConcurrentJobs` | `1` | Quantas sincronizações podem rodar ao mesmo tempo. |
| `lowPriority` | `true` | O serviço e o ffmpeg rodam com prioridade baixa, cedendo a CPU para o Stremio. |

Acompanhe pelo `/health` (`http://127.0.0.1:7000/health`; na box, skill `box`): `resources.state` (`active`/`idle`), `rssMB` (memória) e `cacheMB`.

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
