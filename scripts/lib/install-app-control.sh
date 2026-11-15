#!/usr/bin/env bash
# GUI 与服务托管内核的启停（source 库，无副作用）。
# 依赖：install-log.sh、core-setuid.sh（config_scalar）；调用方须设置 ROOT（仓库根）与 DEST（安装位置）。

# shellcheck source=install-log.sh
source "$(dirname "${BASH_SOURCE[0]}")/install-log.sh"
# shellcheck source=core-setuid.sh
source "$(dirname "${BASH_SOURCE[0]}")/core-setuid.sh"

APP_QUIT_TIMEOUT_SEC="${SPARKLE_QUIT_TIMEOUT_SEC:-10}"
APP_LAUNCH_WAIT_SEC="${SPARKLE_LAUNCH_WAIT_SEC:-8}"

app_gui_running() {
  pgrep -x Sparkle >/dev/null 2>&1
}

# 停掉 GUI：先 SIGTERM，超时才 SIGKILL。返回 0 表示已没有 GUI 进程。
# 不能用 AppleEvent「quit」：App 的 before-quit 会弹出要人点「退出」的确认框（appLifecycle.ts），
# 安装器等不到答案，只能干等到超时再强杀（实测一次安装白等 20 秒）。Electron 主进程没有 SIGTERM
# 处理，收到即退出（隔离的 Electron 43 上实测 0.13 秒）；GUI 退出后托管内核由 service_core_stop 负责停。
app_quit_gui() {
  local waited=0
  if ! app_gui_running; then
    return 0
  fi
  install_log "Stopping Sparkle GUI..."
  pkill -TERM -x Sparkle 2>/dev/null || true
  while app_gui_running && [[ "$waited" -lt "$APP_QUIT_TIMEOUT_SEC" ]]; do
    sleep 1
    waited=$((waited + 1))
  done
  if app_gui_running; then
    install_log "Sparkle ignored SIGTERM for ${APP_QUIT_TIMEOUT_SEC}s — sending SIGKILL"
    pkill -9 -x Sparkle 2>/dev/null || true
    sleep 2
  fi
  if app_gui_running; then
    return 1
  fi
  return 0
}

# adhoc 构建用 `open -a` / 双击常见闪退（exit=1）；经 Finder 的 POSIX open 才稳定。
app_launch_gui() {
  osascript -e "tell application \"Finder\" to open POSIX file \"$DEST\"" >/dev/null 2>&1 || true
}

# macOS 26 默认走 headless：GUI 引导完内核就退出，没有 GUI 进程是正常的；
# 只有强制 GUI 的配置，或 macOS 26 之前，GUI 才应当一直在。
app_gui_expected_to_stay() {
  local darwin_major
  darwin_major="$(uname -r | cut -d. -f1)"
  if [[ "${darwin_major:-0}" -lt 25 ]]; then
    return 0
  fi
  [[ "$(config_scalar "$SPARKLE_APP_DATA_DIR/config.yaml" macos26ForceGui)" == "true" ]]
}

# 发起启动并短暂等 GUI 出现，必要时补一次。是否健康不在这里判断，交给门禁。
app_launch_and_settle() {
  local waited=0
  app_launch_gui
  while ! app_gui_running && [[ "$waited" -lt "$APP_LAUNCH_WAIT_SEC" ]]; do
    sleep 1
    waited=$((waited + 1))
  done
  if ! app_gui_running && app_gui_expected_to_stay; then
    install_log "GUI not up after ${APP_LAUNCH_WAIT_SEC}s — retrying Finder launch once"
    app_launch_gui
  fi
}

# 让 sparkle-service 停掉它托管的内核（签名 API，幂等）。
# 失败只告警：旧内核若还活着，门禁的「内核必须是新拉起的」会把它揪出来并触发回滚。
service_core_stop() {
  local rc=0
  run_captured core-stop "$ROOT/node_modules/.bin/tsx" "$ROOT/scripts/sparkle-service-core-stop.mts" || rc=$?
  if [[ "$rc" -ne 0 ]]; then
    install_log "WARN: stopping the service-managed core failed (rc=$rc) — the freshness gate will decide"
  fi
  return "$rc"
}
