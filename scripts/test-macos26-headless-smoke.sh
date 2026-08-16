#!/usr/bin/env bash
# macOS 26 headless smoke — launch Sparkle, expect clean exit + proxy up (no SIGTRAP dialog).
set -euo pipefail

fail() { echo "[test-macos26-headless-smoke] FAIL: $*" >&2; exit 1; }
log() { echo "[test-macos26-headless-smoke] $*" >&2; }

major="$(sw_vers -productVersion 2>/dev/null | cut -d. -f1)"
if [[ "${major:-0}" -lt 26 ]]; then
  log "SKIP: macOS product version < 26"
  exit 0
fi

APP="/Applications/Sparkle.app"
[[ -d "$APP" ]] || fail "missing $APP"

VER="$(defaults read "$APP/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || echo unknown)"
log "Testing Sparkle $VER headless launch..."

pgrep -x Sparkle >/dev/null 2>&1 && pkill -x Sparkle 2>/dev/null || true
sleep 1

APP_LOG="$(ls -t "$HOME/Library/Application Support/sparkle/logs"/app-*.log 2>/dev/null | head -1 || true)"
before_lines=0
if [[ -n "$APP_LOG" && -f "$APP_LOG" ]]; then
  before_lines="$(wc -l < "$APP_LOG" | tr -d ' ')"
fi

osascript -e 'tell application "Finder" to open POSIX file "/Applications/Sparkle.app"' >/dev/null 2>&1 || true

deadline=$((SECONDS + 45))
while (( SECONDS < deadline )); do
  pgrep -x Sparkle >/dev/null 2>&1 || break
  sleep 1
done

pgrep -x Sparkle >/dev/null 2>&1 && fail "Sparkle GUI still running after 45s (expected headless exit)"

if [[ -n "$APP_LOG" && -f "$APP_LOG" ]]; then
  if ! tail -n +"$((before_lines + 1))" "$APP_LOG" | grep -q '\[MacOs26Headless\]: bootstrap complete'; then
    fail "MacOs26Headless bootstrap complete not found in $APP_LOG"
  fi
else
  fail "no app log at $APP_LOG"
fi

http_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -x http://127.0.0.1:7890 https://api2.cursor.sh/ || echo 000)"
[[ "$http_code" == "200" ]] || fail "proxy :7890 -> api2.cursor.sh HTTP $http_code (expected 200)"

log "PASS: headless exit + bootstrap log + proxy 200"
