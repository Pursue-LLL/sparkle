#!/usr/bin/env bash
# 安装/刷新 Sparkle 订阅定时检查 LaunchAgent（macOS only）。
#
# 它让 App 每 5 分钟被唤起一次 `--sparkle-profile-update-due`：
# 该命令作为「第二实例」短暂运行、完成后立即退出，不会关掉正在使用的 GUI。
# 安装是幂等的：worker、plist、已加载 job 的来源路径都一致时不做任何 bootout/bootstrap。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/login-home.sh
source "$ROOT/scripts/lib/login-home.sh"
sparkle_pin_login_home
# shellcheck source=lib/sparkle-paths.sh
source "$ROOT/scripts/lib/sparkle-paths.sh"
# shellcheck source=lib/launchd-agent.sh
source "$ROOT/scripts/lib/launchd-agent.sh"

WORKER_SRC="$ROOT/scripts/sparkle-profile-scheduler.sh"
WORKER_DST="${SPARKLE_STATE_DIR}/sparkle-profile-scheduler.sh"
PLIST_LABEL="$SPARKLE_PROFILE_SCHEDULER_LABEL"
PLIST_PATH="${SPARKLE_LAUNCH_AGENTS_DIR}/${PLIST_LABEL}.plist"
INTERVAL_SEC=300

fail() { echo "[install-profile-scheduler] FAIL: $*" >&2; exit 1; }

[[ "$(uname -s)" == "Darwin" ]] || fail "macOS only"
[[ -f "$WORKER_SRC" ]] || fail "missing $WORKER_SRC"

mkdir -p "$SPARKLE_STATE_DIR" "$SPARKLE_LAUNCH_AGENTS_DIR"

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
    <string>${WORKER_DST}</string>
  </array>
  <key>StartInterval</key>
  <integer>${INTERVAL_SEC}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${SPARKLE_STATE_DIR}/profile-scheduler.out.log</string>
  <key>StandardErrorPath</key>
  <string>${SPARKLE_STATE_DIR}/profile-scheduler.err.log</string>
</dict>
</plist>
PLIST
)"

launchd_agent_install "$PLIST_LABEL" "$WORKER_SRC" "$WORKER_DST" "$PLIST_PATH" "$plist_content" 0 "install-profile-scheduler"
