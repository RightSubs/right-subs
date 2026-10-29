# RightSubs — contexto para o Claude

Addon do Stremio que roda na box do usuário (Chromecast com Google TV 4K, via Termux) e entrega legenda **sincronizada** no idioma principal (PT-BR) ou, se não existir, no secundário (EN). Objetivo do usuário: escolher qualquer arquivo, dar play e assistir — sem escolher player, legenda ou ajustar delay.

Documento de referência: [docs/PLANO-DESENVOLVIMENTO.md](docs/PLANO-DESENVOLVIMENTO.md). Retomada: [docs/PROXIMOS-PASSOS.md](docs/PROXIMOS-PASSOS.md).

Repositório **privado** no GitHub (`origin`, branch `main`). Nunca versionar `.env`, `config.yaml` nem `CLAUDE.local.md` (dados do ambiente do usuário, como o IP da box); antes de cada commit, conferir que nenhum valor do `.env` aparece nos arquivos. Autor dos commits deste projeto: o configurado no `git config` local do repositório.

## Estado atual

- **Fase 0 aceita na box** (2026-10-29; falta só confirmar 24 h no ar). Box: Node 24.22.1, ffmpeg 9.0.2, ocioso ~50 MB. Acesso pelo Mac: `ssh -p 8022 <IP da box>` (chave, sem senha; `sshd` precisa ser iniciado no Termux após reiniciar a box); deploy: `BOX=<IP da box> sh scripts/deploy-from-mac.sh`. O IP e outros dados do ambiente deste usuário ficam em `CLAUDE.local.md` (fora do git).
- **Fase 1 aceita** (2026-10-29): no EXO a faixa do RightSubs vem selecionada sozinha; OpenSubtitles v3 removido do Stremio (RightSubs é a única fonte). Fallback EN e embutida PT-BR × addon: validar quando ocorrerem naturalmente (decisão do usuário). MPV funciona (relato do usuário); EXO segue como player.
- **Fase 2** (92 testes), tudo instalado na box:
  - Sincronização texto×texto (`src/sync/align.ts`): votação de offsets entre inícios de falas + 7 razões de fps, score = sobreposição de fala; aplica se confiança ≥ `sync.minConfidence` e ganho ≥ 0,1. Referência = candidato do arquivo exato (`isExact`: hash, ou nome de release ≥ 5 tokens contido no nome do arquivo), qualquer idioma, gratuito primeiro. Valkyrie/Licdom **validado na TV**.
  - Ranking (`src/subtitles/rank.ts`): exato > grupo (+80) > origem bluray/web/hdtv/dvd (±) > resolução; fps do vídeo inferido das legendas exatas (±30); SDH −10; gratuito ou já em cache +15. Com sincronização sem confiança, tenta o próximo candidato **gratuito**.
  - **Fase 2 aceita** (2026-10-29). Decisão do usuário: **sem golden set** (uso pessoal) — quando um título vier dessincronizado ele traz para análise (log da box + medição como no Valkyrie).
- **Fase 3** (105 testes): `streams.indexers` (Torrentio + Sootio, URLs no `.env`, habilitados no `config.yaml` do Mac e da box); `/stream` devolve as listas idênticas (verificado na box: nomes, ordem e links iguais); mapa nome do arquivo → URL (`src/streams/proxy.ts`, nunca logar URLs: têm a chave do RD); ffprobe sob demanda iniciado já no pedido de legendas (`src/media/inspector.ts`, ~1,5 s na box) → fps real no ranking + correção só de fps sem referência (`fps_corrected`). Achado: arquivos WEB costumam ter legenda **embutida em texto** (ETHEL: subrip eng SDH) — referência para a fase 4. **Fase 3 aceita** (2026-10-29): no Stremio da TV só o RightSubs está instalado (Torrentio e Sootio passam por ele); Valkyrie/Licdom tocado pela lista do proxy: streams em 0,59 s, ffprobe 1,6 s, legenda sincronizada.
- **Anime (Kitsu)** (2026-10-29, 113 testes, instalado na box): manifest aceita `kitsu` em subtitles; `src/stremio/kitsu.ts` mapeia `kitsu:{id}:{ep}` → IMDb + temporada/episódio pela meta do addon Anime Kitsu (corrige numeração absoluta). O Anime Kitsu também oferece legendas (redireciona ao OpenSubtitles v3): instalar **depois** do RightSubs. **Validado na TV** (Death Note pelo catálogo Kitsu: faixa do RightSubs, sincronizada).
- **Fase 4 — referência embutida** (2026-10-29, 124 testes, instalada na box). Caso real: Halloween (1978) QTZ, sem referência no OpenSubtitles, com SRT fre/eng embutidas. Sem exato no OpenSubtitles → `src/sync/embedded-reference.ts` lê a faixa de texto embutida (`pickTextTrack`: texto, não forçada) em 3 trechos de 45 s nas partes com mais fala (`src/sync/windows.ts`), via `ffmpeg -copyts -ss … -to …` sem `-readrate` (com ele, 24× levou 21 s por janela), cache de poucos KB. **Decisões do usuário:** (1) o player fica com a primeira legenda até o fim → **esperar a extração terminar** (sem corte por `budgetSeconds`; só entrega sem ajuste se a extração falhar); (2) **ser conservador**: não ler o vídeo quando a legenda já é provavelmente certa — `likely_synced` = mesma origem (bluray/web/hdtv/dvd) e mesma resolução do arquivo (Halloween YTS→QTZ BluRay 2160p e Matlock WEB 1080p bateram). Janelas lidas **em paralelo** (4,6 s × 12,4 s sequencial; ~2 núcleos por ffmpeg, prioridade baixa). Preparo antecipado: o 2º pedido do Stremio (com hash) dispara `prepare(..., { warm: true })`. Halloween na box: extração 12,8 s, 37 falas, `already_synced` −0,1 s, conf. 0,96; player recebeu o .srt em 11,9 s. **Falta validar na TV** se o vídeo começa normalmente e o player espera (pergunta 4). Bug corrigido no caminho: fps do ffprobe por média (23,81) → usar `r_frame_rate` e só fps padrão (`standardRate`).
- **Restante da fase 4 adiado** (decisão do usuário, 2026-10-29): sincronização por **áudio** (sem referência alguma), só com casos reais. ASS embutido (anime) já é lido: o ffmpeg converte para SRT. Teste com gabarito disponível: Valkyrie/Licdom = +25,5 s.
- **Como saber se a fase 4 é necessária:** `/health` → `subtitles.served` (contagem por status de sincronização desde o start) e `subtitles.recentUnsynced` (últimos 10 com `no_reference`/`low_confidence`/`budget_exceeded`). Zera ao reiniciar; o histórico completo está no log da box (`grep subtitles.served ~/.rightsubs/logs/rightsubs.log*`).
- Pendências, itens adiados e o que o guia para amigos precisa cobrir (multi-aparelho, contas próprias, dados pessoais ficam em `CLAUDE.local.md`, fora do git): [docs/PROXIMOS-PASSOS.md](docs/PROXIMOS-PASSOS.md).
- Como a fase 1 funciona: `/subtitles` busca em todos os provedores, oferece **uma** faixa (principal, senão secundária) com URL `/sub/{type}/{id}/{lang}/{filename base64url}.srt` — igual nos dois pedidos do Stremio (sem e com hash; o hash é lembrado em memória). O download só ocorre quando o player pede o `.srt`: cópia do v3 (sem cota, via `sameAs` = `legacy_subtitle_id`) antes da API (cota 20/dia). Código em `src/subtitles/`.

## Decisões já tomadas com o usuário (não reabrir)

| Tema | Decisão |
|---|---|
| Nome | RightSubs (`right-subs`) |
| Box | Chromecast com Google TV 4K (2 GB RAM, Android TV 14, **userland 32 bits confirmado**: `uname -m` = `armv8l`; box no cabo; IP em `CLAUDE.local.md`) |
| Player | **EXO fixo** no Stremio (usuário prioriza 4K HDR/Dolby Vision/Atmos); MPV como troca manual. O addon funciona igual nos dois. |
| Idiomas | Principal `pt-BR`, secundário `en-US` (vira `en`), configuráveis |
| Fontes | API OpenSubtitles (conta **gratuita**) para busca + addon OpenSubtitles v3 (sem conta, sem cota) para download/fallback. Provedores plugáveis via config. |
| Tradução | **Fora do escopo.** Documentada como futuro (DeepL Free). Fallback atual = idioma secundário sincronizado. |
| Serviços | **Somente gratuitos** |
| Onde roda | Na box, mesmo IP da TV (Real-Debrid restringe IPs). Nada em nuvem. |
| Recursos | **Requisito forte do usuário:** consumir só quando o Stremio usa; ocioso deve ficar no piso. Ver plano §6.1. |
| Indexadores | **Torrentio + Sootio** (ambos com RD) passam pelo proxy na fase 3; `streams.upstream` vira lista |
| Cache | 50 MB, **10 dias** desde o último uso (usuário pediu explicitamente, reassistir é raro) |

## Convenções do código

- TypeScript com **sintaxe apagável** (`erasableSyntaxOnly`): sem enums, namespaces ou parameter properties. Imports relativos com extensão `.ts`.
- Dev: `npm run dev` executa o TS direto (Node ≥ 22.18). **Na box roda `dist/` compilado** (`npm run build`), porque executar TS direto custa ~20 MB a mais de RAM. O compilador é removido após o build (`npm prune --omit=dev`).
- Dependências de runtime: só `yaml` e `zod` (v3). **Nada de módulos nativos** (Termux/ARM). Evitar dependências novas; se necessário, JS puro e pequeno.
- HTTP com `node:http` + router próprio (`src/http/router.ts`), sem Express/SDK do Stremio.
- Identificadores e comentários em **inglês**; mensagens ao usuário (erros de config, logs de orientação, docs) em **português**.
- Erros de config: validação zod com mensagens em PT (`src/config/errors.ts`), objetos `.strict()` para pegar erros de digitação, segredos via `${VAR}` do `.env`.
- Provedores: `ProviderType` em `src/providers/` registrado em `src/providers/index.ts`. Tipo `stremio-addon` = qualquer addon só por URL. Na fase 1, adicionar `create()` (implementação de `SubtitleProvider`).
- Testes: `node:test` em `test/*.test.ts` (`npm test`). Todo comportamento novo com teste.
- Logs: uma linha por evento, `<iso> <LEVEL> <evento> {json}` (`src/logger.ts`).

## Regras de recursos (valem para todo código novo)

- Qualquer tarefa pesada usa `resources.idle.beginJob()` e libera ao terminar; no máximo `resources.maxConcurrentJobs`.
- Estruturas em memória registram liberação em `resources.onIdle(...)` e têm limite de itens/validade.
- Nenhum `setInterval`/polling. Timers só armados por atividade, com `unref()`.
- ffmpeg: `-threads 1`, timeout, matar o processo filho ao abortar/parar; áudio por HTTP range em **pipe**, sem arquivo temporário; vídeo nunca gravado em disco.
- Temporários só em `resources.tmpDir` (esvaziado na inicialização/ocioso).
- Cache em disco: atualizar `mtime` a cada uso (o janitor apaga por `mtime`).

## Perguntas em aberto (fase 1 responde, registrar em docs/DESCOBERTAS.md)

1. Código de idioma que o Stremio associa a "Português (Brasil)" — premissa `pob` (`src/languages/languages.ts`).
2. EXO e MPV (Android TV) exibem a faixa externa do addon?
3. Stremio prefere faixa embutida ou de addon no mesmo idioma?
4. Quanto tempo o player espera pelo `.srt`?
5. Stremio envia `videoHash` para streams HTTP do Real-Debrid?
6. IDs do addon v3 casam com os da API OpenSubtitles (download sem cota)?
7. Formato real da resposta do addon v3 (campos, metadados).

## Ambiente

- No computador de desenvolvimento original, o auto mode bloqueou subir o servidor em segundo plano e acessar a internet. Se acontecer de novo, peça ao usuário para liberar (`/permissions`) em vez de contornar.
- Também foi bloqueado adicionar `sshd` ao script de boot (classificado como persistência). Não insistir; está documentado como passo manual opcional.
