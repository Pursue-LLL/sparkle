#!/usr/bin/env bash
# Sparkle GUI watchdog — relaunch /Applications/Sparkle.app after unexpected exit.
# Respects ~/.sparkle/gui-graceful-quit.stamp written by GUI on intentional quit.
set -euo pipefail

STATE_DIR="${HOME}/.sparkle"
QUIT_MARKER="${STATE_DIR}/gui-graceful-quit.stamp"
CRASH_LEDGER="${STATE_DIR}/gui-crash-ledger.jsonl"
BACKOFF_STATE="${STATE_DIR}/gui-watchdog-backoff.state"
LAST_RELAUNCH_TS="${STATE_DIR}/gui-watchdog-last-relaunch.ts"
SPARKLE_APP="/Applications/Sparkle.app"
POLL_SEC=5
MAX_RESTARTS=3
WINDOW_SEC=60
FAST_CRASH_SEC=90
MAX_BACKOFF_SEC=300
PYTHON=/usr/bin/python3

mkdir -p "$STATE_DIR"
touch "$CRASH_LEDGER"

log() {
  echo "[sparkle-gui-watchdog] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >&2
}

count_recent_restarts() {
  if [[ ! -x "$PYTHON" ]]; then
    log "ERROR: $PYTHON missing — cannot count crash ledger (fuse disabled)"
    echo 0
    return
  fi
  if [[ ! -s "$CRASH_LEDGER" ]]; then
    echo 0
    return
  fi
  local now cutoff
  now=$(date +%s)
  cutoff=$((now - WINDOW_SEC))
  "$PYTHON" - "$CRASH_LEDGER" "$cutoff" <<'PY'
import json
import sys
from datetime import datetime, timezone

path = sys.argv[1]
cutoff = float(sys.argv[2])
count = 0
with open(path, encoding="utf-8") as handle:
    for line in handle:
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if row.get("reason") != "unexpected_exit":
            continue
        ts_raw = row.get("ts")
        if not isinstance(ts_raw, str) or not ts_raw:
            continue
        normalized = ts_raw.replace("Z", "+00:00")
        ts = datetime.fromisoformat(normalized).timestamp()
        if ts >= cutoff:
            count += 1
print(count)
PY
}

read_backoff_sec() {
  if [[ ! -f "$BACKOFF_STATE" ]]; then
    echo 0
    return
  fi
  local value
  value=$(tr -dc '0-9' < "$BACKOFF_STATE" 2>/dev/null || true)
  if [[ -z "$value" ]]; then
    echo 0
    return
  fi
  if [[ "$value" -gt "$MAX_BACKOFF_SEC" ]]; then
    echo "$MAX_BACKOFF_SEC"
    return
  fi
  echo "$value"
}

write_backoff_sec() {
  printf '%s\n' "$1" > "$BACKOFF_STATE"
}

next_backoff_sec() {
  local current="${1:-0}"
  if [[ "$current" -le 0 ]]; then
    echo 30
    return
  fi
  local doubled=$((current * 2))
  if [[ "$doubled" -gt "$MAX_BACKOFF_SEC" ]]; then
    echo "$MAX_BACKOFF_SEC"
    return
  fi
  echo "$doubled"
}

maybe_apply_fast_crash_backoff() {
  if [[ ! -f "$LAST_RELAUNCH_TS" ]]; then
    return 0
  fi
  local now last uptime backoff next
  now=$(date +%s)
  last=$(tr -dc '0-9' < "$LAST_RELAUNCH_TS" 2>/dev/null || echo 0)
  if [[ "$last" -le 0 ]]; then
    return 0
  fi
  uptime=$((now - last))
  if [[ "$uptime" -ge "$FAST_CRASH_SEC" ]]; then
    return 0
  fi
  backoff=$(read_backoff_sec)
  next=$(next_backoff_sec "$backoff")
  write_backoff_sec "$next"
  log "fast crash detected uptime=${uptime}s — backoff=${next}s before relaunch"
  sleep "$next"
}

relaunch_sparkle() {
  if [[ ! -d "$SPARKLE_APP" ]]; then
    log "WARN: $SPARKLE_APP missing — skip relaunch"
    return 1
  fi
  maybe_apply_fast_crash_backoff
  date +%s > "$LAST_RELAUNCH_TS"
  osascript -e 'tell application "Finder" to open POSIX file "/Applications/Sparkle.app"' >/dev/null 2>&1 || true
}

reset_backoff_if_stable() {
  local stable_since="${1:-0}"
  if [[ "$stable_since" -le 0 ]]; then
    return 0
  fi
  local now elapsed
  now=$(date +%s)
  elapsed=$((now - stable_since))
  if [[ "$elapsed" -ge 300 ]]; then
    write_backoff_sec 0
    rm -f "$LAST_RELAUNCH_TS"
  fi
}

log "watchdog started poll=${POLL_SEC}s max_restarts=${MAX_RESTARTS}/${WINDOW_SEC}s python=${PYTHON}"

stable_since=0

while true; do
  if pgrep -x Sparkle >/dev/null 2>&1; then
    if [[ "$stable_since" -eq 0 ]]; then
      stable_since=$(date +%s)
    fi
    reset_backoff_if_stable "$stable_since"
    sleep "$POLL_SEC"
    continue
  fi

  stable_since=0

  if [[ -f "$QUIT_MARKER" ]]; then
    rm -f "$QUIT_MARKER"
    write_backoff_sec 0
    rm -f "$LAST_RELAUNCH_TS"
    log "graceful quit observed — skip relaunch"
    sleep "$POLL_SEC"
    continue
  fi

  recent=$(count_recent_restarts)
  if [[ "$recent" -ge "$MAX_RESTARTS" ]]; then
    log "ERROR: crash-loop fuse open (${recent} restarts in ${WINDOW_SEC}s) — manual intervention required"
    sleep 60
    continue
  fi

  ts=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
  printf '{"ts":"%s","reason":"unexpected_exit","pid":null,"restart_count_window":%s}\n' "$ts" "$((recent + 1))" >> "$CRASH_LEDGER"
  log "unexpected GUI exit — relaunching Sparkle (restart $((recent + 1))/${MAX_RESTARTS} in ${WINDOW_SEC}s)"
  relaunch_sparkle
  sleep 10
done
