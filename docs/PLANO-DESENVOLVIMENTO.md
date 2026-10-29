# RightSubs — Plano de Desenvolvimento

> Status: **aprovado** — fase 0 pronta no computador; validação na box adiada (ver [PROXIMOS-PASSOS.md](PROXIMOS-PASSOS.md))
> Última atualização: 2026-10-28

## 1. Objetivo

Addon do Stremio, rodando na própria box (Chromecast com Google TV 4K, via Termux), que garante:

> Pesquisar um título → escolher **qualquer** arquivo → dar play → assistir com legenda **sincronizada** no idioma principal (PT-BR) ou, se não existir, no secundário (EN) — sem escolher player, sem escolher legenda, sem ajustar delay.

### Premissas
- **Uso mínimo de recursos da box:** consome memória/CPU/disco só enquanto o Stremio usa o addon; ocioso, fica no piso (ver §6.1).
- **Somente serviços gratuitos.**
- **Tudo configurável por arquivo:** idiomas, fontes de legenda, sincronização — sem mexer em código.
- Player: EXO fixo no Stremio (MPV como alternativa manual; o addon funciona igual com os dois).

### Fora de escopo (agora)
- Tradução automática — documentada como evolução futura (§10).
- Controlar o player (é configuração do app Stremio).
- Substituir Real-Debrid ou Torrentio (continuam sendo a fonte dos streams).
- Rodar em nuvem.

## 2. Como o addon se integra ao Stremio

O addon não sobrepõe o Stremio — participa do protocolo oficial de addons:

```
Stremio (EXO, legenda padrão PT-BR, secundária EN)
  │
  ├─ GET /stream/{type}/{id}.json
  │     → addon consulta os indexadores (Torrentio e Sootio, com sua chave RD) e devolve as MESMAS listas
  │     → registra filename/tamanho → URL de cada arquivo (para ler o vídeo depois)
  │
  ├─ GET /subtitles/{type}/{id}/{videoHash,videoSize,filename}.json
  │     → responde NA HORA com 1 faixa: PT-BR se existir; senão EN
  │     → dispara a preparação (sincronização) em background
  │
  └─ Player baixa GET /sub/<chave>.srt
        → addon entrega a legenda pronta, aguardando a sincronização
          dentro do orçamento de tempo
```

As preferências do Stremio (principal PT-BR, secundária EN) continuam iguais às suas e casam com o que o addon devolve. Se o addon estiver fora do ar, o Stremio segue com embutidas — o pior caso é igual a hoje.

## 3. Idiomas: principal e secundário

```yaml
languages:
  primary: pt-BR
  secondary: en-US
  useSecondaryWhen: [not_found]     # opcional: [not_found, low_confidence]
```

| Situação | O que o addon entrega |
|---|---|
| Existe legenda no idioma principal | Principal, sincronizada |
| Não existe no principal | Secundária, sincronizada |
| Principal existe mas a sincronização ficou com baixa confiança | Por padrão, a principal mesmo assim. Com `low_confidence` ativado, prefere a secundária bem sincronizada. |

- Códigos de cada serviço (Stremio, OpenSubtitles) derivados automaticamente de uma tabela de idiomas. Ex.: `en-US` vira `en`/`eng` nas buscas — fontes de legenda não distinguem variantes regionais do inglês.
- Trocar de idioma = editar duas linhas e reiniciar o serviço.

## 4. Fontes de legenda: provedores plugáveis

### OpenSubtitles: conta gratuita + addon v3, combinados

| Provedor | Conta | Uso |
|---|---|---|
| **API OpenSubtitles** (conta gratuita + API key gratuita) | Sim, gratuita | **Busca**: devolve release, fps, indicação de match por hash. A busca não consome a cota de downloads. |
| **Addon OpenSubtitles v3 do Stremio** | Não | **Download sem cota**, se os IDs casarem com os da API (a confirmar na fase 1). Também serve de fallback quando a cota da API acabar. |

**Cota gratuita (confirmar os valores atuais ao criar a conta):** em torno de 20 downloads/dia com login, menos sem login. Uso típico estimado: 1–3 downloads por arquivo novo (legenda escolhida + eventual referência), zero em arquivos repetidos (cache). Filmes cabem com folga; maratona de série é o cenário de risco — coberto pelo download via addon v3 e pelo cache.

O `/health` mostra o consumo diário da cota.

### Tipos de provedor

| Tipo | Como adicionar | Exemplos |
|---|---|---|
| `stremio-addon` | **Só configuração:** URL do manifest de qualquer addon de legendas do Stremio | OpenSubtitles v3, SubDL, SubSource (versões addon) |
| Nativo (API) | Um arquivo em `src/providers/` implementando `SubtitleProvider` + entrada no config | API OpenSubtitles |

```ts
interface SubtitleProvider {
  id: string;
  search(query: SubtitleQuery): Promise<SubtitleCandidate[]>; // imdb, temporada/ep, hash, tamanho, filename, idiomas
  download(candidate: SubtitleCandidate): Promise<Buffer>;
}
```

## 5. Configuração

Um único arquivo YAML (aceita comentários, editável no Termux com `nano`). Segredos em `.env`, referenciados por `${VAR}`. Ambos fora do git; o repositório traz `config.example.yaml` e `.env.example`.

```yaml
server:
  port: 7000

languages:
  primary: pt-BR
  secondary: en-US
  useSecondaryWhen: [not_found]

providers:                       # ordem = prioridade
  - id: opensubtitles-api
    type: opensubtitles-api
    enabled: true
    apiKey: ${OPENSUBTITLES_API_KEY}
    username: ${OPENSUBTITLES_USER}
    password: ${OPENSUBTITLES_PASSWORD}
    downloadVia: opensubtitles-v3   # baixa pelo addon (sem cota) quando possível
  - id: opensubtitles-v3
    type: stremio-addon
    url: https://opensubtitles-v3.strem.io/manifest.json
    enabled: true
  # - id: subdl
  #   type: stremio-addon
  #   url: <manifest do addon SubDL>
  #   enabled: true

streams:
  indexers:                      # Torrentio + Sootio, já configurados com o Real-Debrid (fase 3)
    - id: torrentio
      url: ${TORRENTIO_URL}
    - id: sootio
      url: ${SOOTIO_URL}

sync:
  enabled: true
  budgetSeconds: 15              # quanto esperar antes de entregar o melhor disponível
  minConfidence: 0.7
  audio:
    samples: 8
    sampleSeconds: 45

resources:
  idleAfterMinutes: 10           # sem pedidos do Stremio → libera memória e limpa temporários
  maxIdleMemoryMB: 80            # acima disso ao ficar ocioso → reinicia limpo
  maxConcurrentJobs: 1
  lowPriority: true              # o Stremio sempre ganha a CPU

cache:
  dir: ~/.rightsubs/cache
  maxSizeMB: 50
  maxAgeDays: 10

log:
  level: info
```

Validação ao iniciar, com erro legível (ex.: `languages.primary "pt-BRR" desconhecido — exemplos válidos: pt-BR, pt-PT, es, en-US`).

## 6. Decisões técnicas

| Tema | Decisão | Motivo |
|---|---|---|
| Linguagem | TypeScript (Node.js LTS) | `stremio-addon-sdk` oficial; Node disponível no Termux |
| Dependências | Somente JS puro (sem módulos nativos) | Compilar módulos nativos no Termux/ARM é frágil |
| Ferramentas externas | `ffmpeg`/`ffprobe` via subprocesso | Leitura de cabeçalho e de trechos de áudio |
| Sincronização | Motor próprio em TS (texto×texto e áudio×texto) | Evita empacotar `alass`/`ffsubsync` no Termux; testável |
| Persistência | Arquivos em disco + índice JSON com LRU | Sem SQLite nativo; respeita o limite de armazenamento |
| Desenvolvimento | No Mac, com Stremio Desktop apontando para `127.0.0.1` | Ciclo rápido; a box só para validação |
| Deploy na box | `git clone`/`git pull` no Termux + scripts | Atualização em 1 comando |

### 6.1 Uso de recursos (requisito transversal)

O addon precisa estar escutando quando o Stremio chama, e no Android 10+ um app do Termux não consegue saber se o Stremio está aberto. Por isso o processo fica residente, mas **mínimo**: todo trabalho pesado é sob demanda e liberado logo depois.

**Metas (medidas na box):**

| Estado | Memória (RSS) | CPU | Disco |
|---|---|---|---|
| Ocioso (sem uso do Stremio há 10 min) | ≤ 60 MB | ~0% (nenhum timer ativo) | nenhuma escrita |
| Em uso (sincronizando) | pico ≤ 200 MB, incluindo ffmpeg | 1 núcleo, prioridade baixa | só cache de legendas |
| Total em disco | — | — | ≤ 60 MB além do Node/ffmpeg (cache 50 MB + logs 4 MB + código) |

**Mecanismos:**

| Recurso | Mecanismo | Desde |
|---|---|---|
| Memória do código | TypeScript compilado para JS na instalação; compilador removido em seguida (executar TS direto custava ~20 MB a mais) | Fase 0 |
| Memória do Node | Heap limitado (`--max-old-space-size=128`, `--max-semi-space-size=2`) | Fase 0 |
| Modo ocioso | Sem pedidos do Stremio por `idleAfterMinutes` → libera caches em memória, limpa temporários, força coleta de lixo. Se ainda estiver acima de `maxIdleMemoryMB`, reinicia limpo (o supervisor sobe de novo em 1s). | Fase 0 |
| CPU ocioso | Nenhum timer periódico: o único timer é armado por atividade e dispara uma vez | Fase 0 |
| Prioridade | Serviço e ffmpeg rodam com prioridade baixa (`nice 10`): o Stremio sempre ganha a CPU | Fase 0 |
| Disco — cache | Teto de tamanho (`maxSizeMB`, padrão 50) + validade (`maxAgeDays`, padrão 10), aplicados na inicialização e ao ficar ocioso | Fase 0 |
| Disco — temporários | Pasta `tmp` esvaziada na inicialização, ao ficar ocioso e ao fim de cada tarefa | Fase 0 |
| Disco — logs | Rotação em 2 MB, no máximo 2 arquivos (4 MB) | Fase 0 |
| Disco — instalação | Cache do npm limpo após instalar/atualizar; só dependências de runtime | Fase 0 |
| Desinstalação | `scripts/uninstall-termux.sh` remove serviço, boot, cache e logs (`--all` remove tudo) | Fase 0 |
| Tarefas pesadas | No máximo `maxConcurrentJobs` (padrão 1) sincronizações simultâneas; ffmpeg com 1 thread; processos filhos encerrados por timeout e ao parar o serviço | Fase 3–4 |
| Áudio | Lido por trechos via HTTP range e processado em fluxo (pipe), sem arquivos temporários; o vídeo nunca é gravado em disco | Fase 4 |
| Estruturas em memória | Mapas (ex.: arquivo → URL) com limite de itens e validade, liberados no modo ocioso | Fase 3 |

O `/health` mostra estado (`active`/`idle`), memória e ocupação do cache, para verificar as metas na prática.

**Critério de aceite em todas as fases:** as metas acima continuam sendo atendidas, medidas na box.

### Particularidades do Chromecast com Google TV 4K
- **2 GB de RAM, CPU ARM modesta:** limite de memória do Node, áudio mono 16 kHz em trechos curtos, texto×texto antes de áudio.
- **Armazenamento livre pequeno:** cache com teto configurável.
- **Sistema possivelmente 32 bits (ARM):** confirmar na fase 0 que Node e ffmpeg do Termux rodam na box — é o primeiro teste.
- **Imagem/som (referência para escolher arquivos, não afeta o addon):** Dolby Vision perfis 5 e 8 funcionam; perfil 7 (remux UHD de dupla camada) não. Atmos via DD+ (EAC3) costuma ser repassado; TrueHD em geral não.

## 7. Estrutura do repositório

```
right-subs/
├── README.md
├── config.example.yaml
├── .env.example
├── docs/
│   ├── PLANO-DESENVOLVIMENTO.md
│   ├── INSTALACAO-BOX.md          # fase 0
│   ├── CONFIGURACAO.md            # cada opção do YAML explicada
│   ├── NOVO-PROVEDOR.md           # como adicionar uma fonte de legenda
│   ├── DESCOBERTAS.md             # comportamento real do Stremio (fase 1)
│   └── FUTURO-TRADUCAO.md         # desenho da tradução opcional (§10)
├── src/
│   ├── server.ts
│   ├── config/                    # carregamento, validação, ${VAR}
│   ├── languages/                 # tabela de idiomas + mapeamento de códigos
│   ├── stremio/                   # handlers: stream, subtitles, /sub/*.srt
│   ├── streams/                   # proxy Torrentio + mapa filename→URL
│   ├── providers/                 # registry + stremio-addon + opensubtitles-api
│   ├── ranking/
│   ├── subtitle/                  # parse/serialize SRT, encoding, fps
│   ├── sync/                      # alinhamento texto e áudio, confiança
│   ├── media/                     # ffprobe/ffmpeg
│   └── cache/
├── test/
│   ├── unit/
│   └── fixtures/
└── scripts/
    ├── install-termux.sh
    ├── update.sh
    └── boot/start-rightsubs
```

## 8. Fases

Cada fase termina com um **portão de aprovação**: demonstro o resultado, você valida na TV e aprova a próxima.

---

### Fase 0 — Fundação, configuração e infraestrutura na box
**Escopo**
- Repositório TypeScript (build, lint, testes, `.gitignore` de segredos).
- Sistema de configuração (YAML + `.env` + validação) e tabela de idiomas.
- Registry de provedores (interface, ainda sem implementação).
- Servidor com `manifest.json` e `/health`.
- `scripts/install-termux.sh`: Node, ffmpeg, git, Termux:Boot, `termux-wake-lock`.
- `docs/INSTALACAO-BOX.md` e `docs/CONFIGURACAO.md`.

**Critério de aceite**
- Node e ffmpeg rodando na box.
- Addon instalado no Stremio da box, volta sozinho após reiniciar e fica 24h no ar.
- Config inválido gera mensagem de erro clara.
- Ocioso: ≤ 60 MB de RSS no `/health` (`state: idle`).

**Plano B** se o Termux não se sustentar: dispositivo pequeno na mesma rede (Raspberry Pi), mesmo código.

---

### Fase 1 — Integração com o Stremio + primeira legenda útil
**Escopo**
- Provedores `opensubtitles-api` (com sua conta gratuita) e `stremio-addon` (OpenSubtitles v3).
- `/subtitles` devolvendo **uma** faixa: principal se existir, senão secundária (ainda sem sincronizar).
- Conversão para SRT UTF-8 (corrige acentos de legendas antigas).
- `/sub/*.srt` com preparação sob demanda e orçamento de tempo.
- Controle de cota da API (contador no `/health`, fallback automático para o addon v3).
- Logs estruturados de cada requisição.
- `docs/DESCOBERTAS.md` respondendo, com evidência:
  1. Código de idioma que o Stremio associa a "Português (Brasil)".
  2. EXO e MPV exibem a faixa externa do addon?
  3. Quem o Stremio prefere: faixa embutida ou faixa de addon no mesmo idioma?
  4. Quanto tempo o player espera pelo `.srt` antes de desistir.
  5. O Stremio envia `videoHash` para streams HTTP do Real-Debrid?
  6. Os IDs do addon v3 casam com os da API (download sem cota)?
- Remoção do OpenSubtitles v3 da sua instalação do Stremio.

**Critério de aceite**
- Ao dar play, a faixa do RightSubs aparece **selecionada automaticamente** no EXO (e testada no MPV).
- Título sem PT-BR recebe a faixa EN automaticamente.
- As 6 perguntas respondidas; fases seguintes ajustadas se algo contrariar as premissas.

---

### Fase 2 — Escolha inteligente + correções baratas
**Escopo**
- Ranking: hash > nome do release (grupo, fonte, resolução) > fps compatível > downloads/avaliação.
- Correção de frame rate (25 ↔ 23,976 ↔ 24).
- **Sincronização texto × texto (antecipada da fase 4, decisão de 2026-10-29):** quando a legenda escolhida não é do arquivo exato, alinhar contra uma **referência** do arquivo exato (match por hash ou mesmo nome de release, em qualquer idioma buscado) e corrigir **offset + fps**. Motivo: o Valkyrie (Licdom) mostrou deslocamento fixo de +25,5 s, medido com 91–95% de coincidência só com texto — barato (sem ffmpeg, milissegundos) e confiável. Sem referência ou com confiança baixa, entrega a legenda como está. Custo: +1 download da cota quando a referência não está no v3 (uma vez por arquivo, com cache).
- **Golden set:** 15 títulos reais que hoje dão problema, com resultado esperado registrado (1º: Valkyrie/Licdom, +25,5 s — [DESCOBERTAS.md](DESCOBERTAS.md)).

**Critério de aceite**
- ≥ 70% do golden set sem nenhum ajuste manual.

---

### Fase 3 — Proxy de streams (Torrentio + Sootio + Real-Debrid)
**Escopo**
- **Múltiplos indexadores** (decisão de 2026-10-28): o usuário usa Torrentio e Sootio, ambos com Real-Debrid. Se só um passasse pelo proxy, os streams do outro ficariam sem sincronização por áudio (sem o mapa filename → URL) — comportamento inconsistente conforme o indexador escolhido.
  - Config: `streams.upstream` (uma URL) vira uma lista de indexadores; `.env` ganha `SOOTIO_URL` ao lado de `TORRENTIO_URL`.
  - Indexadores consultados em paralelo; um lento ou fora do ar não bloqueia os demais (timeout por indexador).
- `/stream` devolvendo as listas **idênticas** de cada indexador (nomes, ordem, links).
- Mapa `filename + tamanho → URL`, alimentado por todos os indexadores.
- `ffprobe` sob demanda: fps real, faixas embutidas (idioma, formato).
- Torrentio e Sootio desinstalados do Stremio.

**Critério de aceite**
- Listas iguais às dos indexadores originais, overhead < 1s no conjunto.
- Indexador fora do ar não impede os resultados dos demais.
- Correção de fps passa a usar o fps real do arquivo.

---

### Fase 4 — Motor de sincronização automática
**Escopo**
- **Texto × texto:** a versão básica (offset + fps contra candidato do release exato) entra na fase 2. Aqui: faixa de texto **embutida** como referência, drift não linear e cortes.
- **Áudio × texto:** trechos do arquivo via HTTP range (sem baixar o filme), detecção de fala, ajuste de offset + drift, detecção de cortes.
- Score de confiança; regra `useSecondaryWhen: low_confidence` passa a funcionar.
- Vale para o idioma principal e para o secundário.
- Cache por arquivo.

**Critério de aceite**
- ≥ 90% do golden set sem ajuste manual (em PT-BR ou, na falta, EN).
- Legenda disponível em < 15s no primeiro play, medido na box.

---

### Fase 5 — Robustez, fontes extras e publicação
**Escopo**
- Fontes adicionais via configuração (addons SubDL/SubSource) + `docs/NOVO-PROVEDOR.md`.
- Watchdog, rotação de logs, `scripts/update.sh`.
- `docs/FUTURO-TRADUCAO.md`.
- README completo, licença, revisão de segredos — pronto para o GitHub.

**Critério de aceite**
- 1 semana de uso real sem intervenção.
- Adicionar um provedor `stremio-addon` exige só editar o YAML.

## 9. Decisões

| # | Decisão | Status |
|---|---|---|
| 1 | Nome do projeto | ✅ RightSubs (`right-subs`) |
| 2 | Box | ✅ Chromecast com Google TV 4K |
| 3 | Fontes de legenda | ✅ API OpenSubtitles (conta gratuita) para busca + addon v3 para download sem cota / fallback |
| 4 | Idiomas | ✅ Principal PT-BR, secundário EN |
| 5 | Tradução | ✅ Fora do escopo atual; documentada para o futuro |
| 6 | Conta OpenSubtitles + API key | ⏳ Antes da fase 1 — você cria; credenciais só no `.env` |
| 7 | URLs dos indexadores (Torrentio + Sootio) | ✅ Os dois passam pelo proxy (fase 3); URLs só no `.env` |
| 8 | Golden set (15 títulos) | ⏳ Fase 2 |

## 10. Futuro: tradução automática (opcional)

Não será implementada agora: com idioma secundário sincronizado, a maioria dos casos fica coberta. Se os dados de uso mostrarem muitos títulos caindo no secundário, a tradução entra como uma nova fase:

- Nova opção `useSecondaryWhen` → `translate`: traduz a legenda secundária **já sincronizada** para o idioma principal, preservando os tempos.
- Provedor de tradução plugável (mesmo modelo dos provedores de legenda); candidato inicial: **DeepL API Free** (conta gratuita, cota mensal de caracteres — alguns filmes por mês).
- Traduções em cache; consumo de cota no `/health`.
- Para facilitar: o RightSubs registra no log quantas vezes entregou o secundário — esse número decide se a fase vale a pena.

## 11. Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| Android encerra o Termux | Addon some | Wake lock, Termux:Boot, sem otimização de bateria; plano B Raspberry Pi |
| Box 32 bits / pouca RAM | Node ou ffmpeg não rodam bem | Validado logo na fase 0 |
| Cota diária da API OpenSubtitles | Sem download novo no dia | Download via addon v3, cache, contador no `/health` |
| IDs do addon v3 não casam com a API | Download via v3 não funciona | Downloads pela API (cota) + v3 como busca/download independente |
| Mudança no formato do addon v3 | Provedor quebra | Provedor isolado + testes de contrato; outras fontes via config |
| Player desiste antes da legenda ficar pronta | Sem legenda no 1º play | Orçamento medido na fase 1; entrega do melhor disponível; cache |
| Stremio não envia `videoHash` para HTTP | Perde match por hash | Mapa filename→URL (fase 3) e cálculo do hash pelo addon |
| Real-Debrid e IP | Bloqueio de conta | Tudo roda na box (mesmo IP da TV) |

## 12. Aprovação

Projeto aprovado em 2026-10-28. Sem acesso à box por enquanto, as fases são desenvolvidas e testadas no computador (Stremio Desktop) e validadas na box numa rodada única depois. Status: **pronta no computador** → **aceita** (após teste na box).

| Fase | Aprovada | Status |
|---|---|---|
| 0 — Fundação, configuração e infraestrutura na box | ✅ | **Aceita** na box (2026-10-29; falta confirmar 24 h no ar) |
| 1 — Integração com o Stremio + primeira legenda útil | ✅ | **Aceita** na box (2026-10-29) — [DESCOBERTAS.md](DESCOBERTAS.md) |
| 2 — Escolha inteligente + correções baratas | ✅ | **Aceita** (2026-10-29): Valkyrie validado na TV; golden set substituído por análise sob demanda (uso pessoal) |

| 3 — Proxy de streams | ✅ | **Aceita** (2026-10-29): listas idênticas, ffprobe sob demanda, indexadores desinstalados do Stremio |
| 4 — Motor de sincronização automática | ✅ | — (tempo/memória só valem medidos na box) |
| 5 — Robustez, fontes extras e publicação | ✅ | — |
