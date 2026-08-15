#!/usr/bin/env bash
# Sparkle GUI watchdog — relaunch /Applications/Sparkle.app after unexpected exit.
# Respects ~/.sparkle/gui-graceful-quit.stamp written by GUI on intentional quit.
set -euo pipefail

STATE_DIR="${HOME}/.sparkle"
QUIT_MARKER="${STATE_DIR}/gui-graceful-quit.stamp"
CRASH_LEDGER="${STATE_DIR}/gui-crash-ledger.jsonl"
SPARKLE_APP="/Applications/Sparkle.app"
POLL_SEC=5
MAX_RESTARTS=3
WINDOW_SEC=60

mkdir -p "$STATE_DIR"
touch "$CRASH_LEDGER"

log() {
  echo "[sparkle-gui-watchdog] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >&2
}

count_recent_restarts() {
  local now cutoff count line ts
  now=$(date +%s)
  cutoff=$((now - WINDOW_SEC))
  count=0
  if [[ ! -s "$CRASH_LEDGER" ]]; then
    echo 0
    return
  fi
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    ts=$(printf '%s' "$line" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{const j=JSON.parse(d);if(j.reason!=="unexpected_exit"||!j.ts){process.stdout.write("0");return}const ms=Date.parse(j.ts);process.stdout.write(String(Number.isFinite(ms)&&ms/1000>='${cutoff}'?1:0))}catch{process.stdout.write("0")}})')
    count=$((count + ts))
  done < "$CRASH_LEDGER"
  echo "$count"
}

relaunch_sparkle() {
  if [[ ! -d "$SPARKLE_APP" ]]; then
    log "WARN: $SPARKLE_APP missing — skip relaunch"
    return 1
  fi
  osascript -e 'tell application "Finder" to open POSIX file "/Applications/Sparkle.app"' >/dev/null 2>&1 || true
}

log "watchdog started poll=${POLL_SEC}s max_restarts=${MAX_RESTARTS}/${WINDOW_SEC}s"

while true; do
  if pgrep -x Sparkle >/dev/null 2>&1; then
    sleep "$POLL_SEC"
    continue
  fi

  if [[ -f "$QUIT_MARKER" ]]; then
    rm -f "$QUIT_MARKER"
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
