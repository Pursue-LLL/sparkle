#!/usr/bin/env bash
# LaunchAgent worker — ask Sparkle to refresh due remote subscriptions.
set -euo pipefail

SPARKLE_BIN="${SPARKLE_APP_BIN:-/Applications/Sparkle.app/Contents/MacOS/Sparkle}"
STATE_DIR="${SPARKLE_STATE_DIR:-${HOME}/.sparkle}"
LOG_PREFIX="[sparkle-profile-scheduler]"
# 升级事务期间 /Applications/Sparkle.app 正在被替换：此刻再拉起第二实例，会让「新包启动」与
# 「订阅刷新」互相抢同一份配置和内核。标记由 scripts/lib/install-transaction.sh 写入（同一 TTL）；
# 超过 TTL 说明安装进程已崩溃，不能让陈旧标记永久停掉订阅刷新。
UPGRADE_MARKER="${STATE_DIR}/upgrade-in-progress"
UPGRADE_MARKER_TTL_MIN=15

log() {
  echo "${LOG_PREFIX} $(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >> "${STATE_DIR}/profile-scheduler.out.log"
}

upgrade_in_progress() {
  [[ -n "$(find "$UPGRADE_MARKER" -maxdepth 0 -mmin "-${UPGRADE_MARKER_TTL_MIN}" 2>/dev/null)" ]]
}

if upgrade_in_progress; then
  log "upgrade in progress — skip this tick"
  exit 0
fi

if [[ ! -x "$SPARKLE_BIN" ]]; then
  log "WARN: Sparkle missing at $SPARKLE_BIN"
  exit 0
fi

if ! "$SPARKLE_BIN" --sparkle-profile-update-due >> "${STATE_DIR}/profile-scheduler.out.log" 2>> "${STATE_DIR}/profile-scheduler.err.log"; then
  log "WARN: profile update due command exited non-zero"
fi
