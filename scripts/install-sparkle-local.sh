#!/usr/bin/env bash
# [INPUT] dist/mac-arm64/Sparkle.app（SPARKLE_INSTALL_SRC 可覆盖；须已由 afterSign 深度签名）·
#         lib/install-transaction.sh (POS: 升级事务库：暂存校验 → 静默 → rename 换装 → 门禁通过才提交，否则回滚) ·
#         lib/launchd-agent.sh (POS: LaunchAgent 幂等安装库) · lib/login-home.sh (POS: 把 HOME 钉到登录用户的
#         真实家目录) · SPARKLE_FORCE_REINSTALL · SPARKLE_INSTALL_SHORT_CIRCUIT_MARKER · SPARKLE_NONINTERACTIVE
# [OUTPUT] 把新包装到 SPARKLE_INSTALL_DEST（默认 /Applications/Sparkle.app）· 退出码 0 成功（含幂等短路）/
#          1 失败（系统未变或已恢复）/ 3 新包被门禁拒绝并已回滚 / 4 自动回滚失败需人工 ·
#          每一步写入 ${SPARKLE_STATE_DIR}/install-last.log · 提交后记录 last-sparkle-cdhash
# [POS] 本地安装的唯一入口：整个安装是一个可回滚的事务，任何一步失败（含 Ctrl-C、被 kill）都把旧包原样放回；
#       同时清走会造成 service/GUI 脑裂的 ~/Applications/Sparkle.app 重复安装。
#
# AI Agent: see BUGFIX_LOG.md §「AI Agent 操作约束」. Launch via Finder POSIX open (not open -a).
#
# Signing: pnpm run build:mac already deep-signs via afterSign (deepSignMac.cjs).
# Do NOT re-sign here — a second adhoc sign changes CDHash and invalidates Gatekeeper approval.
#
# 事务顺序（每一步失败都会把旧包原样放回，详见 lib/install-transaction.sh）：
#   preflight  恢复上次被打断的事务 · 校验源包 · 确认后台任务认静默标记 · 空间/权限
#   stage      新包拷到同目录暂存区，补内核权限（仅 TUN+elevated 需要），校验签名与 CDHash
#   quiesce    写静默标记 → 退出 GUI → 让服务停掉托管内核
#   swap       两次 rename 换装，旧包留作备份
#   gate       启动新包，数据面 / 新内核 / TUN 全部通过才提交，否则回滚
# 退出码：0 成功 · 1 失败（系统未变或已恢复）· 3 新包被门禁拒绝并已回滚 · 4 自动回滚失败（需人工）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/login-home.sh
source "$ROOT/scripts/lib/login-home.sh"
sparkle_pin_login_home
# shellcheck source=lib/install-transaction.sh
source "$ROOT/scripts/lib/install-transaction.sh"
# shellcheck source=lib/launchd-agent.sh
source "$ROOT/scripts/lib/launchd-agent.sh"

SRC="${SPARKLE_INSTALL_SRC:-$ROOT/dist/mac-arm64/Sparkle.app}"
DEST="$SPARKLE_INSTALL_DEST"
USER_COPY="${HOME}/Applications/Sparkle.app"
CDHASH_FILE="$SPARKLE_STATE_DIR/last-sparkle-cdhash"
SRC_CDHASH=""
OLD_CDHASH=""
GATE_REJECTED=0
SERVICE_BINARY_CHANGED=0

log() { install_log "$@"; }
fail() { install_log "FAIL: $*"; exit 1; }

# 任何退出路径（失败、Ctrl-C、被 kill）只要事务尚未提交，就把系统恢复到开始前的状态。
# 信号处理器只负责 exit，让这里统一收尾，避免「信号一个分支、正常退出一个分支」的两套逻辑。
on_exit() {
  local rc=$?
  trap - EXIT INT TERM HUP
  if [[ "$TXN_ACTIVE" == "1" && "$TXN_COMMITTED" != "1" ]]; then
    log "install did not complete (rc=$rc, phase=$(txn_read_phase)) — restoring the previous state"
    if txn_rollback; then
      log "previous state restored"
      if [[ "$rc" -eq 0 ]]; then rc=1; fi
      if [[ "$GATE_REJECTED" == "1" ]]; then rc=3; fi
    else
      log "CRITICAL: automatic rollback failed — restore by hand: mv \"$TXN_PREV\" \"$DEST\" (details: $INSTALL_LOG_FILE)"
      rc=4
    fi
  fi
  exit "$rc"
}

validate_source() {
  [[ -d "$SRC" ]] || fail "built app missing: $SRC (run: pnpm run build:mac)"
  if ! codesign --verify --deep --strict "$SRC" >/dev/null 2>&1; then
    fail "source app signature invalid — rebuild: pnpm run build:mac (afterSign deepSignMac.cjs)"
  fi
  SRC_CDHASH="$(bundle_cdhash "$SRC")"
  [[ -n "$SRC_CDHASH" ]] || fail "could not read CDHash from $SRC"
  if [[ -d "$DEST" ]]; then
    OLD_CDHASH="$(bundle_cdhash "$DEST" 2>/dev/null || true)"
  fi
}

# 幂等短路：同样的字节已在 /Applications 里运行且健康，再 quit/换装/启动只会打断用户。
# 缺任一条都要走真实安装；内核权限要求不满足是必须修的缺陷，不能被「看起来已装好」掩盖。
short_circuit_if_healthy() {
  local app_running=0 data_plane=0 permission_ok=0 reason
  if [[ "${SPARKLE_FORCE_REINSTALL:-0}" == "1" || -z "$OLD_CDHASH" || "$OLD_CDHASH" != "$SRC_CDHASH" ]]; then
    return 0
  fi
  # `set -e` 下 `cmd && var=1` 在 cmd 失败时会让整行返回非零并终止脚本，而这些检查「失败」
  # 正是要走真实安装的合法路径，因此一律用 if 显式吞掉退出码。
  if app_gui_running || ! app_gui_expected_to_stay; then app_running=1; fi
  if [[ "$GATE_BASELINE_TRAFFIC" == "1" ]]; then data_plane=1; fi
  if core_setuid_satisfied "$DEST"; then permission_ok=1; fi
  reason="$(install_short_circuit_reason "$app_running" "$data_plane" "$permission_ok")"
  if [[ "$reason" == "skip" ]]; then
    log "Same build already installed and healthy (CDHash $SRC_CDHASH) — nothing to do, app untouched"
    # 通知父级流程「这次是空操作」：标记文件让 agent-sparkle-upgrade.sh 跳过装后门禁，
    # 避免为一份没变的安装再起一次 --sparkle-profile-update-due 第二实例。
    if [[ -n "${SPARKLE_INSTALL_SHORT_CIRCUIT_MARKER:-}" ]]; then
      : > "$SPARKLE_INSTALL_SHORT_CIRCUIT_MARKER"
    fi
    exit 0
  fi
  log "Reinstall required: $reason"
}

# 定时任务（订阅检查、GUI 看门狗）靠静默标记避让安装；worker 是装在 ~/.sparkle 的副本，
# 旧副本不认标记就等于没有保护。所以先把它们刷新到最新，再确认两件事：
# 已部署的副本认标记，且 launchd 实际调度的就是这份副本（而不是别处加载的旧 job）。
ensure_background_workers() {
  local script worker label foreign
  for script in install-sparkle-profile-scheduler.sh install-sparkle-gui-watchdog.sh; do
    if ! run_captured "$script" bash "$ROOT/scripts/$script"; then
      log "WARN: $script failed — relying on the already deployed worker"
    fi
  done
  for worker in sparkle-profile-scheduler.sh sparkle-gui-watchdog.sh; do
    if ! grep -qF 'upgrade-in-progress' "$SPARKLE_STATE_DIR/$worker" 2>/dev/null; then
      fail "background worker $worker ignores the upgrade marker — a scheduled task could touch the app mid-install (nothing was changed)"
    fi
  done
  for label in "$SPARKLE_PROFILE_SCHEDULER_LABEL" "$SPARKLE_GUI_WATCHDOG_LABEL"; do
    foreign="$(launchd_agent_foreign_source "$label" "$SPARKLE_LAUNCH_AGENTS_DIR/${label}.plist")"
    if [[ -n "$foreign" ]]; then
      fail "launchd still schedules $label from $foreign, an old copy that ignores the upgrade marker — unload it with: $(launchd_agent_unload_hint "$label") (nothing was changed)"
    fi
  done
}

preflight_checks() {
  [[ -w "$(dirname "$DEST")" ]] || fail "cannot write to $(dirname "$DEST") — fix its permissions (nothing was changed)"
  txn_assert_free_space "$SRC" || fail "insufficient disk space (nothing was changed)"
}

# 新包在暂存区里被完整准备并校验；这一步之前系统没有任何改动，失败只需删掉暂存区。
# 先验证拷贝（字节与签名），再补内核权限：setuid 只改属主与权限位，不属于签名封印的内容，
# 把它排在验证之后，被验证的就是原样拷贝，不依赖「改属主不影响签名」这个假设。
# 内核权限放在这里而不是换装之后：它是整条流水线里唯一可能弹密码框、被取消的步骤，
# 必须排在所有不可逆动作之前。
stage_new_bundle() {
  TXN_ACTIVE=1
  TXN_HAD_PREVIOUS="$(txn_exists_flag "$DEST")"
  txn_set_phase staging
  run_captured ditto txn_stage_bundle "$SRC" || fail "staging copy failed (disk full or source unreadable)"
  txn_verify_bundle "$TXN_STAGE" "$SRC_CDHASH" || fail "staged bundle failed verification (nothing was changed)"
  run_captured core-setuid restore_core_setuid "$TXN_STAGE" || fail "core permission could not be prepared (nothing was changed)"
}

# 基线与日志快照必须在退出旧 GUI 之前取：新内核要晚于基线启动，TUN 行要出现在快照之后。
quiesce() {
  gate_snapshot_core_log
  # shellcheck disable=SC2034  # 由 lib/install-gate.sh 的 gate_core_fresh 读取
  GATE_BASELINE_EPOCH="$(date +%s)"
  txn_set_phase quiesced
  app_quit_gui || fail "Sparkle is still running after SIGKILL — stop it manually and retry"
  service_core_stop || true
  run_captured socket-hygiene "$ROOT/node_modules/.bin/tsx" "$ROOT/scripts/sparkle-stale-mihomo-socket-hygiene.mts" || true
}

swap() {
  txn_swap_in || fail "could not swap the app into place (is macOS blocking changes to $DEST? the previous app stays)"
  # 服务二进制变了而服务进程仍是旧版本：重启 root 服务需要管理员授权，不在升级里强行弹框，只如实告知。
  if [[ -e "$TXN_PREV" ]] && ! cmp -s "$TXN_PREV/$SERVICE_BINARY_REL" "$DEST/$SERVICE_BINARY_REL" 2>/dev/null; then
    SERVICE_BINARY_CHANGED=1
  fi
}

launch_and_gate() {
  app_launch_and_settle
  if ! gate_wait txn_touch_marker; then
    GATE_REJECTED=1
    fail "the new build failed the health gate — ${GATE_FAILURE}"
  fi
  log "health gate passed (${GATE_PASSED_CHECKS})"
}

record_installed_cdhash() {
  mkdir -p "$SPARKLE_STATE_DIR" && echo "$SRC_CDHASH" > "$CDHASH_FILE"
}

# ad-hoc 构建的放行记在 CDHash 上：只有装进来的 CDHash 与之前不同（含首次安装）才需要告诉用户
# 手动放行的办法。评估本身在真机上要几秒到二十秒（随系统负载而变），同一份字节重装时不必再付这个代价。
advise_gatekeeper() {
  if [[ "$OLD_CDHASH" == "$SRC_CDHASH" ]]; then
    return 0
  fi
  if [[ "$(spctl -a -t execute -vv "$DEST" 2>&1 | awk 'NR==1 { print $NF }')" == "rejected" ]]; then
    log "spctl: rejected (normal for unsigned adhoc dev builds). If macOS blocks a manual launch: Finder → /Applications → Control+click Sparkle.app → Open → Open again."
  fi
}

# 提交之后旧包已删，下面都是收尾，失败只告警，不会也不应回滚已验证的新包、更不能让一次已验证的
# 安装以非零码退出。可能失败的步骤各自显式容错：把整个函数挂在 `|| log` 后面靠 errexit 被抑制来
# 「容错」既看不出意图，失败时也不会有任何告警。
post_commit() {
  local version
  version="$(defaults read "$DEST/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || echo unknown)"
  if ! record_installed_cdhash; then
    log "WARN: could not record the installed CDHash in $CDHASH_FILE (bookkeeping only, the install is unaffected)"
  fi
  if [[ -n "$OLD_CDHASH" && "$OLD_CDHASH" != "$SRC_CDHASH" ]]; then
    log "CDHash changed ($OLD_CDHASH -> $SRC_CDHASH) — Gatekeeper may require one-time Control+Open"
  fi
  if [[ -d "$USER_COPY" ]]; then
    local backup
    backup="${USER_COPY}.bak.$(date -u +%Y%m%dT%H%M%SZ)"
    if mv "$USER_COPY" "$backup"; then
      log "Moved duplicate user install: $USER_COPY -> $backup"
    else
      log "WARN: could not move duplicate user install $USER_COPY (it can cause service/GUI split-brain)"
    fi
  fi
  if [[ "$SERVICE_BINARY_CHANGED" == "1" ]]; then
    log "NOTE: the bundled sparkle-service changed but the running root service is still the previous build; it picks up the new one when it restarts"
  fi
  advise_gatekeeper
  log "RESULT: Sparkle ${version} installed at ${DEST} (CDHash ${SRC_CDHASH}), health gate PASS"
}

main() {
  trap on_exit EXIT
  trap 'exit 130' INT TERM
  trap 'exit 129' HUP
  txn_init_paths
  txn_refuse_if_other_installer || exit 1
  install_log_init

  log "phase: preflight"
  # 收拾上次被打断的事务与回滚本次失败是同一件事：把系统带回事务开始前的样子（含重新拉起旧 App）。
  txn_rollback || fail "could not recover the previous interrupted install"
  validate_source
  GATE_BASELINE_TRAFFIC="$(gate_probe_baseline)"
  short_circuit_if_healthy
  ensure_background_workers
  preflight_checks

  stage_new_bundle
  quiesce
  swap
  log "phase: launch + gate"
  launch_and_gate
  txn_commit
  post_commit
}

main "$@"
