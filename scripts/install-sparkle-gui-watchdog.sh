#!/usr/bin/env bash
# 安装/刷新 Sparkle GUI 看门狗 LaunchAgent（macOS only）。
#
# 安装是幂等的：worker、plist、已加载 job 的来源路径都一致时不做任何 bootout/bootstrap/kickstart。
# 每次安装都重启看门狗会重置它的崩溃台账与退避状态，让「反复重启」更像反复重启。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/login-home.sh
source "$ROOT/scripts/lib/login-home.sh"
sparkle_pin_login_home
# shellcheck source=lib/sparkle-paths.sh
source "$ROOT/scripts/lib/sparkle-paths.sh"
# shellcheck source=lib/launchd-agent.sh
source "$ROOT/scripts/lib/launchd-agent.sh"

WATCHDOG_SRC="$ROOT/scripts/sparkle-gui-watchdog.sh"
WATCHDOG_DST="${SPARKLE_STATE_DIR}/sparkle-gui-watchdog.sh"
PLIST_LABEL="$SPARKLE_GUI_WATCHDOG_LABEL"
PLIST_PATH="${SPARKLE_LAUNCH_AGENTS_DIR}/${PLIST_LABEL}.plist"

fail() { echo "[install-gui-watchdog] FAIL: $*" >&2; exit 1; }

[[ "$(uname -s)" == "Darwin" ]] || fail "macOS only"
[[ -f "$WATCHDOG_SRC" ]] || fail "missing $WATCHDOG_SRC"

mkdir -p "$SPARKLE_STATE_DIR" "$SPARKLE_LAUNCH_AGENTS_DIR"
chmod +x "$WATCHDOG_SRC"

plist_content="$(cat <<PLIST
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
  <string>${SPARKLE_STATE_DIR}/gui-watchdog.out.log</string>
  <key>StandardErrorPath</key>
  <string>${SPARKLE_STATE_DIR}/gui-watchdog.err.log</string>
</dict>
</plist>
PLIST
)"

launchd_agent_install "$PLIST_LABEL" "$WATCHDOG_SRC" "$WATCHDOG_DST" "$PLIST_PATH" "$plist_content" 1 "install-gui-watchdog"
