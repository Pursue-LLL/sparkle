#!/usr/bin/env bash
# [INPUT] lib/install-log.sh (POS: 安装流水线的统一日志) · lib/install-app-control.sh (POS: GUI 与服务托管
#         内核的启停库) · lib/install-gate.sh (POS: 装后门禁库) · 调用方设置的 DEST（安装位置）与 ROOT（仓库根）·
#         codesign · ditto · 阶段文件 ${SPARKLE_STATE_DIR}/upgrade-state · 静默标记 ${SPARKLE_STATE_DIR}/upgrade-in-progress
# [OUTPUT] txn_init_paths · txn_stage_bundle · txn_verify_bundle · bundle_cdhash · txn_assert_free_space ·
#          txn_swap_in · txn_commit · txn_rollback（回滚与中断恢复共用决策表 txn_plan_recovery）·
#          txn_set_phase / txn_read_phase / txn_touch_marker: 阶段文件与静默标记 ·
#          txn_refuse_if_other_installer · TXN_* 共享状态
# [POS] 升级事务库（source 后只定义函数与状态变量，无副作用）：暂存校验 → 静默 → rename 换装 →
#       门禁通过才提交，否则回滚。
#
# 事务模型：新包先在同一目录暂存并完整校验（不碰现有安装）→ 进入静默期 → 用 rename 换装并把旧包
# 留作备份 → 门禁通过才提交（删备份），否则 rename 回滚。换装只有两次 rename，没有任何「先删旧包
# 再慢慢拷新包」的窗口；回滚和「上次被打断」的恢复走同一份决策表，因此任何失败点、
# 包括 Ctrl-C 与进程被杀，系统最终都停在「旧包原样可用」或「新包已验证」两种状态之一。

# TXN_* 是库与调用方共享的状态：赋值在库里，读取在 source 它的脚本里。
# shellcheck disable=SC2034
# shellcheck source=install-log.sh
source "$(dirname "${BASH_SOURCE[0]}")/install-log.sh"
# shellcheck source=install-app-control.sh
source "$(dirname "${BASH_SOURCE[0]}")/install-app-control.sh"
# shellcheck source=install-gate.sh
source "$(dirname "${BASH_SOURCE[0]}")/install-gate.sh"

# 静默标记的有效期（分钟）：后台定时任务（订阅检查、GUI 看门狗）见到新鲜标记就不碰 App。
# 取 mtime 为准且每个阶段都会刷新；进程崩溃留下的陈旧标记最多挡 15 分钟，不会永久卡死。
# 两个 worker 脚本里写着同一个数字，由 scripts 测试保持一致。
TXN_MARKER_TTL_MIN=15
TXN_PHASE_FILE="$SPARKLE_STATE_DIR/upgrade-state"
TXN_MARKER_FILE="$SPARKLE_STATE_DIR/upgrade-in-progress"

TXN_ACTIVE=0
TXN_COMMITTED=0
# 事务开始时 DEST 里是否已有旧 App（1/0）。写进阶段文件：回滚可能发生在崩溃后的另一个进程里，
# 只有它才能回答「有没有旧 App 可以重新拉起」；全新安装失败时要拉起的不是旧 App，而是什么都没有。
TXN_HAD_PREVIOUS=0

# 暂存、备份、失败品都放在与 DEST 同一目录（同一文件系统）：rename 才是原子的，也不占额外空间。
# 名字不带 .app 后缀，Launch Services 不会把它们当成可启动的 App；
# 暂存目录改名不影响 `codesign --verify --deep --strict`，CDHash 也不变，所以可以先校验再换装。
txn_init_paths() {
  local parent
  parent="$(dirname "$DEST")"
  TXN_STAGE="$parent/.Sparkle.staging"
  TXN_PREV="$parent/.Sparkle.prev"
  TXN_FAILED="$parent/.Sparkle.failed"
}

# rm -rf 只允许删这三个事务私有目录，任何别的路径一律拒绝。
txn_remove_scratch() {
  local target="$1"
  case "$target" in
    "$TXN_STAGE" | "$TXN_PREV" | "$TXN_FAILED") ;;
    *)
      install_log "refusing to delete a path outside the transaction: $target"
      return 1
      ;;
  esac
  if [[ ! -e "$target" ]]; then
    return 0
  fi
  rm -rf "$target"
}

txn_touch_marker() {
  mkdir -p "$SPARKLE_STATE_DIR"
  : > "$TXN_MARKER_FILE"
}

txn_phase_field() {
  local value=""
  if [[ -f "$TXN_PHASE_FILE" ]]; then
    value="$(sed -n "s/^$1=//p" "$TXN_PHASE_FILE" | head -1)"
  fi
  echo "$value"
}

txn_read_phase() {
  local phase
  phase="$(txn_phase_field phase)"
  echo "${phase:-none}"
}

# 先写临时文件再 rename：阶段文件任何时刻都是完整的，崩溃不会留下半截内容。
txn_set_phase() {
  local phase="$1" tmp="$TXN_PHASE_FILE.tmp"
  mkdir -p "$SPARKLE_STATE_DIR"
  printf 'phase=%s\npid=%s\nts=%s\nhad_prev=%s\n' "$phase" "$$" "$(date +%s)" "$TXN_HAD_PREVIOUS" > "$tmp"
  mv -f "$tmp" "$TXN_PHASE_FILE"
  txn_touch_marker
  install_log "phase: $phase"
}

txn_clear_state() {
  rm -f "$TXN_PHASE_FILE" "$TXN_PHASE_FILE.tmp" "$TXN_MARKER_FILE"
}

# 另一个安装进程正在跑：阶段文件里的 pid 还活着、不超过 1 小时、且它确实是个 bash 进程。
# 最后一条是防 pid 被系统复用：崩溃留下的 pid 若恰好分给了别的程序，不能因此把后续安装全部挡住。
# 只读 `comm`（可执行路径），不读命令行：命令行里可能带密钥。
txn_other_installer_active() {
  local pid comm
  [[ -f "$TXN_PHASE_FILE" ]] || return 1
  pid="$(txn_phase_field pid)"
  [[ -n "$pid" && "$pid" != "$$" ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  comm="$(ps -o comm= -p "$pid" 2>/dev/null || true)"
  [[ "$comm" == *bash* ]] || return 1
  [[ -n "$(find "$TXN_PHASE_FILE" -maxdepth 0 -mmin -60 2>/dev/null)" ]]
}

# 中断恢复/回滚的决策表：只看「阶段 + 四个目录是否存在（1/0）」，每个动作一行输出。
#   · 暂存目录与失败品目录永远是草稿，直接删（失败品是回滚中途被打断时留下的、未经验证的新包）；
#   · 换装已开始（swapping/swapped）且备份在：DEST 在说明新包已就位但未被验证 → 丢弃并放回旧包；
#     DEST 不在说明正卡在两次 rename 之间 → 直接放回旧包；
#   · 其它阶段备份还在：DEST 在说明是上次提交后清理被打断 → 删备份；DEST 不在 → 放回备份；
#   · 备份不在就没有可回退的旧包，保留 DEST 现状。
# 与 sparkleInstallSafetyCore.planInterruptedUpgradeRecovery 同口径，契约测试逐格对齐。
txn_plan_recovery() {
  local phase="$1" dest="$2" prev="$3" stage="$4" failed="$5"
  if [[ "$stage" == "1" ]]; then
    echo "remove_stage"
  fi
  if [[ "$failed" == "1" ]]; then
    echo "remove_failed"
  fi
  if [[ "$prev" != "1" ]]; then
    return 0
  fi
  case "$phase" in
    swapping | swapped)
      if [[ "$dest" == "1" ]]; then echo "discard_dest_restore_prev"; else echo "restore_prev"; fi
      ;;
    *)
      if [[ "$dest" == "1" ]]; then echo "remove_prev"; else echo "restore_prev"; fi
      ;;
  esac
}

txn_exists_flag() {
  if [[ -e "$1" ]]; then echo 1; else echo 0; fi
}

# 先把失败品改名挪开再放回旧包，第二步失败还能原样挪回去：任何时刻 DEST 要么是新包要么是旧包。
txn_discard_dest_restore_prev() {
  txn_remove_scratch "$TXN_FAILED" || return 1
  mv "$DEST" "$TXN_FAILED" || return 1
  if ! mv "$TXN_PREV" "$DEST"; then
    mv "$TXN_FAILED" "$DEST" || true
    return 1
  fi
  txn_remove_scratch "$TXN_FAILED" || install_log "WARN: could not remove $TXN_FAILED"
}

txn_run_step() {
  case "$1" in
    remove_stage) txn_remove_scratch "$TXN_STAGE" ;;
    remove_failed) txn_remove_scratch "$TXN_FAILED" ;;
    remove_prev) txn_remove_scratch "$TXN_PREV" ;;
    restore_prev)
      # mv 到一个已存在的目录会「移进去」而不是「替换」，必须确认 DEST 真的不存在。
      [[ ! -e "$DEST" ]] || return 1
      mv "$TXN_PREV" "$DEST"
      ;;
    discard_dest_restore_prev) txn_discard_dest_restore_prev ;;
    *)
      install_log "unknown recovery step: $1"
      return 1
      ;;
  esac
}

# 按决策表执行文件系统动作。阶段文件与静默标记由调用方在整个收尾完成后再清，
# 恢复失败时它们都保留，下次启动据此继续恢复。
txn_recover() {
  local phase plan step prev_flag
  phase="$(txn_read_phase)"
  prev_flag="$(txn_exists_flag "$TXN_PREV")"
  plan="$(txn_plan_recovery "$phase" "$(txn_exists_flag "$DEST")" "$prev_flag" "$(txn_exists_flag "$TXN_STAGE")" "$(txn_exists_flag "$TXN_FAILED")")"
  if [[ -n "$plan" ]]; then
    install_log "recovery (phase=$phase): $(echo "$plan" | tr '\n' ' ')"
  fi
  if [[ "$prev_flag" != "1" && "$phase" == "swapped" ]]; then
    install_log "no previous app to restore (first install, or the backup is gone) — leaving $DEST as it is"
  fi
  for step in $plan; do
    if ! txn_run_step "$step"; then
      install_log "recovery step failed: $step"
      return 1
    fi
  done
}

# 另一个安装正在跑就拒绝开始。必须赶在日志轮转之前：被拒绝的这次不能把正在运行的那次的日志冲掉。
txn_refuse_if_other_installer() {
  if txn_other_installer_active; then
    install_log "FAIL: another install is in progress ($(tr '\n' ' ' < "$TXN_PHASE_FILE"))"
    return 1
  fi
}

# 把系统恢复到事务开始前的状态。静默期开始后（quiesced 及以后）GUI 与内核已被我们停掉，
# 恢复完旧包必须把它重新拉起来，否则「回滚成功」的结果是代理全断；换装后的失败还要先停掉
# 新包拉起的 GUI 与内核。全新安装没有旧包可拉起，只收拾现场。
# 恢复失败时保留阶段文件，由下次启动继续恢复。
txn_rollback() {
  local phase rc=0 interrupted=0
  phase="$(txn_read_phase)"
  case "$phase" in
    quiesced) interrupted=1 ;;
    swapping | swapped)
      interrupted=1
      install_log "rolling back: stopping the new app and its core"
      app_quit_gui || install_log "WARN: could not stop the new GUI"
      service_core_stop || true
      ;;
  esac
  if [[ "$(txn_phase_field had_prev)" != "1" ]]; then
    interrupted=0
  fi
  txn_recover || rc=1
  if [[ "$rc" -eq 0 && "$interrupted" -eq 1 ]]; then
    install_log "restarting the previous app"
    app_launch_and_settle
    GATE_STRICT=0
    if gate_wait txn_touch_marker; then
      install_log "previous app restored and healthy (${GATE_PASSED_CHECKS})"
    else
      install_log "WARN: previous app restored but not healthy yet: ${GATE_FAILURE}"
    fi
  fi
  if [[ "$rc" -eq 0 ]]; then
    txn_clear_state
  fi
  return "$rc"
}

# 空间：暂存要多占一份新包体积（备份与失败品都是 rename，不占额外空间）。
txn_assert_free_space() {
  local src="$1" need_kb free_kb
  need_kb="$(du -sk "$src" | cut -f1)"
  need_kb=$(( need_kb + need_kb / 5 + 524288 ))
  free_kb="$(df -k "$(dirname "$DEST")" | awk 'NR==2 { print $4 }')"
  if [[ "${free_kb:-0}" -lt "$need_kb" ]]; then
    install_log "FAIL: not enough free space next to $DEST (need ~$((need_kb / 1024)) MB, have $((${free_kb:-0} / 1024)) MB)"
    return 1
  fi
}

# 不能在匹配后 exit：awk 提前退出会让还在写输出的 codesign 吃 SIGPIPE，在 pipefail 下整条流水线
# 返回 141，调用处的 `set -e` 会因此误杀整个安装。
bundle_cdhash() {
  codesign -dv --verbose=4 "$1" 2>&1 | awk '/^CDHash=/ && !seen { print substr($0, 8); seen = 1 }'
}

# 签名完整且 CDHash 等于源包：校验的正是即将换进去的那份字节与元数据。
txn_verify_bundle() {
  local app="$1" expected="$2" actual
  if ! codesign --verify --deep --strict "$app" >/dev/null 2>&1; then
    install_log "signature invalid: $app"
    return 1
  fi
  actual="$(bundle_cdhash "$app")"
  if [[ "$actual" != "$expected" ]]; then
    install_log "CDHash mismatch for $app (expected $expected, got ${actual:-none})"
    return 1
  fi
}

txn_stage_bundle() {
  local src="$1"
  txn_remove_scratch "$TXN_STAGE" || return 1
  ditto "$src" "$TXN_STAGE" || return 1
  xattr -cr "$TXN_STAGE" 2>/dev/null || true
}

# 换装。只有两次 rename：DEST→备份、暂存→DEST。每一步前先确认目标位置是空的，
# 否则 mv 会把目录「移进」已有目录而不是替换它。
# 备份位已被占用的检查必须赶在阶段变成 swapping 之前：swapping 阶段下决策表把「DEST 与备份同时
# 存在」读成「新包已就位」而丢弃 DEST，可这里 DEST 还是完好的旧包，丢掉它就等于删了用户的 App。
txn_swap_in() {
  if [[ -e "$DEST" && -e "$TXN_PREV" ]]; then
    install_log "refusing to swap: a stale backup exists at $TXN_PREV"
    return 1
  fi
  txn_set_phase swapping
  if [[ -e "$DEST" ]]; then
    mv "$DEST" "$TXN_PREV" || return 1
  fi
  [[ ! -e "$DEST" ]] || return 1
  mv "$TXN_STAGE" "$DEST" || return 1
  txn_set_phase swapped
}

# 提交：先记 committed 再删备份，崩溃在两者之间时恢复逻辑只会清理备份，不会回滚已验证的新包。
txn_commit() {
  txn_set_phase committed
  TXN_COMMITTED=1
  txn_remove_scratch "$TXN_PREV" || install_log "WARN: could not remove the backup $TXN_PREV (next run cleans it)"
  txn_clear_state
}
