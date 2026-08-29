#!/usr/bin/env bash
# Install LaunchAgent that triggers Sparkle due profile updates every 5 minutes.
# Works when GUI is absent (macOS 26 headless) or as a backup when in-process timer fails.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE_DIR="${HOME}/.sparkle"
PLIST_LABEL="com.sparkle.profile-scheduler"
PLIST_PATH="${HOME}/Library/LaunchAgents/${PLIST_LABEL}.plist"
RUNNER_SRC="$ROOT/scripts/sparkle-profile-scheduler.sh"
RUNNER_DST="${STATE_DIR}/sparkle-profile-scheduler.sh"
SPARKLE_APP="/Applications/Sparkle.app/Contents/MacOS/Sparkle"
LOG_OUT="${STATE_DIR}/profile-scheduler.out.log"
LOG_ERR="${STATE_DIR}/profile-scheduler.err.log"

log() { echo "[install-profile-scheduler] $*" >&2; }
fail() { log "FAIL: $*"; exit 1; }

[[ "$(uname -s)" == "Darwin" ]] || fail "macOS only"
[[ -f "$RUNNER_SRC" ]] || fail "missing $RUNNER_SRC"
[[ -x "$SPARKLE_APP" ]] || fail "Sparkle not installed at $SPARKLE_APP — run agent upgrade first"

mkdir -p "$STATE_DIR" "${HOME}/Library/LaunchAgents"
chmod +x "$RUNNER_SRC"
cp "$RUNNER_SRC" "$RUNNER_DST"
chmod +x "$RUNNER_DST"

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
    <string>${RUNNER_DST}</string>
  </array>
  <key>StartInterval</key>
  <integer>300</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_OUT}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_ERR}</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/${PLIST_LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
launchctl enable "gui/$(id -u)/${PLIST_LABEL}"
launchctl kickstart -k "gui/$(id -u)/${PLIST_LABEL}" 2>/dev/null || true

log "Installed profile scheduler → $PLIST_PATH (every 5m + RunAtLoad)"
