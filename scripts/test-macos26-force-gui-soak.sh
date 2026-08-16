#!/usr/bin/env bash
# macOS 26 force-GUI soak — launch settings UI, expect no SIGTRAP for SOAK_SEC.
set -euo pipefail

fail() { echo "[test-macos26-force-gui-soak] FAIL: $*" >&2; exit 1; }
log() { echo "[test-macos26-force-gui-soak] $*" >&2; }

SOAK_SEC="${SOAK_SEC:-90}"
major="$(sw_vers -productVersion 2>/dev/null | cut -d. -f1)"
if [[ "${major:-0}" -lt 26 ]]; then
  log "SKIP: macOS product version < 26"
  exit 0
fi

VER="$(defaults read /Applications/Sparkle.app/Contents/Info.plist CFBundleShortVersionString 2>/dev/null || echo unknown)"
log "Soak Sparkle $VER force-GUI for ${SOAK_SEC}s..."

pgrep -x Sparkle >/dev/null 2>&1 && pkill -x Sparkle 2>/dev/null || true
sleep 2

before_crash="$(ls -t "$HOME/Library/Logs/DiagnosticReports"/Sparkle-*.ips 2>/dev/null | head -1 || true)"

open -a Sparkle --args --sparkle-force-gui
sleep 3

if ! pgrep -x Sparkle >/dev/null 2>&1; then
  fail "Sparkle did not stay running after force-GUI launch"
fi

log_file="$HOME/Library/Application Support/sparkle/logs/app-$(date +%Y-%-m-%-d).log"
if [[ -f "$log_file" ]]; then
  if ! tail -200 "$log_file" | rg -q "observability stack skipped"; then
    log "WARN: observability skip log not seen yet (may appear after 45s grace)"
  fi
fi

deadline=$((SECONDS + SOAK_SEC))
while (( SECONDS < deadline )); do
  if ! pgrep -x Sparkle >/dev/null 2>&1; then
    fail "Sparkle exited before ${SOAK_SEC}s (likely SIGTRAP crash)"
  fi
  sleep 2
done

after_crash="$(ls -t "$HOME/Library/Logs/DiagnosticReports"/Sparkle-*.ips 2>/dev/null | head -1 || true)"
if [[ -n "$after_crash" && "$after_crash" != "$before_crash" ]]; then
  fail "new crash report during soak: $after_crash"
fi

log "PASS: force-GUI survived ${SOAK_SEC}s without crash report"
