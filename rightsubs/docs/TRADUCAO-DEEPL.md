# Tradução pelo DeepL — como funciona e o que foi medido

**Estado:** implementado e validado na box (Xiaomi TV Box S, Generation Z S01E01, 2026-11-03): legenda traduzida do alemão, no tempo certo e com o estilo do Stremio. 212 testes. Este é o documento de referência; a decisão resumida está no `CLAUDE.md`, os números dos casos reais em [DESCOBERTAS.md](DESCOBERTAS.md) e as opções em [CONFIGURACAO.md](CONFIGURACAO.md#translationdeepl).

## O que é e o que o usuário decidiu

O DeepL é o **último recurso**: só entra quando não existe nenhuma legenda no idioma principal (pt-BR) nem no secundário (pt-PT). Nesse caso o RightSubs gera a legenda no idioma principal a partir de uma legenda **de qualquer idioma** cujo tempo foi **confirmado** contra o vídeo.

Decisões do usuário (não reabrir sem motivo):

- A fonte pode estar em **qualquer idioma** do OpenSubtitles, não só no de referência (inglês). Sem "perfect match" (legenda feita para o arquivo exato), pega-se a melhor, sincroniza-se por amostragem com a faixa embutida e traduz-se.
- Lê-se **só uma pequena parte do vídeo** (6 trechos de 45 s), nunca o filme todo.
- **Fora de escopo:** traduzir a faixa embutida inteira (exigiria baixar o filme todo). Se nenhuma candidata for confirmada, não se entrega nada.
- Até **8** candidatas; as gratuitas (addon v3) primeiro, as da API (cota de 20 downloads/dia) só se nenhuma gratuita servir.
- Ordem quando mais de uma passa: **maior confiança**; em empate, o **inglês**, depois as demais.
- A legenda traduzida tem de **dizer** que é por IA, e o texto vem sem a cor da legenda original (vale o estilo do Stremio).

## Como funciona

`#translate` → `#translationSource` → `#checkForTranslation` em `src/subtitles/service.ts`:

1. **Busca em todos os idiomas** quando há tradutor (`LANGUAGES`; a busca não gasta cota, só o download). A faixa oferecida ao Stremio é a do idioma principal (`chooseLanguage`, log `translate: true`).
2. **Candidatas:** até 8 de **temporização distinta** (`timingFingerprint`: cópias da mesma release, em qualquer idioma ou de qualquer uploader, contam uma vez); teto de 16 downloads. Gratuitas primeiro.
3. **Conferência de cada uma** contra a faixa embutida de texto (`EmbeddedReferences.lookup` com 6 trechos; cache próprio `…|w6`): alinha (`align`: deslocamento e escala de fps), julga (`#judge`) e exige **consistência** (`src/sync/consistency.ts`): aplica a correção conjunta e alinha a 1ª e a 2ª metade dos trechos à parte, só no resíduo. Recusa legendas feitas para **outro corte** (deslocamento em degraus), que passariam no alinhamento conjunto.
4. **Se o alinhamento diz "já sincronizada" mas a correção é real** (≥ 0,5 s ou escala ≥ 0,05%, ganho de falas juntas ≥ 0,1) e as metades concordam, a correção é **aplicada** (`agreedShiftIsReal`). A regra "nunca piorar" do `#judge` é cautelosa demais em diálogo denso.
5. **Escolha:** a exata (hash/release) que confere vence na hora; senão, a de maior confiança (empate ≤ 0,02 = inglês, depois as demais).
6. Traduz com o idioma da fonte (`deeplSource`), põe o aviso de IA e guarda em cache (`translated:<idioma>:<id>|<arquivo>`, 10 dias).
7. **Sem faixa embutida para conferir** (nenhuma de texto, só PGS, torrent P2P, sync desligado): `#translationSourceUnchecked`: a exata como está (`verified:false`) ou sincronizada por outra legenda. **`likely_synced` não vale** para traduzir.
8. **Último recurso, só para FILMES** (`type: movie`; decisão do usuário em 2026-11-03): se nada acima serviu, traduz a melhor candidata cujo **fps declarado é o do arquivo** (`declaresVideoFps`; fps desconhecido de qualquer lado = não), inglês primeiro, **com o aviso "tempo não confirmado"** (`translation.unconfirmed`, `sourceSync: unconfirmed`). Um filme é um corte só, então a legenda de outra release dele costuma servir; um episódio não (anúncios, cortes: Generation Z), então séries não entram. **Só vale quando não há régua**: se a faixa embutida existe e recusou a candidata, não se traduz. O resultado vai para o mesmo cache (`translated:`).

## Limites e por que cada um

| Constante | Valor | Onde | Origem da medição |
|---|---|---|---|
| `TRANSLATION_WINDOWS` | 6 | `service.ts` | com 3 trechos (12–17 falas cada) a EN em degraus **passava** (conf. 0,98); 4–6 dão ≥ 27 falas por metade |
| `MAX_HALF_DEVIATION_MS` | 750 ms | `consistency.ts` | DE que serve: 0–120 ms; EN de outro corte: ≥ 1000 ms (3,5–13,6 s na maioria) |
| `RESIDUAL_RANGE_MS` | ±15 s | `consistency.ts` | ±2 min deixava o ruído vencer (um "desvio" de 28 s na DE) |
| `MIN_HALF_STARTS` | 0,40 | `consistency.ts` | DE: 0,49–0,62 por metade; sem correspondência: 0,2–0,35 (acaso em diálogo denso) |
| `MIN_AGREEING_STARTS` | 0,45 | `service.ts` | DE: 0,53–0,58; EN que não serve: 0,37 (= acaso) |
| `CONFIDENCE_TIE` | 0,02 | `service.ts` | empate → inglês |
| `MIN_REAL_SHIFT_MS` / `MIN_REAL_RESCALE` / `MIN_AGREED_STARTS_GAIN` | 500 ms / 0,05% / 0,1 | `service.ts` | a DE da box tinha ganho 0,2487, um fio abaixo do 0,25 normal, e foi servida 6 s fora |
| `TRANSLATION_BITS_PER_SECOND` | 25 Mbit/s | `embedded-reference.ts` | a 1ª leitura de 6 trechos estourou (48,7 s a 50 Mbit/s) com o player bufferizando o mesmo arquivo; a seguinte levou 20 s |
| `CONCURRENCY` | 4 lotes | `deepl.ts` | ~13 lotes de 50 falas por episódio: ~10 s em fila, ~4 s em paralelo |
| `translationWaitMs` | 3 s | `app.ts` | ver a próxima seção |

Todas foram escolhidas medindo em **10 posições diferentes dos trechos** sobre os dados reais (a escolha dos trechos depende da 1ª legenda examinada). Em todas, a DE entra com +6,0 s e a EN/ES é recusada.

## Primeira reprodução: o limite de 10 s do Stremio e a legenda provisória

Uma tradução ainda por fazer leva de 20 a 60 s (leitura dos trechos 20–27 s; DeepL ~4 s). O Stremio desiste de um pedido em **10 s**, e **nesta box (Android TV) o vídeo nem abre** enquanto espera. Como isso aconteceu:

| Tentativa | `.srt` pedido → resposta | Resultado |
|---|---|---|
| Sem tratamento | 13:01:54 → 13:02:26 (32 s) | erro de 10000 ms, vídeo não abriu; reabrir 21 s depois pegou o cache |
| Provisória após **8 s** | 13:23:52,76 → 13:24:00,77 | erro mesmo assim: a resposta chegou 12,8 s depois do **1º** pedido do Stremio (13:23:47,96) |
| Provisória após **3 s** | 13:38:34,20 → 13:38:37,20 (`delivered: true`), 5,9 s depois do 1º pedido (13:38:31,32) | **funcionou**: o vídeo abriu com a mensagem |

Conclusão (consistente com os três casos, **não** provada de outra forma): o relógio de 10 s conta **desde o primeiro pedido do Stremio ao addon**, e a busca com hash do 2º pedido já consome ~2,5 s. Por isso, quando há tradução pendente (`SubtitleService.translationPending`), a rota `/sub/…` espera no máximo `translationWaitMs` (3 s) e responde com uma **legenda provisória** (`placeholderSrt`, log `subtitles.placeholder`): "Saia do vídeo e abra de novo em cerca de 30 s", 25 s na tela a cada 30 s. A tradução termina em segundo plano; abrir de novo pega o cache (9 ms). Se o usuário reabrir enquanto ainda traduz, o pedido espera até 3 s e, se terminou nesse meio-tempo, recebe a real (13:38:57: 0,55 s). Custo: quem não reabrir fica com a provisória naquela sessão (o player guarda a primeira legenda que recebe). Esperar mais do que 3 s não ganha nada: uma tradução por fazer nunca termina antes de ~20 s.

Log `subtitles.track_closed` (`elapsedMs`, `delivered`) diz se o Stremio ainda estava lá quando a resposta saiu. A mesma orientação está no app em `first_time_note`.

## Aparência da legenda traduzida

- **Aviso de IA** (`src/translation/notice.ts`): "[Legenda traduzida por IA (DeepL)]" (pt-BR/pt-PT) ou "[Subtitles machine-translated by AI (DeepL)]" (com "- tempo não confirmado" / "- timing not confirmed" na tradução sem conferência), 4 s, aos 0,5 s, de novo aos 60 s e a cada 15 min, sempre num intervalo livre entre falas (encurtado, adiado até 30 s ou omitido se não houver espaço). Entra antes do cache.
- **Cor/borda do Stremio:** a DE do Generation Z tem `<font color="#FFFFFF">` em **cada** fala (2006 tags) e o player obedece à cor do arquivo, ignorando o estilo do usuário (amarelo com borda preta). `translateCues` remove `<font …>`; `<i>`/`<b>` ficam. Também reduz a cota (caracteres enviados 49 693 → 21 505). **Legendas entregues sem tradução** podem trazer `<font color>`: não foram alteradas (a decidir).
- **Entrada "RightSubs: legenda em preparo, aguarde 30 s"** na lista de legendas (`src/stremio/status.ts`, rota `/status/…`): aparece enquanto a tradução está pendente; o texto da faixa é decidido no pedido ("preparando" ou "já está pronta"). **Não foi conferida na tela**: com a provisória, o vídeo abre antes de o menu servir de algo, e o nome da faixa depende de como o Stremio exibe o campo `lang`.
- Não existe pop-up: o protocolo de addons do Stremio só aceita a lista `{id, url, lang}`.

## O que depende de como se assiste (Real-Debrid, torrent, outros)

A tradução em si (busca em todos os idiomas, DeepL, aviso de IA, cor do Stremio, legenda provisória) **não depende de debrid**. Quem depende é a **conferência do tempo**: ela lê 6 trechos da faixa embutida, e para isso o addon precisa do link direto do arquivo, que só obtém pela API do **Real-Debrid** (`/downloads`, `RealDebridSource`) ou, em torrent tocado pelo próprio Stremio, pelo servidor local dele (`StremioServerSource`, sem leitura da faixa embutida: `peerToPeer`). O modo proxy (indexadores) não é usado no APK.

| Como se assiste | O addon acha o arquivo? | Régua (faixa embutida) | O que a tradução faz |
|---|---|---|---|
| **Real-Debrid** | sim (`/downloads`) | **sim** (6 trechos) | fluxo completo: escolhe entre os idiomas, recusa legendas de outro corte, aplica o deslocamento |
| **Torrent pelo próprio Stremio, sem debrid** | sim (servidor local do Stremio, `/stats.json`) | **não**: ler trechos de um torrent roubaria banda do vídeo | só o ffprobe (fps, até 15 s). Legenda exata pelo hash: traduzida como está. **Filme:** "tempo não confirmado" se o fps bater. **Série:** nada |
| **Outro debrid** (AllDebrid, Premiumize, TorBox…) | **não**: não há `FileSource` para eles, e o Stremio não usa o servidor de torrent nesses streams | não | sem fps e sem faixa embutida: só a legenda **exata pelo hash** seria traduzida (como está) |
| Link direto ou outra fonte | não | não | o mesmo do caso acima |

**Estado do teste:** só a linha do **Real-Debrid** foi medida na box (Generation Z, Cat's Eyes, A Murder Between Friends). As outras três são a leitura do código (`FileLocator` e suas fontes; `EmbeddedReferences.lookup` devolve "indisponível" para `peerToPeer`; `declaresVideoFps` precisa do fps do ffprobe) e **não foram testadas**.

**Para suportar outro debrid:** uma `FileSource` por serviço (API de histórico/links equivalente ao `/downloads` do Real-Debrid), mais o campo do token na tela e no `ConfigWriter`. Só vale se alguém usar o serviço.

## Casos reais da box (2026-11-03)

| Arquivo | Situação | Caminho | Resultado |
|---|---|---|---|
| Generation Z S01E01 MULTI (série, 3,2 GB) | EN/ES de outro corte, DE com +6,0 s | conferência com a embutida FR | DE traduzida, +6,0 s, cor do Stremio |
| Cat's Eyes S01E01 2160p (série, 7,2 GB) | só FR, DE e PL; **nem PT nem EN**; embutidas ITA/ENG/FRE-SDH | conferência com a embutida **ENG** (3 candidatas aceitas: DE −3,76 s conf. 0,91; FR −11,08 s 0,86; PL +0,96 s 0,75) | DE traduzida; primeira prova de que "qualquer idioma" era necessário |
| A Murder Between Friends (filme MP4, 1,7 GB) | só 2 EN (AMZN WEB-DL 1080p, achadas por IMDb), **sem faixa embutida**, fps 23,976 igual | sem régua → item 8 | antes: 404 sem aviso; depois: 1 684 falas, aviso "tempo não confirmado" |
| Narco Mennonites S01E01 1080p WEB (série, 2,2 GB) | só 1 EN (AMZN WEB-DL RAWR); embutidas ENG-Forced, ENG, FRE, FRE-Forced | conferência com a embutida **ENG completa** (a Forced é ignorada): 422 falas em 6 trechos, 42 s; a EN já bate (`already_synced`, 60 ms, falas juntas 1,00, desvio 20 ms), sem deslocamento | traduzida 50 s depois do 1º pedido (947 falas, 31 389 caracteres); 2 provisórias antes, porque a 1ª reabertura veio aos 15 s |

**De onde vêm as legendas-fonte:** sempre do OpenSubtitles. No A Murder Between Friends, as 4 candidatas inglesas são as mesmas 2 legendas listadas pela API (`opensubtitles-api`, 20 downloads/dia) e pelo addon v3 (`legacy_subtitle_id` 13476158 e 13476159, baixadas pelo v3 sem gastar cota). Foram achadas pelo **IMDb** (`m: i` no v3, `moviehash_match` falso na API): nenhuma está registrada com o hash deste arquivo. O hash e a faixa embutida são as duas formas de saber que o tempo bate com **este arquivo**; sem nenhuma das duas, a conferência do tempo não é possível e entra o item 8 (só filmes).

## Cliente DeepL

`src/translation/deepl.ts`: host `api-free` se a chave termina em `:fx`; lotes de 50 (4 em paralelo, na ordem); falas repetidas enviadas uma vez; `{\an8}` e `<font>` removidos; 429 repetido uma vez; 456 = cota esgotada; 401/403 = chave recusada; a chave vai só no header. Um episódio gasta ~21 000 caracteres da cota gratuita (500 000/mês).

## Teste forçado (`translation.deepl.forceFrom`)

Só no `config.yaml` de um addon rodando no PC (não existe no app): `forceFrom: [en]` ignora o PT/secundário que já existe e traduz sempre, só dos idiomas indicados, pelo mesmo caminho. Cache à parte (`translated-forced:`); logs `translation.forced` e `choice` com `forced`. Caso medido: Creature Commandos S01E03 (`tt26545355:1:3`, 259 MB, embutida EN [SDH], 4 PT-BR existentes): 3 candidatas EN distintas (conf. 0,85 / 1,00 / 1,00), escolhida a de conf. 1,00; 430 falas, 11 615 caracteres, leitura dos trechos em 3,0 s. Para rodar: `node --env-file=.env src/server.ts --config <arquivo>` e um pedido com `videoHash`, `videoSize` e `filename` do log da box.

## App (APK)

- Campo da chave do DeepL (opcional) na tela e no formulário "Preencher pelo celular"; "Remover a chave" na tela. `SecretStore` guarda (`deepl_key`, AES-GCM/Keystore), o Node recebe só por `DEEPL_API_KEY`, o `Redactor` mascara. O `ConfigWriter` liga `translation.deepl.enabled` quando há chave.
- Builds de teste (nunca distribuir): `.\build.ps1 -WorkingTree -Prefill -DebugLog` = addon do diretório de trabalho (sem commitar), credenciais do `.env` dentro do APK (texto puro) e log legível por adb. Detalhes no `CLAUDE.md` da raiz.

## Logs

| Evento | Quando |
|---|---|
| `translation.candidate` | uma por candidata examinada: idioma, release, `status` (`synced`, `already_synced`, `inconsistent`, `unconfirmed`, `weak_agreement`, `low_confidence`), `offsetMs`, `confidence`, `starts`, `deviationMs` |
| `translation.skipped` | nenhuma candidata confirmada (`no_confirmed_source`) ou sem régua (`status`) |
| `translation.billed` | caracteres de cada lote enviado ao DeepL (nunca o texto) |
| `translation.done` / `translation.failed` | fim da tradução / erro (cota, chave, rede) sem o texto |
| `translation.unconfirmed` | filme traduzido sem conferir o tempo (idioma, release, fps, nº de candidatas com o fps do arquivo) |
| `translation.forced` | modo de teste |
| `subtitles.placeholder` / `subtitles.track_closed` | provisória enviada (`waitedMs`) / conexão fechada (`elapsedMs`, `delivered`) |
| `subtitles.status_requested` | entrada "em preparo" aberta (`pending`) |
| `subtitles.served` | `status: translated`, `sourceSync`, `from`, `offsetMs`, `characters` |

## Como foi validado (método reutilizável)

1. Extrair a faixa embutida inteira no PC (container com `apt install ffmpeg`, link direto do Real-Debrid sem imprimir) e alinhar cada candidata por trechos de 4 min: mostra se o deslocamento é constante.
2. Simular o que o addon lê: os mesmos 6 trechos (início de cada um no log `embedded.extracted`), em **várias posições**, e rodar `SubtitleService` de ponta a ponta com as legendas reais e um tradutor falso. Foi assim que apareceram as duas fragilidades (deslocamento não aplicado; EN em degraus passando por sorte).
3. Só então testar na box com o APK `-WorkingTree -Prefill -DebugLog` e ler o log.

## Limitações e pendências

- **Sem Real-Debrid a conferência do tempo não existe** (torrent do Stremio, outros debrids, link direto): tabela em "O que depende de como se assiste". Os casos sem Real-Debrid não foram testados.
- **Arquivos pesados:** 6 trechos leem o dobro de 3; o prazo por trecho tem teto de 120 s (`windowTimeoutMs`). Num arquivo como o Drive (23,6 GB) pode estourar e cair no caminho sem conferência. Não medido.
- **Limite do Stremio:** entre 5,9 s (funcionou) e 12,8 s (falhou) desde o 1º pedido; o valor exato não foi medido. `translationWaitMs` fica em 3 s e não é opção do `config.yaml`.
- **Sem faixa embutida em texto** (só PGS) ou torrent P2P: não há como confirmar o tempo; só a exata (como está) ou sincronizada por outra legenda é traduzida. **Filmes** caem no item 8 (tradução com "tempo não confirmado"); **séries** ficam sem legenda (404 em 0,2 s, sem aviso ao usuário).
- **Tempo não confirmado pode sair errado:** é o risco aceito pelo usuário para filmes. Não há checagem de duração (última fala × duração do filme), que pegaria cortes grosseiros; seria o próximo passo barato.
- **Cota:** um filme gasta bem mais que um episódio (A Murder Between Friends: 48 251 caracteres, ~10% do mês gratuito).
- **Arquivos pesados, medido:** Cat's Eyes S01E01 2160p H.265 (7,2 GB, 59,6 min): leitura dos 6 trechos em **38,2 s** (teto 120 s), 64 falas de referência, tradução pronta 45 s depois do 1º pedido. A mensagem provisória diz "cerca de 30 s": para arquivos assim é curto (o usuário recebeu a provisória duas vezes); considerar "cerca de 1 minuto".
- **Inglês em degraus:** poderia ser sincronizado por segmentos, mas exigiria a faixa embutida inteira como régua (fora de escopo).
- A entrada de status no menu não foi vista na tela; `<font color>` em legendas não traduzidas segue como veio.
