# Descobertas

Respostas às perguntas em aberto do plano, com evidência (as ainda abertas também em [PROXIMOS-PASSOS.md](PROXIMOS-PASSOS.md)). Desde 2026-10-31 os testes são no APK (box Xiaomi TV Box S, Wi-Fi, EXO; celular). Cada item diz onde foi observado: **box** (Chromecast, EXO) ou **desktop** (Stremio Desktop — aproximação, a confirmar na TV).

| # | Pergunta | Status |
|---|---|---|
| 1 | Código de idioma do Stremio para "Português (Brasil)" | ✅ `pob` — o Stremio seleciona sozinho a faixa `pob` do RightSubs |
| 2 | EXO e MPV exibem a faixa externa do addon? | ✅ EXO: sim, selecionada sozinha. MPV: funciona (relato do usuário); o EXO segue como player |
| 3 | Stremio prefere faixa embutida ou de addon no mesmo idioma? | 🟡 Idioma preferido vence: PT-BR do addon escolhida com EN/ITA embutidas. Embutida **PT-BR** × addon: observar quando ocorrer (2026-11-04: com PT-BR embutida o RightSubs deixou de oferecer a faixa, só avisa; o Stremio mostrou a faixa do arquivo e não escolheu o aviso). **Addon × addon (OpenSubtitles instalado junto):** a faixa do RightSubs **não** veio selecionada sozinha no desktop; precisou escolher no menu (ver "Modo complemento") |
| 4 | Quanto tempo o player espera pelo `.srt`? | 🟡 Pede ~1 s após a resposta; 0,95 s de preparo funcionou. Limite ainda desconhecido |
| 5 | Stremio envia `videoHash` para streams HTTP do Real-Debrid? | ✅ Sim, num segundo pedido (ver abaixo) |
| 6 | IDs do addon v3 casam com os da API OpenSubtitles? | ✅ Sim (`id` do v3 = `legacy_subtitle_id` da API), mas o v3 só devolve uma parte das legendas |
| 7 | Formato real da resposta do addon v3 | ✅ Ver abaixo |

## Casos de teste reais (gabaritos)

Títulos já tocados e medidos, um por situação que o RightSubs precisa resolver. Ao mexer em sincronização ou ranking, repetir os que cobrem o trecho alterado e comparar com a coluna "Esperado". Medições do usuário são "fala no áudio × legenda na tela".

| Título / arquivo | Situação | Esperado | Onde | Detalhes |
|---|---|---|---|---|
| Valkyrie (2008) `…UpScaled 2160p … Licdom.mkv` | Legenda de outro release com início ~25 s mais longo; existe legenda **exata** (EN) no OpenSubtitles | `synced` texto×texto, **+25,5 s**, conf. ~0,93 | box, EXO (proxy) | [abaixo](#valkyrie-licdom-dessincronia-medida--deslocamento-fixo-de-255-s) |
| Halloween (1978) QTZ BluRay 2160p | Sem legenda exata; SRT fre/eng **embutidas** | `already_synced` pela embutida, −0,1 s, conf. 0,96 (a YTS já batia) | box (proxy) | `CLAUDE.md`, fase 4 |
| Halloween (1978) `(2160p BluRay x265 10bit HDR Tigole).mkv` | Release diferente, **mesma origem e resolução** da legenda (YTS BluRay 2160p) | `likely_synced`, sem ler o vídeo | Windows (RD) | [modo complemento](#modo-complemento-windows-real-debrid-2026-10-31) |
| Drive (2011) `…OpenMatte.DV.HDR10+Ai-Upscaled…RIFE.4.18v2-60fps-DirtyHippie.mkv` | Sem legenda exata; legenda BluRay REMUX **~13 s atrasada** (fala 1:13, legenda 1:26); vídeo **interpolado a 59,94 fps**; diálogo denso | `synced` pela embutida eng, **−12,82 s**; nunca reescalar por fps | Windows (RD) | [modo complemento](#modo-complemento-windows-real-debrid-2026-10-31); tempos em `test/fixtures/drive-2011-timings.json` |
| The White Ribbon (2009) `1080p BluRay x264-OFT.mkv` | Release diferente, mesma origem e resolução (VXT BluRay 1080p); 1º pedido antes de o link existir no RD | `likely_synced`; RD acha no 2º pedido | Windows (RD) | [modo complemento](#modo-complemento-windows-real-debrid-2026-10-31) |
| The Invite (2026) `REMUX.mkv` | Título inédito na conta RD (medir quando o link aparece) | link em `/downloads` no 2º pedido (5,5 s) | Windows (RD) | `PLANO-COMPLEMENTO.md`, etapa B |
| Death Note ep. 1 `[Nep_Blanc]` (Kitsu) | Catálogo Anime Kitsu, numeração absoluta, ASS embutido | faixa do RightSubs selecionada, `no_reference` mas sincronizada | box, EXO | [abaixo](#anime-pelo-catálogo-anime-kitsu) |
| Matlock ETHEL WEB 1080p | WEB com SRT eng SDH embutida | `likely_synced` (mesma origem e resolução) | box | `CLAUDE.md`, fase 4 |
| Enter the Void (2009) `DC.1080p.BluRay.DDP5.1.x265.10bit-GalaxyRG265.mkv` | **25 fps** (DC); PT-BR Release-Lounge feita para **23,976** (o site diz 25); embutida só PGS | `synced` contra EN `DC…x265-RBG`: **×0,95904, +0,44 s**, conf. 0,86 | box (APK) | [abaixo](#enter-the-void-2009-dc-25-fps-apk-na-box-2026-11-01) |
| Enter the Void (2009) `DC.1080p.BluRay.H264.AAC-RARBG.mp4` | Mesmo corte a 25 fps; a EN da **versão de cinema** (`…1080p.BluRay.H264.AAC-RARBG`, sem "DC") passava por exata | `synced` contra outro DC (`same_edit`), **×0,95904**, ~+0,5 s; **nunca** ×0,999 | box (APK) | [abaixo](#enter-the-void-2009-dc-25-fps-apk-na-box-2026-11-01) |
| Valkyrie (2008) YIFY, torrent **sem Real-Debrid** | Arquivo achado pelo servidor local do Stremio (`source: stremio`); legenda feita para o arquivo | exata pelo hash, sem ler o vídeo | box (APK) | [abaixo](#torrent-sem-real-debrid-pelo-servidor-local-do-stremio-box-apk-2026-11-01) |
| Ted Lasso S04E04 2160p ATVP WEB-DL BiOMA, torrent | Sem RD; 19 SRT embutidas (3 PT-BR) | ffprobe 5,6 s; embutida **não** lida (P2P); o player usou a PT-BR embutida | box (APK) | [abaixo](#torrent-sem-real-debrid-pelo-servidor-local-do-stremio-box-apk-2026-11-01) |
| Generation Z (2024) S01E01 `MULTI 1080p WEB H264-HiggsBoson.mkv` | Sem PT; 4 EN + ES + ES-LA feitas para **outro corte** (degraus +11 / +6,5 / −2,8 s), 1 DE com **+6,0 s fixo** (e `<font color>` em cada fala); embutida só FR (3,2 GB, RD) | tradução da **DE** (`translated`, `sourceSync: synced`, +6,0 s), EN/ES `inconsistent`; sem erro de 10 s (provisória em 3 s) | box (APK) | [abaixo](#generation-z-2024-s01e01-multi-higgsboson-tradução-pelo-deepl-2026-11-03) |
| Creature Commandos S01E03 `Cheers to the Tin Man.mkv` (`tt26545355:1:3`) | Já tem 4 PT-BR; **teste forçado** (`forceFrom: [en]`) para ver a tradução a partir do inglês; embutida EN [SDH] | 3 EN distintas, todas `already_synced` (conf. 0,85 / 1,00 / 1,00); escolhida a de 1,00; 430 falas, 11 615 caracteres | PC (addon local) | [`TRADUCAO-DEEPL.md`](TRADUCAO-DEEPL.md#teste-forçado-translationdeeplforcefrom) |
| Cat's Eyes (2024) S01E01 `2160p.FRE.ITA.H265-TheBlackKing.mkv` | Série pesada (7,2 GB, 2160p H.265); sem PT **nem EN** (só FR, DE, PL); embutidas ITA/ENG/FRE-SDH | conferência com a embutida ENG em 38 s; DE −3,76 s (conf. 0,91) escolhida; FR −11,08 s e PL +0,96 s também aceitas | box (APK) | [`TRADUCAO-DEEPL.md`](TRADUCAO-DEEPL.md#casos-reais-da-box-2026-11-03) |
| A Murder Between Friends (2026) `WEB H264-RGB.mp4` | Filme MP4 1,7 GB, **sem faixa embutida**; só 2 EN (AMZN WEB-DL 1080p, por IMDb); fps 23,976 igual | antes: `no_reference`, 404; depois: traduzida "tempo não confirmado" (1 684 falas, 48 251 caracteres) | box → PC | [`TRADUCAO-DEEPL.md`](TRADUCAO-DEEPL.md#casos-reais-da-box-2026-11-03) |
| Narco Mennonites S01E01 `1080p.web.h264-cbfm.mkv` | Série com só 1 EN (AMZN WEB-DL) que já bate com a embutida ENG (a Forced é ignorada) | `already_synced` (60 ms, 1,00 de falas juntas), sem deslocamento; traduzida em 50 s, 2 provisórias antes | box (APK) | [`TRADUCAO-DEEPL.md`](TRADUCAO-DEEPL.md#casos-reais-da-box-2026-11-03) |
| Chef's Kiss (2026) `1080p.ROKU.WEB.h264-NoRBiT.mkv` (`tt38608731`) | Sem PT online; **faixa PT embutida** (`por`, índice 6); Real-Debrid lento no dia (probe 43 s no RGB, ffmpeg estourou 46 s) | antes: `unavailable` e a legenda provisória; depois: **só o aviso** de faixa embutida (sem busca nem leitura do vídeo) | box (APK) | `CLAUDE.md` do addon, item 0 |
| Chef's Kiss (2026) `1080p WEB H264-RGB.mkv` | Sem PT online nem embutida; só EN/ES online; a legenda traduzida pelo DeepL veio com `♪` corrompido (`â™ª`, 10 vezes) herdado da fonte em inglês | a limpeza remove as 10 (100 561 → 98 830 caracteres); o resto dos acentos fica intacto | box (APK) | `src/subtitles/clean.ts` |
| Creature Commandos S01E03 `Cheers to the Tin Man.mkv` (`tt26545355:1:3`) | Episódio de 259 MB com muitas faixas SRT embutidas, **entre elas PT-BR** | aviso de faixa embutida nos dois pedidos do Stremio, probe em 0,4 s, nada buscado. Antes (15:42) a rede da box caiu (`fetch failed`): sem arquivo localizado não há sondagem, e o fluxo normal também falhou | box (APK) | `CLAUDE.md` do addon, item 0 |
| Enter the Void (2010) `Extended (1080p BluRay x265 r00t).mkv` | Mesmo corte do DC a **24 fps**, chamado "Extended"; só PGS; PT-BR declara 24 mas é 23,976 | **Limitação conhecida:** `no_reference` (esperado ×0,999, ~+0,5 s; ~+9 s no fim). Caso para a sincronização pelo áudio | celular (APK) | [abaixo](#limitação-conhecida-r00t-extended-celular-vlc-2026-11-01) |

## 5. `videoHash` em streams do Real-Debrid — ✅ sim, em dois pedidos

**Onde:** box, EXO, 2026-10-29. Filme via indexador + Real-Debrid.

O Stremio faz **dois** pedidos `/subtitles` para o mesmo play:

```
09:00:54.040 subtitles.request {"type":"movie","id":"tt0985699","filename":"Valkyrie (2008) [1080p BluRay x265 10bit MULTILANG MULTISUB] - GEGE.mkv"}
09:00:56.278 subtitles.request {"type":"movie","id":"tt0985699","videoHash":"e3af0d1b729cc9fe","videoSize":10978737004,"filename":"Valkyrie (2008) [1080p BluRay x265 10bit MULTILANG MULTISUB] - GEGE.mkv"}
```

Mesmo padrão num episódio (09:01:57.950 → 09:02:00.902):

```
subtitles.request {"type":"series","id":"tt26591147:2:12","imdbId":"tt26591147","season":2,"episode":12,"filename":"Matlock.2024.S02E12.1080p.x265-ELiTE.mkv"}
subtitles.request {"type":"series","id":"tt26591147:2:12","imdbId":"tt26591147","season":2,"episode":12,"videoHash":"a4421889410a40f6","videoSize":623569379,"filename":"Matlock.2024.S02E12.1080p.x265-ELiTE.mkv"}
```

- 1º pedido: imediato, só `filename`.
- 2º pedido: **2,2–3 s** depois, com `videoHash` (hash OpenSubtitles, 16 hex) e `videoSize` — calculados pelo servidor de streaming do Stremio lendo o arquivo (o atraso varia com a resposta do Real-Debrid).
- Séries: `id` no formato `imdb:temporada:episódio`, já decomposto corretamente pelo parser.
- `filename` chega completo nos dois (grupo, fonte, codec): útil para o ranking da fase 2.

**Consequências para a fase 1:**
- Responder rápido aos dois pedidos; tratar o par como **o mesmo play** (mesmo `id` + `filename`) para não preparar a legenda duas vezes.
- O hash só existe no 2º pedido: a preparação disparada pelo 1º deve poder ser refinada quando o hash chegar (match exato por hash > nome do release).
- A descobrir: qual das duas respostas o player usa (substitui a lista ou junta as duas?).

**A confirmar:** outro indexador (Sootio) e MPV — até aqui, duas amostras (filme e episódio) no EXO.

## Cota da API OpenSubtitles (conta gratuita)

**Onde:** Mac, 2026-10-29, `POST /api/v1/login` + `GET /api/v1/infos/user`.

- Login com conta gratuita: `allowed_downloads: 20`, nível "Sub leecher", `vip: false`. A cota é por **usuário** (com token JWT).
- O login **exige o nome de usuário, não o e-mail** — com e-mail volta 400 "invalid username/password". O `check-config` deve avisar se `OPENSUBTITLES_USER` contém `@`.
- `/login` tem limite próprio de **1 requisição/s** (`x-ratelimit-limit-second: 1`). Fazer login uma vez e reaproveitar o token (validade de 24 h).
- O consumer está com "Under dev" (100 downloads/dia **sem** autenticação) e "Allow anonymous downloads" marcados. "Under dev" é para o período de desenvolvimento; não contar com ele em uso normal.

## 6 e 7. Addon v3 × API

**Onde:** Mac, 2026-10-29. Mesmos títulos e hashes das amostras da pergunta 5. Busca na API com `languages=en,pt-br` + `moviehash` (busca não consome cota).

### Formato da resposta do v3 (pergunta 7)

`GET https://opensubtitles-v3.strem.io/subtitles/{type}/{id}/videoHash=…&videoSize=…&filename=….json` → `{ "subtitles": [...] }`, cada item:

```json
{"id":"13677413","url":"https://subs5.strem.io/en/download/subencoding-stremio-utf8/src-api/file/1962244852",
 "SubEncoding":"UTF-8","lang":"eng","m":"h","g":"","subtitleFileName":"Matlock.2024.S02E12.1080p.x265-ELiTE.srt",
 "movieReleaseName":"Matlock.2024.S02E12.1080p.x265-ELiTE","releaseGroup":"ELiTE","fpsMilli":23976,"season":2,"episode":12}
```

- `lang` em ISO 639-2: `pob` = português do Brasil, `por` = português, `eng` = inglês.
- `m`: tipo de match — `h` = por hash, `i` = por IMDb.
- `SubEncoding`: codificação **original** (ex.: `CP1252` em legendas antigas); a `url` (`subencoding-stremio-utf8`) já entrega convertida para **UTF-8** (`application/x-subrip; charset=utf-8`).
- `fpsMilli`: fps × 1000 (23976, 25000) — útil para a correção de fps da fase 2.
- `movieReleaseName`, `releaseGroup`, `releaseOther`: opcionais, nem sempre presentes ou bem preenchidos.
- O v3 devolve **poucos itens por idioma** (no máximo ~5) e de todos os idiomas, sem filtro.

### IDs (pergunta 6)

- O `id` do v3 **é o `legacy_subtitle_id` da API** (Matlock: 3 de 3 batem — 13677413, 13677399, 13949003).
- O número no fim da `url` do v3 **não** é o `file_id` da API e não é derivável dele: o servidor `subs5.strem.io` responde **HTTP 469** para `file_id`s da API. Só dá para baixar sem cota uma legenda que **o próprio v3 listou**.

### O v3 sozinho não basta

| Título | v3 | API |
|---|---|---|
| Valkyrie (2008), filme | 31 itens; **0 `pob`**, 3 `por`, 1 `eng` — todos de releases antigos (R5/XviD) | 50 itens: **16 pt-BR**, 34 en (nenhum com `moviehash_match`) |
| Matlock S02E12, episódio recente | 15 itens; 1 `pob`, 2 `eng` (um com `m:"h"`) | 3 itens: 1 pt-BR, 2 en (1 com `moviehash_match: true`) — **todos presentes no v3** |

- Em títulos antigos, o v3 devolve uma seleção pequena e pior: em Valkyrie, **nenhuma legenda PT-BR**, quando a API tem 16. Os itens do v3 não aparecem na primeira página da API.
- Em lançamentos recentes, os conjuntos coincidem e o download pelo v3 (sem cota) funciona.

**Consequências para a fase 1:**
- A API é a fonte principal de **busca**; o v3 complementa (e serve de fallback sem conta).
- Download: se a legenda escolhida estiver no v3 (`legacy_subtitle_id` = `id` do v3), baixar pela `url` do v3 (**sem cota**, já em UTF-8); senão, `POST /download` da API (**1 da cota de 20/dia**).
- Estimativa: lançamentos e episódios recentes saem quase sempre sem cota; filmes mais antigos gastam 1 download por título novo. Com cache de 10 dias, 20/dia cobre o uso previsto.

## 2, 3 e 4. Primeiro teste da fase 1 no EXO

**Onde:** box, EXO, 2026-10-29, com o addon OpenSubtitles v3 **ainda instalado** no Stremio.

**Matlock S02E12** (09:21 e 09:22, dois plays): o RightSubs ofereceu a faixa PT-BR nos dois pedidos, mas o player **nunca pediu** o `/sub/…srt`. Uma legenda sincronizada apareceu — quase certamente a faixa `pob` do addon v3 (a mesma legenda, única PT-BR do episódio). O usuário viu "disabled" no menu de legendas (a investigar).

**Valkyrie, arquivo `UpScaled 2160p … Licdom`** (09:25): o v3 não tinha `pob` para este filme; o player pediu a faixa do RightSubs **sozinho**:

```
09:25:14.530 subtitles.choice        {"hash":true,"candidates":{"en":35,"pt-BR":16},"language":"pt-BR"}
09:25:15.549 subtitles.track_requested
09:25:16.498 subtitles.served        {"provider":"opensubtitles-api","release":"Operação.Valquíria.2008.1080p.BluRay.5.1.x264.DUAL-BLUDV","score":19}
```

- EXO exibe e **seleciona automaticamente** a faixa externa do addon quando é a única no idioma preferido.
- Com outro addon oferecendo o mesmo idioma, o Stremio escolhe a faixa **do outro addon** (instalado antes). → Remover os demais addons de legenda do Stremio (o RightSubs já usa o v3 por baixo).
- O player pede o `.srt` ~1 s após a resposta do 2º pedido; 0,95 s de preparo (busca já em cache + download pela API) foi aceito.
- Legenda **dessincronizada**: não existe PT-BR para o release `Licdom`; a escolhida é de outro release (score 19). Existe EN do release exato (`Varkyrie.2008.UpScaled.2160p.H265.Licdom.mkv`) — referência para a sincronização texto×texto da fase 4. Entra no golden set.

## Fase 1 sem outros addons de legenda (OpenSubtitles v3 removido do Stremio)

**Onde:** box, EXO, 2026-10-29 09:32. Matlock S02E12, arquivo `Matlock.2024.S02E12.1080p.WEB.h264-ETHEL.mkv`.

```
09:32:43.965 subtitles.request (sem hash)  → subtitles.choice pt-BR
09:32:45.845 subtitles.request (com hash)  → subtitles.choice pt-BR
09:32:46.551 subtitles.track_requested
09:32:46.726 subtitles.served {"provider":"opensubtitles-v3","release":"Matlock.(2024).S02E12…AMZN.WEB-DL…Vyndros","score":75}
```

- A faixa "RightSubs" aparece no menu e é **selecionada automaticamente**; legenda sincronizada (release WEB diferente, mesma temporização).
- Confirma a pergunta 1: com o idioma de legenda do Stremio em Português (Brasil), ele escolhe a faixa `lang: "pob"`.
- Play → legenda pronta em ~2,8 s, quase todo esperando o hash do Stremio; preparo no RightSubs: 0,18 s (download pelo v3, sem cota).
- Decisão (2026-10-29): o usuário removeu o OpenSubtitles v3 do Stremio — o RightSubs é a única fonte de legendas.

## Valkyrie (Licdom): dessincronia medida — deslocamento fixo de ~25,5 s

**Onde:** box, EXO, 2026-10-29 09:36; medição no Mac.

- Arquivo `Operazione Valchiria - Varkyrie (2008) UpScaled 2160p … sub ita eng Licdom.mkv` (EN e ITA embutidas). O Stremio selecionou a faixa **PT-BR do RightSubs** (pergunta 3: o idioma preferido vence a faixa embutida em outro idioma).
- Usuário: "a legenda aparece antes do áudio".
- Medição: PT-BR servida (`BluRay … DUAL-BLUDV`) × EN do release exato (`Varkyrie.2008.UpScaled.2160p.H265.Licdom`, API `file_id` 10452316 — não está no v3, custou 1 da cota), correlação dos intervalos de fala em passos de 100 ms:

| Trecho | Deslocamento a somar na PT-BR | Falas coincidentes |
|---|---|---|
| 5–25 min | +25,7 s | 95% |
| 50–70 min | +25,5 s | 91% |
| últimos 20 min | +25,4 s | 95% |

**Conclusões:**
- **Não é fps** (o deslocamento não cresce): é um início ~25 s mais longo neste release (vinheta/logo).
- Sincronização **texto×texto** contra uma legenda do release exato (qualquer idioma, hash ou nome igual) resolve: barata (sem ffmpeg, milissegundos), confiável (91–95% de coincidência). Custo: possivelmente +1 download da cota para a referência.
- Primeiro título do golden set: `tt0985699`, arquivo Licdom, offset esperado ≈ +25,5 s.

**Validado na TV (2026-10-29):** com a sincronização texto×texto da fase 2, a PT-BR do Valkyrie/Licdom foi corrigida em +25,46 s (referência: EN `Varkyrie.2008.UpScaled.2160p.H265.Licdom`, confiança 0,93, sem correção 0,49) e o usuário confirmou: **sincronizada**.

## Anime pelo catálogo Anime Kitsu

**Onde:** box, EXO, 2026-10-29 10:51. Death Note aberto pelo catálogo Anime Kitsu, arquivo `[Nep_Blanc] Death Note 01 .mkv` (Torrentio).

- O Stremio pede legendas com o id do Kitsu (`kitsu:1376:1`), também em dois pedidos (o 2º com hash, ~2,5 s depois).
- A meta do addon Anime Kitsu mapeia cada episódio para IMDb + temporada/episódio (`tt0877057` T1E1) — inclusive séries longas com numeração absoluta.
- O addon Anime Kitsu também declara `subtitles` (redireciona para `opensubtitles-v3.strem.io`). Instalado **depois** do RightSubs, a faixa do RightSubs foi a selecionada.
- Legenda entregue: PT-BR `[Anime Time] Death Note - 001 - Rebirth` (outro release), `sync: no_reference` — sem referência do arquivo exato, mas sincronizada (confirmado pelo usuário).
- ffprobe (3,3 s): faixas embutidas `eng` em **ASS** (`English Subs`, `Signs & Songs`) — material para a fase 4, que precisaria ler ASS além de SRT.

## Modo complemento (Windows, Real-Debrid), 2026-10-31

**Onde:** desktop — Windows 11, Stremio desktop, conta de teste com **Torrentio + RD instalado direto** (sem proxy), RightSubs em `npm run dev` com `streams.realdebrid` ligado. Contexto: [PLANO-COMPLEMENTO.md](PLANO-COMPLEMENTO.md).

### Quando o arquivo aparece no Real-Debrid

- 1º pedido de legendas (sem hash, sem `videoSize`): o link **ainda não existe** em `/downloads`.
- 2º pedido (com hash, 3,5 a 5,5 s depois no desktop): o link **já está** em `/downloads`, por nome e tamanho. É nesse pedido que o RightSubs prepara a legenda, então dá tempo de ler o vídeo.
- Os horários do RD (`generated`, `added`) vêm uma hora à frente (hora da França marcada como UTC).

### Drive (2011) OpenMatte 60 fps: dois defeitos achados

1. **Sem a URL (modo leve):** `no_reference`, legenda do FraMeSToR (BluRay REMUX) ~13 s atrasada, medida pelo usuário.
2. **Com a URL, antes da correção:** RD achou o arquivo (132 ms), ffprobe leu 59,94 fps, embutida eng lida (44 falas, 3 janelas de 45 s), offset **−12,82 s** — mas entregue sem ajuste (`already_synced`): sobreposição de fala 0,85 sem ajuste × 0,93 com, ganho < 0,1. Nos trechos de diálogo denso qualquer deslocamento sobrepõe fala.
3. **Correção:** medir também as falas que **começam juntas** (±0,5 s): 32% sem ajuste × 77% com −12,82 s (deslocamentos errados: 25–36%). Ganho ≥ 0,25 nessa medida aplica a correção.
4. **Risco evitado:** sem referência, o RightSubs reescalaria a legenda por 23,976 ÷ 59,94 = 0,4. Interpolação mantém a duração; agora só reescala até 5% (aceleração PAL).
5. **Resultado:** `synced`, embutida eng, −12,82 s. Usuário: **perfeita**.

### Drive (2011) OpenMatte 60 fps no APK (Xiaomi box, Wi-Fi), 2026-10-31

- **Sintoma:** `no_reference`, legenda ~13 s atrasada. RD achou o arquivo (1,4 s), ffprobe leu as 3 embutidas eng (1,5 s), mas a extração estourou o prazo nas 5 tentativas: `ffmpeg sem resposta em 15000 ms` (falhas em 15,1 s).
- **Causa:** volume lido × banda do Real-Debrid. 23,6 GB em 100 min = 31 Mbit/s → cada trecho de 45 s tem ~175 MB. O RD entregou 113 Mbit/s no PC e 142–151 Mbit/s na box (uma vez 83); ler em paralelo **não soma banda**. O ffmpeg (7.1.1 mínimo do APK) não é a causa: no PC levou 16,5 s num trecho contra 14,0 s de um ffmpeg completo (Debian 5.1).
- **Trecho com pouca fala lê muito além do fim:** com `-ss … -i … -to`, o ffmpeg só para quando chega uma legenda depois do fim do trecho. Na box (trechos fixos, não os escolhidos pelo RightSubs): 21 falas → 11,7 s; 10 → 22,5 s; 3 → 41,1 s; 0 → 48,7 s. Os três últimos em paralelo: 86 s; em sequência: 112 s. `-t 45` na entrada (com ou sem `-copyts`) **não** fez parar: a faixa de legenda só termina ao ver uma legenda além do limite.
- **EXO esperou ≥ 34 s** pelo `.srt`, repetindo o pedido a cada ~10 s (pergunta 4, parcial).
- **Trechos menores não servem** (fixture do Drive, melhores N s de cada trecho): 45 s/44 falas → −12,82 s (certo); 20 s/25 → −8,64 s (errado); 15 s/20 → −8,72 s (errado); ≤ 12 s → nenhum resultado.
- **Correção 1:** prazo por trecho proporcional ao bitrate (`windowTimeoutMs`: ler todos os trechos a ≥ 50 Mbit/s no total, entre 15 s e 2 min). Drive: ~85 s (35 s por trecho ainda falhou). Halloween QTZ: 18 s. Os logs `embedded.extracted`/`embedded.failed` registram os trechos e o prazo.
- **Por que funcionou no PC e na Shield:** provavelmente servidor do RD mais rápido naquele momento e falas logo depois de cada trecho; sem os logs daquelas sessões, hipótese.
- **Em aberto:** quanto o EXO espera pelo `.srt` (pergunta 4). Se desistir antes, a extração termina, vai para o cache e a próxima vez sai sincronizada.
- **Validado na TV (2026-11-01), com a correção 1:** `embedded.extracted` com trechos `[1221, 3436, 4582]` s × 45 s, 44 falas, prazo 84,6 s, leitura **60,2 s** → `synced`, −12,82 s, conf. 0,93. Antes: prazo fixo de 15 s (5 falhas) e 35,3 s (2 falhas) → `no_reference`.

### Valkyrie (Licdom) revalidado no APK, 2026-11-01

- Box, APK (Node 24.22.1): mesma PT-BR BLUDV, mesma referência EN Licdom → `synced` **+25,46 s**, conf. 0,93 (0,49 sem ajuste), igual ao gabarito. Legenda pronta 2,4 s após o pedido (inclui baixar a referência: 1 da cota).
- Mesma PT-BR no `Valkyrie.2008.1080p.REMUX…-BEN.THE.MEN.mkv` (só PGS embutidas): `likely_synced` (BluRay 1080p × REMUX 1080p), sem ajuste — coerente com o atraso ser do upscale Licdom, não da legenda. Usuário ainda não confirmou na tela.

### Enter the Void (2009) DC 25 fps, APK na box, 2026-11-01

- O Director's Cut em BluRay é **25 fps** (9278 s; o r00t "Extended" é o mesmo corte a 24 fps, 9661 s). Embutidas: só PGS ou nenhuma.
- A PT-BR escolhida (`Enter.the.Void.2010.BRRip.[A.Release-Lounge.H264]`, v3) **declara 25 fps no OpenSubtitles, mas foi feita para 23,976**: alinhada a duas referências DC independentes deu ×0,95904 (= 23,976 ÷ 25) — GalaxyRG265 contra `DC…x265-RBG`: +0,44 s, conf. 0,86; `DC…x265-RARBG` contra a própria EN: +0,58 s, conf. 0,87. **O fps declarado não é confiável**: sem referência, a correção só por fps não a corrigiria (diria 25 = 25).
- **Defeito achado** no `DC.1080p.BluRay.H264.AAC-RARBG.mp4`: a EN `Enter.The.Void.2009.1080p.BluRay.H264.AAC-RARBG` (versão de cinema, 23,98) tem todas as palavras do nome do arquivo menos "DC" e passava por exata. Como ela e a PT-BR estão no mesmo ritmo, o alinhamento deu ×0,999, +0,42 s, conf. 0,91 (0,70 sem ajuste) → `synced`, e a legenda escorregava ~2,5 s por minuto. Usuário: fora de sincronia.
- **Correção:** a edição (DC/Director's Cut, Extended, Uncut, Unrated, Theatrical, IMAX) entra no `isExact` e no `likely_synced`; e, sem exata nem embutida, um release da mesma edição, origem e resolução serve de referência (`referenceMatch: same_edit`). Teste com este caso em `test/service.test.ts`. **Validado na box** (16:23): referência `DC…x265-RARBG` (`same_edit`), ×0,95904, +0,58 s, conf. 0,87.

#### Limitação conhecida: r00t "Extended" (celular, VLC, 2026-11-01)

- Arquivo `Enter the Void (2010) Extended (1080p BluRay x265 r00t).mkv`: **24 fps**, 9661 s, só PGS embutidas. PT-BR escolhida `Enter.The.Void.LIMITED.720p.BluRay.x264-REFiNED` (v3, 61 376 bytes — o mesmo tamanho da Release-Lounge: provavelmente o mesmo arquivo com outro nome), **declara 24 fps** → `no_reference`, entregue sem ajuste. Usuário: fora de sincronia.
- Nenhuma etapa se aplica: (1) sem legenda do r00t; (2) 720p × 1080p; (3) só PGS; (4) o arquivo diz "Extended" e as legendas BluRay 1080p dizem "DC" — **mesmo corte com outro nome**, que o RightSubs não tem como saber; (5) fps declarado 24 = vídeo 24, mas a legenda é de 23,976 (**segundo fps declarado errado** neste título).
- Esperado pelas medições no DC (9661 s a 24 fps ≈ 9278 s a 25 fps): ×0,999, ~+0,5 s. Sem isso, estimado: −0,5 s no início, ~+3 s em 1 h, ~+9 s no fim. Sintoma exato na tela não registrado.
- **Decisão (2026-11-01):** não corrigir agora. Tratar "Extended" = "DC" reabriria o defeito do RARBG em outros filmes; usar a referência DC a 25 fps compensando o fps supõe o mesmo corte. Primeiro caso real para a **sincronização pelo áudio** (fase 4, adiada).

### Idioma de referência separado dos idiomas assistidos (box, APK), 2026-11-01

- O APK passou a deixar escolher os idiomas; padrão pt-BR + **pt-PT**. Na box, o Enter the Void `DC…H264.AAC-RARBG` voltou a sair `no_reference` (antes `same_edit`, ×0,95904): a busca só pedia os dois idiomas assistidos (`candidates: {pt-BR: 13, pt-PT: 9}`, antes `{en: 31, pt-BR: 13}`), e a referência DC era **inglesa**. A secundária `en` fazia, sem ninguém notar, o papel de idioma das referências. O Drive seguiu certo (a referência é a embutida).
- **Correção:** `sync.referenceLanguages` (padrão `[en]`): entram na mesma busca, nunca são entregues, e a faixa embutida nesses idiomas é a preferida (Halloween QTZ passa a ler a ENG Full em vez da FR Full; mesmo tempo, mesmo arquivo). No APK, uma terceira lista "Referência para sincronizar". **Validado na box** (18:42): Enter the Void RARBG `synced` ×0,95904, +0,58 s (`candidates: {en: 31, pt-BR: 13, pt-PT: 9}`, entregue pt-BR); Drive `synced` −12,82 s pela embutida.
- **Limitação conhecida — quando o secundário entra:** só quando a busca não acha **nenhuma** legenda no principal (`chooseLanguage`, antes de baixar). Com PT-BR existente mas fora de sincronia (`no_reference`/`low_confidence`) ou sem download possível (cota, não-SRT), **não** troca para PT-PT: entrega a melhor PT-BR ou fica sem legenda. `useSecondaryWhen: low_confidence` é aceito na config mas não aplicado. Decisão em aberto do usuário (detalhes em `CONFIGURACAO.md`, `languages`).

### Torrent sem Real-Debrid pelo servidor local do Stremio (box, APK), 2026-11-01

- **Objetivo:** atender amigos sem RD. Sem link, o RightSubs fica no modo leve (sem fps real nem embutida).
- O Stremio da box roda um servidor de streaming em `127.0.0.1:11470` (`/heartbeat`, `/settings`, `/stats.json`). Com um torrent tocando (Ted Lasso S04E04 2160p ATVP WEB-DL BiOMA, 8,5 GB, P2P), `/stats.json` lista o torrent com `infoHash` e `files[]` (`name`, `length`): **nome e tamanho idênticos** ao `filename`/`videoSize` do pedido de legendas. Arquivo servido em `/{infoHash}/{índice}`.
- **ffprobe** pelo servidor local (ffprobe do APK): **5,6 s** (RD: ~1,5–2 s) → 23,976 fps, 2633 s, 19 SRT embutidas (inclusive 3 PT-BR).
- **Embutida: inviável.** Um trecho de 45 s no meio do episódio **não terminou em 5 min** (morto à mão): o torrent baixava a ~15 Mbit/s, abaixo dos ~26 Mbit/s do vídeo, e o ffmpeg puxou ~540 MB a partir do ponto (trecho com pouca fala, como no Drive). O torrent passou a baixar o meio do arquivo em paralelo à reprodução.
- O player **não pediu** a faixa do RightSubs: usou a PT-BR embutida (pergunta 3: embutida PT-BR × addon → embutida, ao menos aqui).
- **Implementado:** fonte `stremio` (`src/streams/stremio.ts`), depois do RD; arquivos dela levam `peerToPeer: true` → ffprobe com prazo de 15 s, referência embutida desligada. O APK liga a fonte sempre. Ganho: fps real no ranking e na correção por fps para quem não tem RD.
- **Validado na box:** Valkyrie YIFY por torrent → `source: stremio`, legenda exata pelo hash.

### Link do Real-Debrid no lugar do nome do arquivo (box, APK), 2026-11-01

- **Sintoma:** em alguns pedidos de legendas o Stremio manda no `filename` o **link do RD** (cru ou codificado, `https%3A%2F%2F…download.real-debrid.com%2Fd%2F…`) ou um id como `realdebrid:ID:1`. O link ia parar no log (ele dá acesso ao arquivo) e o nome não servia para o ranking.
- **Correção:** `normalizeFilename` (`src/stremio/request.ts`) decodifica e usa só o último trecho do caminho (o nome do arquivo); ids `provedor:ID[:n]` viram "sem nome". No APK, o `Redactor` também mascara links `…real-debrid.com/d/…` em qualquer linha do log (defesa extra). Testes em `test/request.test.ts`.

### Generation Z (2024) S01E01 MULTI HiggsBoson: tradução pelo DeepL, 2026-11-03

Caso que originou a tradução pelo DeepL. O desenho final, as constantes e o porquê de cada uma estão em [TRADUCAO-DEEPL.md](TRADUCAO-DEEPL.md); aqui ficam as medições e a ordem em que os defeitos apareceram.

- **Arquivo:** `Generation Z 2024 S01E01 MULTI 1080p WEB H264-HiggsBoson[EZTVx.to].mkv`, 3,18 GB, 25 fps, 46 min 56 s, RD; embutida só **FR** (index 3 normal, 4 SDH). OpenSubtitles (`tt29540551:1:1`): nenhuma legenda em PT; v3 lista DE 1, EN 4, ES 1, ES-LA 1 (a API achou as mesmas EN).
- **Medição** (faixa FR inteira extraída no PC, 238 s; alinhamento por trechos de 4 min):

| Trecho | EN / ES (6 cópias, 721 falas) | DE (641 falas) |
|---|---|---|
| 0–14 min | **+11 s** | +6,0 s |
| 16–26 min | **+6,5 s** | +6,0 s |
| 28–38 min | **−2,8 s** | +6,0 s |
| 40–46 min | −4,1 s e −6,6 s | ≈ +6 s |

  A EN/ES vem de **outro corte** (comerciais/abertura): sai em **degraus**, escala ~1,0 em cada um. Global: EN −2,76 s conf. 0,80 (errado fora do terço final); DE +6,000 s conf. 0,97, escala 1,0 (97% das falas FR têm fala DE a ≤ 2 s, mediana 0,3 s).
- **Por que 721 × 641 falas:** é a segmentação de quem fez cada legenda, não falta de conteúdo. A EN tem mais falas curtas (117 com < 1,5 s contra 75 na DE) e 13 falas de letra de música (♪); a faixa FR embutida tem 677 (255 curtas). O número de falas não mede qualidade nem sincronia.

**Defeitos, na ordem em que apareceram (cada um virou regra ou teste):**

1. **`likely_synced` traduzido sem conferir** (1º teste na box): a EN `Generation Z S01E01 1080p WEB-DL H264 BONE - NH` parecia o arquivo (WEB, 1080p, H264) e foi traduzida **adiantada**. → `likely_synced` deixou de bastar para traduzir; toda candidata é conferida contra a embutida.
2. **3 trechos não separam:** a EN em degraus **passava** no alinhamento conjunto (+13,6 s, conf. 0,98 = a da DE); a sobreposição de fala quase não discrimina em diálogo denso (linha de base 0,96). O melhor deslocamento de **cada** trecho também não serve (ruidoso: até a DE oscila entre 4 e 6 s). → 6 trechos e comparação da **1ª × 2ª metade** (`checkConsistency`): DE desvio 0,0–0,2 s; EN/ES 2,5 s a 137 s.
3. **A DE certa foi escolhida, mas servida sem o +6 s** (2º teste na box): `#judge` a chamou `already_synced` (sobreposição de linha de base 0,89; ganho de falas juntas 0,2487, um fio abaixo de 0,25). → com as metades concordando, a correção real é aplicada (`agreedShiftIsReal`).
4. **A EN em degraus passando por sorte** (variando a posição dos 6 trechos, 10 posições): numa delas ficou `already_synced` (conf. 0,96, desvio 1000 ms) e **empatou** com a DE (0,97); o desempate pelo inglês a escolhia. → desvio ≤ 0,75 s, ≥ 0,40 de falas juntas por metade, ≥ 0,45 no conjunto, resíduo em ±15 s. Nas 10 posições, a DE entra com +6,0 s e a EN/ES é recusada.
5. **Cor errada** (box): a legenda ficava branca, sem o amarelo com borda preta do Stremio, porque a DE tem `<font color="#FFFFFF">` em cada fala (2006 tags; a EN, nenhuma) e o player obedece à cor do arquivo. → `<font>` removido antes de traduzir (e fora da cota: 49 693 → 21 505 caracteres).
6. **Erro de 10000 ms e vídeo que não abre** (box, Android TV): a 1ª leitura dos 6 trechos levou 27 s (uma vez 48,7 s, com o player bufferizando o arquivo) e o Stremio desiste em 10 s. Provisória após 8 s: **não bastou** (resposta 12,8 s depois do 1º pedido). Após 3 s: **funcionou** (5,9 s depois do 1º pedido, `delivered: true`). Tabela e hipótese em TRADUCAO-DEEPL.md.
7. **Aviso de IA só aos 0,5 s passava em branco** porque a legenda chegava ~40 s depois do play. → repete aos 60 s e a cada 15 min.

**Resultado final na box** (13:38, APK `-WorkingTree -Prefill -DebugLog`): `.srt` pedido 13:38:34,2 → provisória 13:38:37,2 (`delivered: true`, o vídeo abriu); leitura dos trechos 20 s; EN `inconsistent` (desvio 3501 ms), DE `synced` (+6,0 s, conf. 0,97, desvio 80 ms); `translation.done` 13:38:57,6 (641 falas, 21 505 caracteres); a reabertura aos 13:38:57,1 esperou 0,55 s a tradução em andamento e recebeu a real. Usuário: "funcionou perfeitamente" (tempo certo, cor certa, aviso).

### Convivência com addons da OpenSubtitles (etapa E)

- **Onde:** desktop (Windows, Stremio desktop), 2026-10-31, com addon(s) da OpenSubtitles instalados junto com o RightSubs.
- **Resultado:** a legenda do RightSubs funcionou, mas **não foi a selecionada automaticamente**: o usuário abriu as legendas em português e escolheu a faixa do RightSubs à mão. "Foi tranquilo."
- **No APK (box e celular, 2026-10-31 a 11-01):** todos os testes foram feitos **com os addons de legenda instalados**, sem problema; desinstalá-los não é necessário (o README não pede).
- **Conclusão (desktop):** com outros addons de legenda no mesmo idioma, o RightSubs não venceu a escolha automática. Para dar play sem escolher nada, deixar só o RightSubs; quem aceita escolher a faixa pode manter os outros.
- **Não registrado:** quais addons exatamente e em que ordem foram instalados; se o EXO da TV se comporta igual.

### Halloween (1978) Tigole e The White Ribbon (2009) OFT

- Halloween Tigole BluRay 2160p: RD achou, 24 fps, legenda YTS BluRay 2160p → `likely_synced`. Usuário: certa.
- The White Ribbon OFT BluRay 1080p: 1º pedido não achou, 2º achou 3,6 s depois, 23,976 fps, legenda VXT BluRay 1080p → `likely_synced`. Usuário: certa. Reforça a regra conservadora de não ler o vídeo quando origem e resolução batem.

