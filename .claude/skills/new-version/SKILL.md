---
name: new-version
description: Lança uma versão nova do APK do RightSubs — escolhe o número (semver), atualiza VERSION e CHANGELOG, gera o APK limpo, roda o release-check, commita e cria a tag vX.Y.Z. Use quando o usuário pedir uma versão nova, um release, "subir a versão" ou gerar um APK para distribuir.
---

# Versão nova do APK

A versão fica **só** no arquivo `VERSION` (`X.Y.Z`). `scripts/container-build.sh` a usa como `versionName`, no nome dos APKs **e a injeta no `package.json` do addon** (`build-payload.sh`): é a versão do addon que o app mostra na linha de status ("Versão X.Y.Z · Node…"), que o Stremio mostra no manifesto e que vai no User-Agent e no log. Por isso **nenhum texto do app tem versão escrita à mão** (nem `strings.xml`, nem layouts, nem Kotlin): se aparecer uma versão velha na tela, algo foi escrito à mão ou o build não rodou com o `VERSION` novo. O `versionCode` é automático (minutos desde 1970: sempre cresce, então qualquer build novo instala por cima). Cada versão = commit "Versão X.Y.Z" + tag anotada `vX.Y.Z` neste repositório. Passo a passo para o usuário: README › Versões. Confirme cada passo que mexe no git com o usuário (commit e tag só quando pedido).

## 1. Escolher o número

A partir da última tag (`git describe --tags --abbrev=0`) e do que mudou (`git log <tag>..HEAD --oneline`; o addon está em `rightsubs/`):

| Mudou | Sobe | Exemplo |
|---|---|---|
| Só correções | PATCH | X.Y.Z → X.Y.(Z+1) |
| Funcionalidade nova (tela, opção, fonte de streams) | MINOR, zera o PATCH | X.Y.Z → X.(Y+1).0 |
| Quem atualiza precisa refazer algo (desinstalar, digitar credenciais de novo, chave de assinatura nova) | MAJOR | X.Y.Z → (X+1).0.0 |

Proponha o número ao usuário antes de seguir.

## 2. Pré-requisitos

- O hook de commit está ativo (`git config core.hooksPath` = `scripts/git-hooks`): ele bloqueia commit com credenciais do `.env`, `signing/`, `out/`, APKs ou `CLAUDE.local.md`. Se não estiver, `git config core.hooksPath scripts/git-hooks`.
- Tudo commitado, inclusive `rightsubs/`: o `build.ps1` só empacota o último commit. O `../right-subs` não entra em nada (não leia nem altere).
- Este repositório na branch `main` (ou na branch que o usuário indicar), sem alterações além das da versão.
- `CHANGELOG.md`: a seção `[Não lançado]` descreve o que entra (texto para quem instala, em português).

## 3. Preparar e commitar

1. `VERSION` ← `X.Y.Z` (uma linha).
   Mantenha o fonte do addon igual (o build já injeta o número no pacote, mas `npm run dev` e o `git` leem estes arquivos): `cd rightsubs && npm version X.Y.Z --no-git-tag-version --allow-same-version` (atualiza `package.json` e `package-lock.json`).
2. `CHANGELOG.md`: renomeie `[Não lançado]` para `[X.Y.Z] — AAAA-MM-DD` e crie um `[Não lançado]` vazio acima.
3. Parte "Commit deste repositório" da skill `release-check`, depois:
   ```sh
   git add VERSION CHANGELOG.md rightsubs/package.json rightsubs/package-lock.json   # e o que mais fizer parte da versão
   git commit -m "Versão X.Y.Z"
   ```
   Commitar **antes** do build faz o APK corresponder exatamente ao commit da tag.

## 4. Gerar e conferir

1. `.\build.ps1 -Test` (PowerShell; testes do addon, e os do app que rodam em todo build). **Sem nenhuma opção de teste**: nunca `-DebugLog`, `-Prefill` nem `-WorkingTree` numa versão.
2. O próprio build recusa o APK (e apaga os de `out/`) se: o `versionName` do APK e a versão do addon dentro dele forem diferentes do `VERSION`; ou houver `assets/prefill.json`, `.env`/`config.yaml` ou qualquer valor dos `.env` dentro do APK (`scripts/check-no-secrets.sh`). Se ele falhar por isso, **pare e investigue**, não contorne.
3. `out/BUILD-INFO.txt`: versão certa (a linha "addon:" também deve dizer X.Y.Z) e o commit **sem** `+alterações` (com ele, o APK não corresponde a nenhum commit: commite e gere de novo). Em `out/` não pode haver `NAO-DISTRIBUIR.txt` nem APK com `-prefill` ou `-debuglog` no nome.
4. **Onde a versão aparece no app** (confira ao menos 1 e 2 num aparelho, ou pelo `/health`):

   | Onde | Origem | Como conferir |
   |---|---|---|
   | Linha de status da tela ("Versão X.Y.Z · Node …") | `package.json` do addon, injetado | tela do app, ou `curl http://127.0.0.1:7000/health` (`version`) |
   | Configurações › Apps › RightSubs | `VERSION` (Gradle `versionName`) | `aapt2 dump badging <apk>` |
   | Lista de addons do Stremio | `/manifest.json` (`version`) | o mesmo addon |
   | User-Agent (`RightSubs vX.Y.Z`) e `server.started` no log | o mesmo addon | log do app |
   | `BUILD-INFO.txt` | `VERSION` e addon | arquivo |

   Para achar texto esquecido, procure a versão **anterior**: `grep -rn "<versão anterior>" android rightsubs/package.json rightsubs/src README.md` (só podem sobrar exemplos e testes).
5. Parte "APK a distribuir" da skill `release-check` sobre os APKs de `out/`.

## 5. Tag

```sh
git tag -a vX.Y.Z -m "RightSubs APK X.Y.Z"
git push origin <branch> vX.Y.Z   # só se o usuário pedir
```

Tag errada antes do push: `git tag -d vX.Y.Z` e crie de novo. Depois do push, não mova a tag: lance X.Y.(Z+1).

## 6. Entregar

Para o usuário (e amigos): `out/rightsubs-X.Y.Z-{armeabi-v7a,arm64-v8a,universal}.apk`, `SHA256SUMS.txt` e `BUILD-INFO.txt`. Instala por cima da anterior (mesma chave em `signing/`): as credenciais continuam. Lembre o backup de `signing/`.
