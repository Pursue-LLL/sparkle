#!/usr/bin/env bash
# 安装流水线的统一日志（source 后只定义函数与变量，无副作用）。
#
# 每行带时间戳并同步写入 ${SPARKLE_STATE_DIR}/install-last.log：失败后不必重跑就能还原
# 每一步发生了什么，包括被捕获的特权命令输出（用户取消授权、被策略拒绝等原因只出现在那里，
# 之前被 `2>/dev/null` 吞掉，导致「卡在哪一步、为什么」只能靠猜）。

# shellcheck source=sparkle-paths.sh
source "$(dirname "${BASH_SOURCE[0]}")/sparkle-paths.sh"

INSTALL_LOG_TAG="${INSTALL_LOG_TAG:-install-sparkle}"
INSTALL_LOG_FILE=""

# 开始新一轮日志；上一轮保留为 install-prev.log，便于对比两次运行。
install_log_init() {
  mkdir -p "$SPARKLE_STATE_DIR"
  INSTALL_LOG_FILE="$SPARKLE_STATE_DIR/install-last.log"
  if [[ -f "$INSTALL_LOG_FILE" ]]; then
    mv -f "$INSTALL_LOG_FILE" "$SPARKLE_STATE_DIR/install-prev.log"
  fi
  : > "$INSTALL_LOG_FILE"
}

install_log() {
  local line
  line="$(date '+%H:%M:%S') [${INSTALL_LOG_TAG}] $*"
  echo "$line" >&2
  if [[ -n "$INSTALL_LOG_FILE" ]]; then
    printf '%s\n' "$line" >> "$INSTALL_LOG_FILE" 2>/dev/null || true
  fi
}

# 运行命令（可以是函数），把 stdout+stderr 逐行记入日志；返回命令自身的退出码。
run_captured() {
  local label="$1" out rc=0 line
  shift
  out="$(mktemp "${TMPDIR:-/tmp}/sparkle-install-out.XXXXXX")"
  "$@" >"$out" 2>&1 || rc=$?
  while IFS= read -r line || [[ -n "$line" ]]; do
    install_log "$label: $line"
  done < "$out"
  rm -f "$out"
  return "$rc"
}
