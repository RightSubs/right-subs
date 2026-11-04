---
name: release-check
description: Checklist de segurança antes de distribuir um APK do RightSubs ou commitar este repositório — confere que não há credenciais, recursos de debug, chave de assinatura ou dados locais no APK ou no git. Use antes de enviar um APK a alguém, publicar, ou fazer commit/push.
---

# Antes de distribuir ou commitar

Rode tudo; relate cada item ao usuário (ok / problema). Não imprima valores de segredos — só contagens.

**Barreiras automáticas** (conferem os mesmos itens, mas não substituem esta checagem): `scripts/check-no-secrets.sh apk <apk>…` roda em **todo build que não é `-Prefill`** e apaga os APKs se achar `prefill.json`, `.env`/`config.yaml` ou qualquer valor dos `.env` neles; `scripts/check-no-secrets.sh staged` roda no hook de commit (`scripts/git-hooks/pre-commit`, ativo com `git config core.hooksPath scripts/git-hooks`). Os dois mostram só o **nome** da variável e o arquivo, nunca o valor.

## APK a distribuir

1. **Não é de testes:** o nome não tem `-debuglog` nem `-prefill` (testes, `-Prefill` leva as credenciais do `.env` em texto puro), não existe `out/NAO-DISTRIBUIR.txt` e não há `assets/prefill.json`:
   `unzip -l out/<apk> | grep -c prefill` → `0`. `out/BUILD-INFO.txt` com a versão certa e commit sem `+alterações`.
2. **Sem os segredos dos `.env` deste repositório** (raiz e `rightsubs/`) (extrai o APK e o `rightsubs.zip` num diretório do scratchpad e procura cada valor ≥ 6 caracteres):
   ```sh
   W=<scratchpad>/apkcheck; rm -rf $W; mkdir -p $W/x $W/p
   unzip -q out/<apk> -d $W/x && unzip -q $W/x/assets/rightsubs.zip -d $W/p
   find $W/p \( -name '.env' -o -name 'config.yaml' -o -name 'CLAUDE.local.md' \)   # → nada
   for f in .env rightsubs/.env; do [ -f $f ] || continue; n=0; h=0
     while IFS= read -r l; do v=$(printf '%s' "$l" | sed -n "s/^[A-Z_]*=//p" | sed "s/^['\"]//; s/['\"]$//")
       [ ${#v} -ge 6 ] || continue; n=$((n+1)); grep -rqF -- "$v" $W/x $W/p && h=$((h+1)); done < $f
     echo "$f: $n testados, $h encontrados"; done      # → 0 encontrados
   rm -rf $W
   ```
3. **Log de debug desligado:** o build normal passa `-PdebugLog=false` (a primeira linha do `BUILD-INFO.txt` não cita `-debuglog`).
4. **Assinatura:** `apksigner verify --print-certs out/<apk>` dentro do container mostra o certificado `CN=RightSubs` (mesma chave das versões anteriores; senão o usuário não consegue atualizar por cima).
5. **TLS do ffmpeg com verificação:** `grep -c "Unable to set the host to verify" $W/x/lib/*/libffmpeg.so` ≥ 1 (patch aplicado).
6. Entregue junto o `out/SHA256SUMS.txt`.

## Commit deste repositório

- `git diff --cached --name-only` não pode conter: `.env`, `*.env`, `signing/`, `out/`, `build/`, `CLAUDE.local.md`, `android/local.properties`.
- Nenhum valor do `.env` nos arquivos versionados (`git grep -F -- <valor>` com o mesmo laço acima, sobre `git ls-files`).
- Nem o IP da box nem links do Real-Debrid em arquivos versionados (`git grep -nE '192\.168\.|download\.real-debrid'`).
- Commit só quando o usuário pedir; autor = `git config` local.

## Lembretes

- **Backup da chave:** `signing/` (fora do git). Sem ela, nenhuma atualização do APK instala por cima.
- **Recursos de testes** que existem no código: cópia do log (`-DebugLog`) e credenciais do `.env` (`-Prefill`); `-WorkingTree` só muda a origem do addon, e `translation.deepl.forceFrom` só vale no `config.yaml` do PC. Ver "Recursos SÓ DE TESTES" no `CLAUDE.md`. O laço de segredos acima já cobre a `DEEPL_API_KEY` do `.env`.
