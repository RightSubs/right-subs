---
name: build-apk
description: Gera o APK do RightSubs (normal, de testes com o log legível por adb, ou a partir de alterações ainda não commitadas) e confere o resultado. Use quando o usuário pedir para gerar, recompilar ou atualizar o APK.
---

# Gerar o APK

Tudo roda no container `rightsubs-apk-builder` (Docker Desktop precisa estar aberto: `docker info`). Contexto da arquitetura em `CLAUDE.md`.

## Escolha o tipo

| Pedido | Comando (PowerShell) | Saída em `out/` |
|---|---|---|
| APK para distribuir | `.\build.ps1` (versão nova: skill `new-version`) | `rightsubs-<VERSION>-{armeabi-v7a,arm64-v8a,universal}.apk` + `BUILD-INFO.txt` |
| Testes na box (log legível por adb) | `.\build.ps1 -DebugLog` | `…-debuglog.apk` — **nunca distribuir** |
| Testar o addon **sem commitar** | acrescente `-WorkingTree` | `rightsubs/` como está no disco, inclusive arquivos novos |
| Credenciais do `.env` no APK (testes) | acrescente `-Prefill` | `…-prefill.apk` — texto puro, **nunca distribuir**; só vale numa instalação sem credenciais (`pm clear` antes) |
| Só a box de 32 bits (mais rápido) | acrescente `-Abis armeabi-v7a` | |
| Rodar os testes do addon antes | acrescente `-Test` (os testes do app rodam em todo build) | |
| Só os testes, sem APK | `.\test.ps1` (skill `testes`) | — |

`build.ps1` usa **só o último commit** de `rightsubs/` (`git archive HEAD:rightsubs`); o `../right-subs` não é usado. Cada build apaga o `out/` anterior.

## Testar alterações não commitadas (sem commitar)

`-WorkingTree` (`WORKING_TREE=1` no `build.sh`) tira uma foto do estado atual de `rightsubs/`, **inclusive arquivos novos**, num índice temporário do git (`build/worktree.index`: `read-tree HEAD` + `add -A -- rightsubs` + `write-tree`), sem mexer no stage nem na branch; o `.gitignore` continua valendo (`.env` e `config.yaml` não entram). O app (`android/`) é sempre copiado da pasta como está. Fluxo de teste na box (o que foi usado para a tradução do DeepL):

```powershell
.\build.ps1 -WorkingTree -Prefill -DebugLog -Test      # APK de teste; -Test roda os testes do addon (os do app rodam sempre)
```

```sh
export BOX=<ip>   # CLAUDE.local.md
sh scripts/adb.sh install -r /out/rightsubs-<VERSION>-armeabi-v7a-debuglog-prefill.apk
sh scripts/adb.sh shell pm clear com.rightsubs.android   # credenciais do .env e cache novos (a tradução em cache some)
sh scripts/adb.sh shell am start -n com.rightsubs.android/.MainActivity
```

O build avisa "Addon montado das alterações não commitadas". Não use `git stash create`: ele ignora arquivos novos e o build sai do `HEAD` sem avisar (o teste `understandsTheBundledTemplate` do `ConfigWriter` pega quando o template muda).

## Depois do build

1. Fim do log: `BUILD-INFO.txt` (versões, commit, Node, ffmpeg) e tamanhos dos APKs.
2. Erros comuns: `SHA-256 não confere` (índice do Termux mudou → rodar de novo); `precisa de X, que não está no APK` (nova dependência do Node no Termux → ajustar `SYSTEM_LIBS`/`termux-node.mjs`); falha do Gradle/lint (ver o log completo).
3. Para distribuir, rode a skill `release-check`. Para instalar na box, a skill `box`.
4. Nada de commit sem pedido do usuário.

## Mudanças no Dockerfile

Acrescente camadas no **fim** para não invalidar o cache do SDK/NDK (~3 GB). `docker build -t rightsubs-apk-builder docker`.
