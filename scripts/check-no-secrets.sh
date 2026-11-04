#!/usr/bin/env bash
# Keeps the credentials of the .env files from leaving this machine. Never prints a value,
# only the NAME of the variable and where it was found. Exit 1 if anything is found.
#
#   check-no-secrets.sh apk <apk>...   a release APK (and the rightsubs.zip inside it) must carry no
#                                      assets/prefill.json, no .env/config.yaml and no value of the .env files
#   check-no-secrets.sh staged         what is staged in git must be no secret file or build output
#                                      and must contain no value of the .env files
#
# Used by scripts/container-build.sh (every build that is not -Prefill), by the git pre-commit
# hook (scripts/git-hooks/pre-commit) and by the release-check skill.
# Env files: .env and rightsubs/.env at the repository root, when they exist. Values shorter than
# 6 characters are ignored (they would match ordinary words).
set -uo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
MODE=${1:-}
shift || true

names=()
values=()
load_env() {
  [ -f "$1" ] || return 0
  local line name value
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line%$'\r'}
    case $line in '' | '#'*) continue ;; esac
    name=${line%%=*}
    [[ $name =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    value=${line#*=}
    value=${value#\"}; value=${value%\"}; value=${value#\'}; value=${value%\'}
    [ "${#value}" -ge 6 ] || continue
    names+=("$name")
    values+=("$value")
  done < "$1"
}
# CHECK_ENV_FILES (semicolon separated) replaces the default files: used to test this script with a fake .env.
if [ -n "${CHECK_ENV_FILES:-}" ]; then
  IFS=";" read -ra env_files <<< "$CHECK_ENV_FILES"
  for env_file in "${env_files[@]}"; do load_env "$env_file"; done
else
  load_env "$ROOT/.env"
  load_env "$ROOT/rightsubs/.env"
fi

problems=0
report() { echo "  ✗ $*" >&2; problems=$((problems + 1)); }

case $MODE in
  apk)
    [ "$#" -gt 0 ] || { echo "uso: check-no-secrets.sh apk <apk>..." >&2; exit 2; }
    for apk in "$@"; do
      tmp=$(mktemp -d)
      unzip -q "$apk" -d "$tmp/x" || { report "não consegui abrir $(basename "$apk")"; rm -rf "$tmp"; continue; }
      if [ -f "$tmp/x/assets/rightsubs.zip" ]; then
        mkdir "$tmp/p" && unzip -q "$tmp/x/assets/rightsubs.zip" -d "$tmp/p"
      fi
      [ -e "$tmp/x/assets/prefill.json" ] && report "$(basename "$apk"): assets/prefill.json dentro do APK"
      if find "$tmp" \( -name '.env' -o -name 'config.yaml' -o -name 'CLAUDE.local.md' \) | grep -q .; then
        report "$(basename "$apk"): arquivo de configuração local dentro do APK"
      fi
      for i in "${!names[@]}"; do
        grep -rqF -- "${values[$i]}" "$tmp" && report "$(basename "$apk"): valor de ${names[$i]} (do .env) dentro do APK"
      done
      rm -rf "$tmp"
    done
    ;;
  staged)
    cd "$ROOT" || exit 2
    bad=$(git diff --cached --name-only --diff-filter=ACMR | grep -E '(^|/)\.env$|\.env$|^signing/|^out/|^build/|CLAUDE\.local\.md$|\.apk$|prefill\.json$|local\.properties$|NAO-DISTRIBUIR\.txt$' || true)
    [ -z "$bad" ] || while IFS= read -r f; do report "arquivo que não vai para o git: $f"; done <<< "$bad"
    for i in "${!names[@]}"; do
      where=$(git grep --cached -lIF -- "${values[$i]}" 2>/dev/null | head -n 3 | tr '\n' ' ')
      [ -z "$where" ] || report "valor de ${names[$i]} (do .env) em: $where"
    done
    ;;
  *)
    echo "uso: check-no-secrets.sh apk <apk>... | staged" >&2
    exit 2
    ;;
esac

if [ "$problems" -gt 0 ]; then
  echo "BLOQUEADO: $problems problema(s) com credenciais ou arquivos locais (acima)." >&2
  exit 1
fi
echo "ok: nenhuma credencial do .env em ${MODE}"
