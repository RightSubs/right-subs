#!/usr/bin/env sh
# Controls the RightSubs service (Termux or Mac).
# Usage: scripts/rightsubs.sh start | stop | restart | status | logs
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
DATA_DIR="${RIGHTSUBS_HOME:-$HOME/.rightsubs}"
LOG_FILE="$DATA_DIR/logs/rightsubs.log"
PID_FILE="$DATA_DIR/rightsubs.pid"
MAX_LOG_BYTES=2097152   # 2 MB, keeps one previous file (rightsubs.log.1) → at most 4 MB of logs
EXIT_CONFIG=78          # invalid config: do not restart in a loop
EXIT_CLEAN_RESTART=75   # idle with too much memory: restart right away to hand it back
# Small V8 heap and young generation keep resident memory low; --expose-gc lets the
# service collect garbage when it goes idle.
NODE_FLAGS="${RIGHTSUBS_NODE_FLAGS:---max-old-space-size=128 --max-semi-space-size=2 --expose-gc}"

mkdir -p "$DATA_DIR/logs"

is_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

rotate_log() {
  if [ -f "$LOG_FILE" ] && [ "$(wc -c < "$LOG_FILE")" -gt "$MAX_LOG_BYTES" ]; then
    mv "$LOG_FILE" "$LOG_FILE.1"
  fi
}

note() {
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) INFO  supervisor.$1" >> "$LOG_FILE"
}

# Keeps the server alive: restarts it 5s after any crash, except on config errors.
supervise() {
  child=""
  trap '[ -n "$child" ] && kill "$child" 2>/dev/null; rm -f "$PID_FILE"; exit 0' TERM INT
  while true; do
    rotate_log
    # shellcheck disable=SC2086 # NODE_FLAGS is a list of flags
    node $NODE_FLAGS "$ROOT/dist/server.js" >> "$LOG_FILE" 2>&1 &
    child=$!
    if wait "$child"; then code=0; else code=$?; fi
    if [ "$code" -eq "$EXIT_CONFIG" ]; then
      note "stopped {\"reason\":\"invalid config — run: npm run check-config\"}"
      rm -f "$PID_FILE"
      exit "$code"
    fi
    if [ "$code" -eq "$EXIT_CLEAN_RESTART" ]; then
      note "restarting {\"reason\":\"clean restart to free memory\"}"
      sleep 1
      continue
    fi
    note "restarting {\"exitCode\":$code}"
    sleep 5
  done
}

start() {
  if is_running; then
    echo "RightSubs já está rodando (pid $(cat "$PID_FILE"))."
    return 0
  fi
  if [ ! -f "$ROOT/dist/server.js" ]; then
    echo "Build não encontrado — rode: sh scripts/update.sh"
    exit 1
  fi
  if ! (cd "$ROOT" && node dist/server.js --check > /dev/null); then
    echo "Configuração inválida — corrija e rode de novo (detalhes acima)."
    exit 1
  fi
  if command -v termux-wake-lock > /dev/null 2>&1; then termux-wake-lock; fi
  # Detach stdin too: over SSH it shares the session channel, and an inherited
  # descriptor keeps the remote command (e.g. the installer) from ever returning.
  nohup sh "$ROOT/scripts/rightsubs.sh" __supervise < /dev/null > /dev/null 2>&1 &
  echo $! > "$PID_FILE"
  echo "RightSubs iniciado (pid $!). Logs: $LOG_FILE"
}

stop() {
  if ! is_running; then
    echo "RightSubs não está rodando."
    rm -f "$PID_FILE"
    return 0
  fi
  kill "$(cat "$PID_FILE")"
  echo "RightSubs parado."
}

status() {
  if is_running; then
    echo "RightSubs rodando (pid $(cat "$PID_FILE"))."
    port=$(sed -n 's/^ *port: *\([0-9]*\).*/\1/p' "$ROOT/config.yaml" | head -n 1)
    curl -fsS "http://127.0.0.1:${port:-7000}/health" && echo || echo "…mas o /health não respondeu."
  else
    echo "RightSubs parado."
    return 1
  fi
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  restart) stop; sleep 1; start ;;
  status) status ;;
  logs) tail -n 100 -f "$LOG_FILE" ;;
  __supervise) supervise ;;
  *) echo "Uso: $0 start | stop | restart | status | logs"; exit 2 ;;
esac
