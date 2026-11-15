#!/usr/bin/env bash
# dev.sh — the live development loop: the core on a workspace + the Vite dev server.
#
#   bash scripts/dev/dev.sh [workspace] [start|stop|restart-core|status]    # workspace: else $KANDINSKY_VAULT
#
# Open http://localhost:5173 — Svelte/TS/CSS edits appear at once (hot reload).
# A Rust (core) edit needs `restart-core`. Close the installed Kandinsky app on the same
# workspace first: two cores on one folder would both run its scheduled commands.
# Resolves the repo root from its own location, so it runs from anywhere.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(git -C "$here" rev-parse --show-toplevel)"
# machine-local settings: a real vault for the tests and audits that use one (KANDINSKY_TEST_VAULT, KANDINSKY_TEST_PAPERS,
# KANDINSKY_VAULT…; docs/guides/DEVELOPING.md). Without the file those tests use fixtures or skip, and say so.
[ -f "$root/scripts/dev/local.env" ] && { set -a; . "$root/scripts/dev/local.env"; set +a; echo "[dev] local settings: scripts/dev/local.env"; }
# a local.env written before the project was renamed uses ATLAS_* names: each one also under its KANDINSKY_* name,
# unless that is set
while IFS="=" read -r k v; do n="KANDINSKY_${k#ATLAS_}"; [ -n "${!n+x}" ] || export "$n=$v"; done < <(env | grep "^ATLAS_[A-Z0-9_]*=" || true)
ws="${1:-${KANDINSKY_VAULT:-}}"
[ -n "$ws" ] || { echo "usage: dev.sh <workspace> [start|stop|restart-core|status]  (or set KANDINSKY_VAULT)" >&2; exit 2; }
action="${2:-start}"
port="${KANDINSKY_DEV_PORT:-7717}"
run="${TMPDIR:-/tmp}/kandinsky-dev"
mkdir -p "$run"

say() { echo "[dev] $*"; }

# Stop by recorded PID only (a pattern kill could match this very script).
stop_one() {
  local name="$1" pid
  [ -f "$run/$name.pid" ] || return 0
  pid="$(cat "$run/$name.pid")"
  if kill -0 "$pid" 2>/dev/null; then kill "$pid" && say "stopped $name (pid $pid)"; fi
  rm -f "$run/$name.pid"
}

start_core() {
  say "building the core (cargo build -p kandinsky) — log: $run/build.log"
  if ! cargo build -q -p kandinsky --manifest-path "$root/Cargo.toml" > "$run/build.log" 2>&1; then
    say "BUILD FAILED:"; tail -30 "$run/build.log"; return 1
  fi
  say "starting the core on $ws, port $port — log: $run/core.log"
  setsid "$root/target/debug/kandinsky" serve "$ws" --port "$port" > "$run/core.log" 2>&1 &
  echo $! > "$run/core.pid"
}

start_ui() {
  say "starting Vite (hot reload) — log: $run/vite.log"
  KANDINSKY_API="http://127.0.0.1:$port" setsid npm --prefix "$root/ui" run dev > "$run/vite.log" 2>&1 &
  echo $! > "$run/vite.pid"
}

status() {
  for n in core vite; do
    if [ -f "$run/$n.pid" ] && kill -0 "$(cat "$run/$n.pid")" 2>/dev/null; then say "$n: running (pid $(cat "$run/$n.pid"))"; else say "$n: not running"; fi
  done
}

case "$action" in
  start)
    stop_one core; stop_one vite
    start_core || exit 1
    start_ui
    sleep 2; status
    say "open http://localhost:5173  (workspace: $ws)"
    ;;
  restart-core) stop_one core; start_core || exit 1; sleep 1; status ;;
  stop) stop_one core; stop_one vite ;;
  status) status ;;
  *) echo "usage: dev.sh [workspace] [start|stop|restart-core|status]"; exit 2 ;;
esac
