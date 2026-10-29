# Descobertas

Respostas às perguntas em aberto do plano (lista no `CLAUDE.md`), com evidência. Cada item diz onde foi observado: **box** (Chromecast, EXO) ou **desktop** (Stremio Desktop — aproximação, a confirmar na TV).

| # | Pergunta | Status |
|---|---|---|
| 1 | Código de idioma do Stremio para "Português (Brasil)" | ✅ `pob` — o Stremio seleciona sozinho a faixa `pob` do RightSubs |
| 2 | EXO e MPV exibem a faixa externa do addon? | ✅ EXO: sim, selecionada sozinha. MPV: funciona (relato do usuário); o EXO segue como player |
| 3 | Stremio prefere faixa embutida ou de addon no mesmo idioma? | 🟡 Idioma preferido vence: PT-BR do addon escolhida com EN/ITA embutidas. Embutida **PT-BR** × addon: observar quando ocorrer |
| 4 | Quanto tempo o player espera pelo `.srt`? | 🟡 Pede ~1 s após a resposta; 0,95 s de preparo funcionou. Limite ainda desconhecido |
| 5 | Stremio envia `videoHash` para streams HTTP do Real-Debrid? | ✅ Sim, num segundo pedido (ver abaixo) |
| 6 | IDs do addon v3 casam com os da API OpenSubtitles? | ✅ Sim (`id` do v3 = `legacy_subtitle_id` da API), mas o v3 só devolve uma parte das legendas |
| 7 | Formato real da resposta do addon v3 | ✅ Ver abaixo |

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
