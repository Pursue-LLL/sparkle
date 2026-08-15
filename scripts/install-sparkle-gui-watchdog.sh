#!/usr/bin/env bash
# Install Sparkle GUI watchdog LaunchAgent (macOS only).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE_DIR="${HOME}/.sparkle"
WATCHDOG_SRC="$ROOT/scripts/sparkle-gui-watchdog.sh"
WATCHDOG_DST="${STATE_DIR}/sparkle-gui-watchdog.sh"
PLIST_LABEL="com.sparkle.gui-watchdog"
PLIST_PATH="${HOME}/Library/LaunchAgents/${PLIST_LABEL}.plist"

fail() { echo "[install-gui-watchdog] FAIL: $*" >&2; exit 1; }
log() { echo "[install-gui-watchdog] $*" >&2; }

[[ "$(uname -s)" == "Darwin" ]] || fail "macOS only"
[[ -f "$WATCHDOG_SRC" ]] || fail "missing $WATCHDOG_SRC"

mkdir -p "$STATE_DIR" "${HOME}/Library/LaunchAgents"
chmod +x "$WATCHDOG_SRC"
cp "$WATCHDOG_SRC" "$WATCHDOG_DST"
chmod +x "$WATCHDOG_DST"

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${WATCHDOG_DST}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${STATE_DIR}/gui-watchdog.out.log</string>
  <key>StandardErrorPath</key>
  <string>${STATE_DIR}/gui-watchdog.err.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/${PLIST_LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
launchctl enable "gui/$(id -u)/${PLIST_LABEL}"
launchctl kickstart -k "gui/$(id -u)/${PLIST_LABEL}" 2>/dev/null || true

log "Installed GUI watchdog → $PLIST_PATH"
