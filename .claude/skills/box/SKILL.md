---
name: box
description: Acessa a box Android TV pela rede (adb dentro do container) para instalar o APK, ver o /health e o log do RightSubs e medir a extração de legendas na própria box. Use quando o usuário pedir para instalar na box, ler o log, verificar se o addon está rodando ou investigar um filme que saiu dessincronizado.
---

# Trabalhar na box

IP e dados da box em `CLAUDE.local.md`. Tudo passa por `scripts/adb.sh` (adb dentro do container; chave no volume `rightsubs-adb`). Exemplo: `BOX=<ip> sh scripts/adb.sh shell getprop ro.product.model`.

Se não conectar: a box reiniciou/atualizou, ou a depuração foi desligada. Peça ao usuário para ligar **Opções do desenvolvedor → Depuração USB** (e depuração pela rede, se houver) e aceitar "Sempre permitir" na TV. Ao terminar uma rodada de testes, lembre-o de desligar a depuração.

## Instalar / atualizar

```sh
BOX=<ip> sh scripts/adb.sh shell getprop ro.product.cpu.abilist     # armeabi-v7a → APK armeabi-v7a
BOX=<ip> sh scripts/adb.sh install -r /out/<apk>                     # -r mantém as credenciais
BOX=<ip> sh scripts/adb.sh shell am start -n com.rightsubs.android/.MainActivity
```

- Mesma chave de assinatura (`signing/`) = atualiza por cima. Chave diferente → `INSTALL_FAILED_UPDATE_INCOMPATIBLE` (exigiria desinstalar e perder as credenciais: pergunte antes).
- Antes da primeira instalação numa box com o RightSubs do **Termux**, ele precisa ser removido (porta 7000).
- O usuário aperta "Salvar e iniciar" na TV; não automatize a tela (ela é `FLAG_SECURE` e mostra credenciais).

## Ver se está rodando (/health)

O `forward` só vale dentro do container, então faça tudo numa chamada:

```sh
MSYS_NO_PATHCONV=1 docker run --rm -e BOX=<ip> -v rightsubs-adb:/root/.android rightsubs-apk-builder bash -c '
  adb start-server >/dev/null 2>&1; adb connect $BOX:5555 >/dev/null; sleep 2
  adb forward tcp:7000 tcp:7000 >/dev/null; curl -s http://127.0.0.1:7000/health'
```

Interesse: `tools.ffmpeg.available`, `providers[0].login`, `locator` (Real-Debrid), `subtitles.served` e `subtitles.recentUnsynced` (zera ao reiniciar).

## Ler o log

Só nos APKs `-debuglog` (`.\build.ps1 -DebugLog`: cópia do log em armazenamento acessível; o log principal é privado do app):

```sh
BOX=<ip> sh scripts/adb.sh shell "grep -v http.request /sdcard/Android/data/com.rightsubs.android/files/rightsubs.log | tail -n 60" \
  | sed -E 's#https?(:|%3A|%253A)(/|%2F|%252F){2}[^ "]*real-debrid\.com(/|%2F|%252F)d(/|%2F|%252F)[^ "]*#***#gI' | cut -c1-600
```

Sempre com esse `sed`: APKs anteriores à correção de 2026-11-01 podem ter links do RD no log, inclusive codificados (`https%3A%2F%2F…`), que um filtro só por `https://` deixa passar.

No APK normal, só pelo botão **Log** do app (o usuário lê na TV).

Linhas que importam por filme:
1. `subtitles.choice`: `candidates` por idioma (os de `referenceLanguages`, padrão `en`, entram aqui) e o idioma escolhido.
2. `file.located`: `source` = `realdebrid` ou `stremio` (torrent sem RD: sem embutida).
3. `video.probed`: faixas embutidas, fps.
4. `embedded.extracted`/`embedded.failed`: trechos, `timeoutMs` (cresce com o bitrate), `ms`.
5. `subtitles.served`: `sync.status` (`exact`, `synced`, `already_synced`, `likely_synced`, `fps_corrected`, `no_reference`, `low_confidence`, `budget_exceeded`), `offsetMs`, razão de fps e `referenceMatch` (`same_edit` = referência de outro release da mesma edição).

Tradução pelo DeepL (sem PT): `subtitles.choice` com `translate: true`; `embedded.extracted` com 6 `windows`; uma `translation.candidate` por candidata (`status`: `synced`/`already_synced` aceita; `inconsistent`/`weak_agreement`/`unconfirmed`/`low_confidence` recusa; `deviationMs`, `starts`); `translation.done` e `subtitles.served` com `status: translated`, `from`, `offsetMs`. Na primeira vez, `subtitles.placeholder` (provisória após 3 s) e `subtitles.track_closed` (`delivered: true` = o Stremio ainda estava lá). O vídeo da box só abre se o `.srt` chegar em poucos segundos do 1º pedido: ver `rightsubs/docs/TRADUCAO-DEEPL.md`.

`subtitles.track_requested` repetido a cada ~10 s = o player esperando o `.srt`. A ordem das referências e o que cada status quer dizer: `rightsubs/CLAUDE.md`; casos com gabarito para comparar: `rightsubs/docs/DESCOBERTAS.md`.

## Medir a extração na box

Peça ao usuário o **link direto** do arquivo (`https://<n>.download.real-debrid.com/d/<código>/<nome>.mkv`; a página `real-debrid.com/d/…` não serve) e use `scripts/box/extract-timing.sh` (instruções no cabeçalho). Ele mede o download direto, cada trecho com os argumentos do RightSubs e o mesmo trecho só com o áudio, e apaga tudo de `/data/local/tmp/rs` no fim. Nunca imprima o link: mascare com o mesmo `sed` da seção "Ler o log".

Regras para scripts na box: escreva num arquivo, tire o `\r` (`tr -d '\r'`) e envie com `adb push` (aspas aninhadas em `adb shell "…"` quebram); não use `pkill -f` (mata o próprio shell). Faixa e fps: rode antes `libffprobe.so -v error -show_entries stream=index,codec_type,codec_name:stream_tags=language,title -of compact <url>` com o mesmo `LD_LIBRARY_PATH`/`SSL_CERT_FILE` do script.

Mudanças de comportamento de sincronização são em **`rightsubs/`** (regras em `rightsubs/CLAUDE.md`). Apresente os resultados e pergunte antes de aplicar uma correção.
