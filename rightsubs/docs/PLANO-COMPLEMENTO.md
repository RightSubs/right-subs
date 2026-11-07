# Plano de implementação — RightSubs como complemento (sem proxy)

> **Histórico.** Escrito para a instalação antiga (Termux, deploy pelo computador). Hoje o addon roda dentro do APK (`README.md` da raiz); scripts e guias citados aqui foram removidos em 2026-11-01.

> Início: 2026-10-31. Contexto e decisões: [COMPLEMENTO-SEM-PROXY.md](COMPLEMENTO-SEM-PROXY.md). Este arquivo é o roteiro de execução e o registro do que foi feito; o outro guarda o porquê.

**Objetivo:** o RightSubs funcionar como addon de legendas comum, com Torrentio/Sootio instalados direto no Stremio, sem perder fps real nem referência embutida quando houver como achar a URL do arquivo. O cenário com proxy (TV dedicada) continua igual.

## Situação (2026-10-31)

| Etapa | O quê | Estado |
|---|---|---|
| A | Cadeia de localização (`FileLocator`) | **Feita** |
| B | Experimento `/downloads` + `/torrents` do RD | **Feita; hipótese confirmada; código removido** |
| C | Fonte `realdebrid` + `streams.realdebrid` | **Aceita** (Drive, Halloween, The White Ribbon) |
| — | Correções achadas no caminho (fps interpolado, diálogo denso) | **Feitas e validadas** |
| D | Documentação do modo complemento | Pendente |
| E | Coexistência com OpenSubtitles v3 | **Feita no desktop:** funciona, mas a faixa do RightSubs não vem selecionada sozinha (escolha manual). Falta na TV |
| F | Servidor local do Stremio (torrent direto) | Sem compromisso |
| G | Modo leve hospedável | Decidir depois de E e F |

Testes: 124 → **140** (`npm test`), typecheck limpo. Validação feita no **Windows** (Stremio desktop), não na box: a box deste usuário ainda não foi instalada.

---

## 0. Ambiente de teste no Windows (antes de instalar na box)

Roteiro seguido em 2026-10-31. Versão para uso geral (testar no PC e instalar/atualizar a box pelo Windows): `WINDOWS.md` (removido). Casos de teste reais: [DESCOBERTAS.md](DESCOBERTAS.md#casos-de-teste-reais-gabaritos).

1. Ferramentas: `winget install OpenJS.NodeJS.LTS` e `winget install Gyan.FFmpeg` (ffmpeg é opcional: sem ele, só modo leve). Reabrir o VS Code para o PATH valer. Usado: Node 26.13.0, ffmpeg 9.0.2.
2. `npm install` e `npm test` (126 testes passaram no Windows sem mudança).
3. `copy config.example.yaml config.yaml` e `copy .env.example .env`; preencher no `.env` a conta **gratuita** da OpenSubtitles (nome de usuário, não e-mail).
4. `npm run dev` → conferir `http://127.0.0.1:7000/manifest.json` e `/health`. `login: "pendente"` é normal até o 1º pedido.
5. Stremio desktop numa **conta de teste** (a lista de addons é da conta: instalar `127.0.0.1` na conta da TV quebra o addon lá) → Addons → colar `http://127.0.0.1:7000/manifest.json`.
6. Torrentio instalado direto na conta de teste, **configurado com o Real-Debrid** (`torrentio.strem.fun/configure` → Debrid provider RealDebrid → API key). Indexadores do RightSubs desligados, senão os streams duplicam.
7. Log em arquivo, para o Claude ler: `npm run dev | Tee-Object -FilePath "$env:USERPROFILE\.rightsubs\dev.log"` (o PowerShell grava em **UTF-16**; ler com `open(..., encoding='utf-16')`).

Observações do Windows:

- `npm run build` usava `rm -rf` e não rodava no cmd do npm; corrigido (apaga `dist/` com o próprio Node). Deploy pelo Windows: `scripts/deploy-from-windows.ps1` (tar + scp + ssh do Windows). `.gitattributes` força LF (os `.sh` quebram no Termux com CRLF).
- O PC na rede de casa tem o mesmo IP público da TV: a restrição de IP do RD não atrapalha.
- Nunca colar no chat links de stream do Torrentio: `/resolve/realdebrid/<chave>/…` contém a chave do RD. Se acontecer, gerar outra em https://real-debrid.com/apitoken e reconfigurar o Torrentio.
- 1º teste (modo leve, sem URL): Spider-Man Brand New Day funcionou; Drive OpenMatte saiu `no_reference` (~13 s atrasada).

---

## Etapa A — Cadeia de localização do arquivo (feita)

**Por quê:** o `find` do proxy era síncrono e chamado em dois lugares independentes (`VideoInspector` e `EmbeddedReferences`). A busca no RD é assíncrona, então virou um localizador único, assíncrono e com cache, usado pelos dois.

### Desenho implementado ([src/streams/locator.ts](../src/streams/locator.ts))

```ts
export interface FileQuery { filename: string; videoSize?: number }
export interface PlayableFile { url: string; videoSize?: number; source: string }
export interface FileSource { id: string; locate(query: FileQuery): Promise<PlayableFile | undefined> }
export class FileLocator {
  constructor(options: { sources: FileSource[]; logger: Logger });
  get enabled(): boolean;   // false = modo leve
  locate(query: FileQuery): Promise<PlayableFile | undefined>;
  release(): void;          // onIdle
  status(): Record<string, unknown>;  // { sources, known, located, notLocated }
}
```

Regras:

- Fontes em ordem fixa (proxy → RD); a primeira que acha vence. Exceção numa fonte → `file.source_failed` e passa à seguinte.
- **Só acertos ficam em cache** (até 50, chave `filename|videoSize` em minúsculas, liberados em `onIdle`). Falhas não: o 1º pedido do Stremio chega antes de o link existir no RD.
- Pedidos simultâneos do mesmo arquivo compartilham uma só busca.
- Logs `file.located {filename, source, ms}` e `file.not_located {filename, tried, ms}`. Nunca a URL.
- `PlayableFile.indexer` virou `source` (o RD não é indexador); `video.probed` e `video.probe_failed` mostram `source`.

### Mudanças

| Arquivo | Mudança |
|---|---|
| `src/streams/locator.ts` | novo; `PlayableFile` mudou de `proxy.ts` para cá |
| `src/streams/proxy.ts` | `StreamProxy implements FileSource` (`id = 'proxy'`, `locate()` embrulha o `find`) |
| `src/media/inspector.ts` | `find` síncrono → `locate` assíncrono; `inspect()` virou `async` |
| `src/sync/embedded-reference.ts` | idem; `lookup` só chama `locate` depois de olhar o cache e as extrações em andamento |
| `src/server.ts` | monta `sources` a partir da config; sem fontes, não cria inspector nem embedded (modo leve explícito) |
| `src/app.ts` | `/health` ganhou `locator` (`null` no modo leve) |
| `test/locator.test.ts` | novo: modo leve, ordem, fonte com erro, acerto em cache e falha não, rajada, `release` |
| `test/probe.test.ts`, `test/embedded.test.ts`, `test/streams.test.ts` | adaptados a `locate` / `source` |

---

## Etapa B — Experimento do Real-Debrid (feita, código removido)

**Pergunta:** o link do arquivo já está no RD quando chega o 2º pedido de legendas?

### Como foi feito

- `src/streams/rd-experiment.ts` (temporário): uma `FileSource` que **nunca devolvia arquivo**, só registrava `rd.experiment` a cada consulta. Ligada por `RD_EXPERIMENT=1` + `RD_TOKEN` no `.env` (lidos em `server.ts` com `readEnvFile`).
- Consultava em paralelo `GET /rest/1.0/downloads?limit=20` e `GET /rest/1.0/torrents?limit=20` (`Authorization: Bearer`) e `/torrents/info/{id}` dos 3 torrents mais recentes (para pacotes de temporada). Registrava: nº da chamada, ms desde a 1ª, achou por nome / nome+tamanho, idade, status do torrent, **nomes** dos campos. Nunca `link`, `download` nem o token.
- Executado no Windows (Stremio desktop + Torrentio com RD), não na TV.

### Resultado

The Invite (2026), **nunca tocado antes** com essa conta:

| Pedido | Momento | Em `/downloads` (nome + tamanho)? |
|---|---|---|
| 1º (sem hash, sem `videoSize`) | 0 s | Não (3 itens) |
| 2º (com hash, `videoSize` 26.762.682.750) | 5,5 s | **Sim** (4º item) |
| 3º (escolha com hash) | 8,4 s | Sim |
| `.srt` (player) | 10,6 s | Sim |

Achados:

- O item também aparece em `/torrents` (`downloaded`, arquivo em `files` com o mesmo tamanho, 1 link), mas `/downloads` basta: já traz o link direto (`download`).
- Campos de `/downloads`: `id, filename, mimeType, filesize, link, host, host_icon, chunks, download, streamable, generated`. `/torrents`: `id, filename, hash, bytes, host, split, progress, status, added, links, ended`.
- **Horários do RD vêm uma hora à frente** (`generated`/`added` em hora da França marcada como UTC): não usar idade.
- Stremio desktop: o 2º pedido (com hash) chega ~3,5 a 5,5 s depois do 1º. É nele que o RightSubs dispara `prepare(..., { warm: true })`, então a fonte RD chega a tempo.

Decisão: seguir para a etapa C, só com `/downloads`. O experimento foi apagado (código, teste e `RD_EXPERIMENT` do `.env.example`).

---

## Etapa C — Fonte `realdebrid` (aceita)

### Implementação ([src/streams/realdebrid.ts](../src/streams/realdebrid.ts))

- `RealDebridSource implements FileSource`, `id = 'realdebrid'`.
- Uma consulta a `GET /rest/1.0/downloads?limit={lookback}` por busca. Casa por nome (sem diferenciar maiúsculas) e, quando o Stremio manda `videoSize`, por `filesize === videoSize`. Nome igual com tamanho diferente = outro release = não achou. Sem tamanho (1º pedido), o nome basta.
- Devolve `{ url: download, videoSize: filesize, source: 'realdebrid' }`.
- **Sem cache próprio** (desvio do plano): o `FileLocator` já guarda acertos e junta a rajada; guardar a lista do RD faria o 2º pedido reaproveitar uma lista sem o arquivo.
- 204 → lista vazia. 401/403 → um `realdebrid.token_rejected` com orientação em PT e a fonte para de consultar até reiniciar. Outros erros (HTTP 5xx, resposta que não é lista) → exceção, o localizador registra e passa adiante.
- Somente leitura: nunca chama `unrestrict` nem cria itens na conta.

### Configuração

[src/config/schema.ts](../src/config/schema.ts): `streams.realdebrid` opcional, `.strict()`, token obrigatório quando `enabled`.

```yaml
streams:
  indexers: [...]        # desligados no modo complemento
  realdebrid:
    enabled: true        # false no config.example.yaml
    token: ${RD_TOKEN}   # .env; token em https://real-debrid.com/apitoken
    # lookback: 20       # itens de /downloads (1–100)
    # timeoutMs: 3000
```

- `.env.example`: `RD_TOKEN=` (e foi removida a linha `SOOTIO_URL=` duplicada).
- `server.ts --check` mostra `realdebrid: habilitado|desabilitado` (sem o token).
- `server.ts`: `sources = [proxy (se houver indexadores), realdebrid (se habilitado)]`.

### Testes

- `test/realdebrid.test.ts`: acerto por nome+tamanho (resposta no formato real), nome igual com outro tamanho, sem tamanho, arquivo ausente, 204, token recusado (avisa uma vez e para), 5xx e resposta inesperada viram erro, token e links nunca no log.
- `test/config.test.ts`: token obrigatório com mensagem em PT; exemplo vem desligado.

---

## Correções achadas no caminho

### 1. Fps de vídeo interpolado (Drive 60 fps)

**Risco:** sem referência, a etapa 4 do `#sync` (`fpsOnly` em [src/subtitles/service.ts](../src/subtitles/service.ts)) reescalava a legenda por `fps declarado ÷ fps real`. Drive RIFE 60 fps com legenda 23,976 → escala 0,4: legenda encolhida para 40% do tempo. Interpolação mantém a duração; diferença de fps só muda o tempo de SRT quando o release foi acelerado (25 ÷ 23,976 = 4,3%).

**Correção:** `MAX_SPEEDUP = 0.05`: razões acima de 5% não reescalam (`no_reference` com `fps` real). Teste: "leaves the timing alone for frame-interpolated video". Na prática o ffprobe leu 59,94 fps no Drive.

### 2. Diálogo denso enganava a decisão (Drive −12,8 s)

**Sintoma (1º teste da C):** RD achou o arquivo (132 ms), embutida inglesa lida (44 falas em 3 janelas de 45 s), offset medido **−12,82 s** (gabarito do usuário: fala em 1:13, legenda em 1:26). Mas saiu `already_synced`: sobreposição sem ajuste 0,85, com ajuste 0,93, ganho 0,08 < `MIN_SYNC_GAIN` 0,1.

**Causa:** as janelas da embutida são escolhidas onde há mais fala. Com diálogo denso, quase qualquer deslocamento sobrepõe fala a fala, e a sobreposição de tempo quase não distingue o certo do errado.

**Diagnóstico** (com a legenda e a embutida do cache local):

| Deslocamento | Sobreposição | Falas que começam juntas (±0,5 s) |
|---|---|---|
| 0 | 0,85 | 32% |
| −12,82 s | 0,93 | **77%** |
| ±5 s, +20 s | — | 25–36% |

**Correção:**

- [src/sync/align.ts](../src/sync/align.ts): `Alignment` ganhou `starts` e `startsBaseline` (fração das falas da referência com uma fala da legenda começando a ±500 ms, com e sem a correção). Custo linear.
- `#judge`: a correção vale se o ganho de sobreposição for ≥ 0,1 **ou** o ganho de inícios for ≥ `MIN_STARTS_GAIN` (0,25). `already_synced` só quando nenhum dos dois ganha. `starts`/`startsBaseline` aparecem no log `subtitles.served`.
- Teste com **tempos reais** do Drive, só números, sem texto: [test/fixtures/drive-2011-timings.json](../test/fixtures/drive-2011-timings.json) (lido por `loadTimings` em `test/helpers.ts`), em `test/srt.test.ts` (alinhamento) e `test/service.test.ts` (ponta a ponta). Conferido que o teste do serviço **falha sem a regra** e passa com ela. Um teste sintético foi tentado antes e descartado: passava mesmo sem a regra.

---

## Validação (Windows, Stremio desktop, Torrentio com RD direto)

| Filme / arquivo | Localização | Resultado | Na tela |
|---|---|---|---|
| Drive (2011) OpenMatte DV RIFE 60 fps DirtyHippie | RD, 188 ms; ffprobe 59,94 fps | `synced` pela embutida eng, −12,82 s (inícios 32% → 77%) | Perfeita |
| Halloween (1978) 2160p BluRay x265 Tigole | RD; 24 fps | `likely_synced` (legenda YTS BluRay 2160p) | Certa |
| The White Ribbon (2009) 1080p BluRay x264-OFT | 1º pedido não achou; 2º achou 3,6 s depois; 23,976 fps | `likely_synced` (legenda VXT BluRay 1080p) | Certa |
| The Invite (2026) REMUX (etapa B) | experimento, sem URL | `no_reference`: legenda do v3 (YTS BluRay 1080p) entregue sem ajuste | Perfeita |

O caso "sem legenda exata e com texto embutido" (aceite da C) foi coberto pelo Drive; "release diferente com mesma origem e resolução" pelo Halloween Tigole e pelo The White Ribbon; "1º pedido antes do link existir" pelo The White Ribbon e pelo The Invite.

---

## Etapa D — Documentação do modo complemento (pendente)

- `docs/INSTALACAO-BOX.md`: seção "Modo complemento" (indexadores desligados, `streams.realdebrid` ligado, `RD_TOKEN`; Torrentio/Sootio continuam instalados; **não** ligar indexadores com os addons instalados, senão os streams duplicam).
- `docs/GUIA.md`: os dois modos lado a lado (TV dedicada com proxy × complemento); limites (o RightSubs roda num aparelho com o IP do RD; fora de casa o IP muda).
- Roteiro do Windows (seção 0 acima) como forma de testar antes de instalar na box.
- `.env.example` e `config.example.yaml`: **feito** na etapa C.

## Etapa E — Coexistência com OpenSubtitles v3 (pendente, usuário)

Independe do código. Roteiro em [COMPLEMENTO-SEM-PROXY.md](COMPLEMENTO-SEM-PROXY.md#coexistência-com-outros-addons-de-legenda-opensubtitles-v3-etc): reinstalar o v3 **depois** do RightSubs, tocar 2–3 títulos e anotar qual faixa veio selecionada. Pode ser feito no Stremio desktop. Resultado na pergunta 3 de `docs/DESCOBERTAS.md`.

## Etapa F — Servidor local do Stremio (sem compromisso)

Só investigação, sem código no addon:

1. Com um torrent direto tocando: `curl -s http://127.0.0.1:11470/stats.json` (o servidor existe e é acessível? no PC e no Termux da box).
2. Se sim: achar o arquivo por nome/tamanho sem `infoHash` e medir quanto um ffprobe atrapalha a reprodução.

Virar fonte (`id: 'stremio-server'`) só com decisão do usuário.

## Etapa G — Modo leve hospedável

Decidir depois de E e F, junto com o guia para amigos ([PROXIMOS-PASSOS.md §4](PROXIMOS-PASSOS.md#4-compartilhar-com-amigos-guia-futuro)).

---

## Regras que valem para todas as etapas

As do `CLAUDE.md`: sintaxe apagável, sem dependências novas, `node:test` para todo comportamento novo, nenhuma URL/token em log, memória com limite e liberação em `onIdle`, nada de `setInterval`, só serviços gratuitos.
