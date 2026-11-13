#!/usr/bin/env bash
# 安装/刷新 Sparkle 订阅定时检查 LaunchAgent（macOS only）。
#
# 它让 App 每 5 分钟被唤起一次 `--sparkle-profile-update-due`：
# 该命令作为「第二实例」短暂运行、完成后立即退出，不会关掉正在使用的 GUI。
# 安装是幂等的：内容一致且已加载时不做任何 bootout/bootstrap/kickstart。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE_DIR="${HOME}/.sparkle"
WORKER_SRC="$ROOT/scripts/sparkle-profile-scheduler.sh"
WORKER_DST="${STATE_DIR}/sparkle-profile-scheduler.sh"
PLIST_LABEL="com.sparkle.profile-scheduler"
PLIST_PATH="${HOME}/Library/LaunchAgents/${PLIST_LABEL}.plist"
INTERVAL_SEC=300

fail() { echo "[install-profile-scheduler] FAIL: $*" >&2; exit 1; }
log() { echo "[install-profile-scheduler] $*" >&2; }

[[ "$(uname -s)" == "Darwin" ]] || fail "macOS only"
[[ -f "$WORKER_SRC" ]] || fail "missing $WORKER_SRC"

mkdir -p "$STATE_DIR" "${HOME}/Library/LaunchAgents"

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
  <string>${STATE_DIR}/profile-scheduler.out.log</string>
  <key>StandardErrorPath</key>
  <string>${STATE_DIR}/profile-scheduler.err.log</string>
</dict>
</plist>
PLIST
)"

# 幂等：脚本内容与 plist 都已就位且一致、并且 LaunchAgent 已加载时直接返回。
# 每次安装都重装会重置调度相位，让「刚装完就立刻又跑一次」变成常态噪声。
scheduler_unchanged() {
  [[ -f "$WORKER_DST" ]] || return 1
  [[ -f "$PLIST_PATH" ]] || return 1
  cmp -s "$WORKER_SRC" "$WORKER_DST" || return 1
  [[ "$(cat "$PLIST_PATH")" == "$plist_content" ]] || return 1
  launchctl print "gui/$(id -u)/${PLIST_LABEL}" >/dev/null 2>&1 || return 1
  return 0
}

if scheduler_unchanged; then
  log "Profile scheduler unchanged and loaded — skipping reinstall"
  exit 0
fi

cp "$WORKER_SRC" "$WORKER_DST"
chmod +x "$WORKER_DST"
printf '%s\n' "$plist_content" > "$PLIST_PATH"

launchctl bootout "gui/$(id -u)/${PLIST_LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
launchctl enable "gui/$(id -u)/${PLIST_LABEL}"

log "Installed profile scheduler LaunchAgent (every ${INTERVAL_SEC}s) → $PLIST_PATH"
