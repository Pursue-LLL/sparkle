#!/usr/bin/env bash
# [INPUT] lib/install-log.sh::install_log / run_captured (POS: 安装流水线的统一日志) ·
#         lib/core-setuid.sh::config_scalar (POS: 内核权限判定库，含读 config.yaml 顶层标量) ·
#         scripts/sparkle-service-core-stop.mts (POS: 升级安装前的命令行入口，停掉 sparkle-service 托管的内核) ·
#         调用方设置的 ROOT（仓库根）与 DEST（安装位置）· SPARKLE_QUIT_TIMEOUT_SEC · SPARKLE_LAUNCH_WAIT_SEC
# [OUTPUT] app_quit_gui: 先 SIGTERM、超时才 SIGKILL 地退出 GUI · app_launch_and_settle: 经 Finder 拉起 GUI 并等它出现 ·
#          app_gui_running · app_gui_expected_to_stay · service_core_stop: 让服务停掉它托管的内核
# [POS] GUI 与服务托管内核的启停库（source 后只定义函数，无副作用）。

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
# Electron 把 SIGTERM 当成 app.quit()，和 AppleEvent「quit」一样走 App 的 before-quit（appLifecycle.ts），
# 平时它会弹出要人点「退出」的确认框。调用时静默标记已写入：认得标记的 App（upgradeQuiesce.ts）
# 跳过确认框、走正常退出清理；不认标记的 App（早于这项逻辑的构建）确认框会一直挂着、不理会 SIGTERM，
# 只能等满 APP_QUIT_TIMEOUT_SEC 再强杀。
# GUI 退出后托管内核由 service_core_stop 负责停。
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
# 先清掉上一个 GUI 正常退出时留下的「正常退出」戳：它属于已经不存在的进程，留着会让看门狗把这个新进程
# 的一次崩溃当成有意退出而不重启。事务期间看门狗因静默标记在暂停，不会抢在前面消费它。
app_launch_and_settle() {
  local waited=0
  rm -f "$SPARKLE_STATE_DIR/gui-graceful-quit.stamp"
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
