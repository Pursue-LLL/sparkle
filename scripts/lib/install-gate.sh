#!/usr/bin/env bash
# [INPUT] lib/core-setuid.sh::enabled_core_name / effective_core_permission_mode / tun_enabled
#         (POS: 内核权限判定库) · 调用方设置的 DEST（安装位置）与 GATE_BASELINE_* / GATE_STRICT ·
#         SPARKLE_PROXY_PORT · 内核日志 ${SPARKLE_APP_DATA_DIR}/logs/core-*.log
# [OUTPUT] gate_probe_baseline: 升级前数据面基线 · gate_snapshot_core_log: 内核日志快照 ·
#          gate_wait: 轮询门禁，通过返回 0、超时返回 1 · gate_check_once · GATE_FAILURE / GATE_PASSED_CHECKS:
#          失败原因与实际验证过的项 · install_short_circuit_reason: 幂等短路判定
#          （与 sparkleInstallSafetyCore.resolveInstallShortCircuit 同口径）
# [POS] 装后门禁库（source 后只定义函数与状态变量，无副作用）：新包必须证明自己能把代理跑起来，
#       否则调用方回滚到旧包。
#
# 判据只看用户真正依赖的东西，而不是「进程在不在」「有没有窗口」：
#   1. 代理端口在监听；升级前代理本来就通时，还要能经它访问外网（数据面）。
#      升级前就不通说明是网络或节点的问题，归咎给新包会让升级被外部故障卡死、白白回滚。
#   2. service 模式下内核必须是升级后新拉起的：否则「看起来正常」只是旧内核还活着，
#      新包里的内核二进制从未被验证过。
#   3. service 模式且 TUN 开启时，新内核日志里必须出现 TUN 网卡监听行。

# GATE_* 是库与调用方共享的状态：赋值在库里，读取在 source 它的脚本里。
# shellcheck disable=SC2034
# shellcheck source=core-setuid.sh
source "$(dirname "${BASH_SOURCE[0]}")/core-setuid.sh"

GATE_PROXY_PORT="${SPARKLE_PROXY_PORT:-7890}"
GATE_PROBE_URL="https://www.gstatic.com/generate_204"
GATE_POLL_SEC="${SPARKLE_GATE_POLL_SEC:-2}"
GATE_TIMEOUT_SEC="${SPARKLE_GATE_TIMEOUT_SEC:-90}"
GATE_TUN_LOG_LINE='[TUN] Tun adapter listening at:'

# 由调用方在退出旧 GUI 之前设置：新内核必须晚于该时刻启动；TUN 行必须出现在快照之后。
GATE_BASELINE_EPOCH=0
GATE_LOG_SNAPSHOT_PATH=""
GATE_LOG_SNAPSHOT_SIZE=0
# 升级前数据面是否本来就通（1/0）；决定门禁是否把「经代理访问外网」当作硬条件。
GATE_BASELINE_TRAFFIC=1
# 1 = 验证「新包」：内核必须是升级后新拉起的、TUN 行必须出现在快照之后。
# 0 = 验证「回滚后的旧包」：旧内核没必要重新证明自己，只要求端口监听与数据面通。
GATE_STRICT=1
GATE_FAILURE=""
GATE_PASSED_CHECKS=""

gate_proxy_listening() {
  nc -z -w 2 127.0.0.1 "$GATE_PROXY_PORT" >/dev/null 2>&1
}

gate_data_plane_ok() {
  curl -sf --max-time 5 -x "http://127.0.0.1:${GATE_PROXY_PORT}" "$GATE_PROBE_URL" >/dev/null 2>&1
}

# 升级前的数据面基线。单次探测可能撞上节点瞬时抖动，把「本来通」误记成「本来不通」会让门禁
# 放松到只看端口，所以连探三次，任一次通就算通。
gate_probe_baseline() {
  local attempt
  for attempt in 1 2 3; do
    if gate_data_plane_ok; then
      echo 1
      return 0
    fi
    if [[ "$attempt" -lt 3 ]]; then
      sleep 1
    fi
  done
  echo 0
}

# 把 ps 的 etime（[[dd-]hh:]mm:ss）折算成秒；`10#` 防止 08/09 被当成八进制。
etime_to_sec() {
  local raw days=0 rest f1 f2 f3 h=0 m s
  raw="$(printf '%s' "$1" | tr -d '[:space:]')"
  if [[ "$raw" == *-* ]]; then
    days="${raw%%-*}"
    rest="${raw#*-}"
  else
    rest="$raw"
  fi
  IFS=: read -r f1 f2 f3 <<< "$rest"
  if [[ -n "$f3" ]]; then
    h="$f1"; m="$f2"; s="$f3"
  else
    m="$f1"; s="$f2"
  fi
  echo $(( 10#${days:-0} * 86400 + 10#${h:-0} * 3600 + 10#${m:-0} * 60 + 10#${s:-0} ))
}

# 以新包里启用内核的路径在运行的进程 pid。只比对可执行路径，不读命令行（命令行可能带密钥）。
gate_core_pids() {
  local name want pid path
  name="$(enabled_core_name)"
  want="$DEST/$CORE_SIDECAR_REL/$name"
  for pid in $(pgrep -x "$name" 2>/dev/null || true); do
    path="$(ps -o comm= -p "$pid" 2>/dev/null | sed 's/^[[:space:]]*//')"
    if [[ "$path" == "$want" ]]; then
      echo "$pid"
    fi
  done
}

# 0 = 新包里的内核在运行且没有早于升级基线的旧进程；否则设置 GATE_FAILURE 并返回 1。
gate_core_fresh() {
  local pid etime age elapsed seen=0
  if [[ "$GATE_BASELINE_EPOCH" -le 0 ]]; then
    GATE_FAILURE="gate baseline was never recorded (internal error)"
    return 1
  fi
  elapsed=$(( $(date +%s) - GATE_BASELINE_EPOCH ))
  for pid in $(gate_core_pids); do
    etime="$(ps -o etime= -p "$pid" 2>/dev/null || true)"
    # 进程恰好在两次查询之间退出：没有年龄就不能当作「新内核」。
    if [[ -z "${etime//[[:space:]]/}" ]]; then
      continue
    fi
    seen=1
    age="$(etime_to_sec "$etime")"
    if [[ "$age" -gt $(( elapsed + 2 )) ]]; then
      GATE_FAILURE="core pid=${pid} predates the upgrade (age ${age}s > ${elapsed}s): the old core is still running"
      return 1
    fi
  done
  if [[ "$seen" -eq 0 ]]; then
    GATE_FAILURE="no core process from the new bundle is running yet"
    return 1
  fi
  return 0
}

# 内核日志按天分文件且文件名不补零（core-2026-11-9.log），只能按修改时间取最新。
gate_core_log_latest() {
  # 文件名由 App 生成（ASCII）；需要的是按修改时间排序，find 做不到这一点。
  # shellcheck disable=SC2012
  ls -t "$SPARKLE_APP_DATA_DIR"/logs/core-*.log 2>/dev/null | head -1 || true
}

gate_file_size() {
  stat -f %z "$1" 2>/dev/null || echo 0
}

gate_snapshot_core_log() {
  GATE_LOG_SNAPSHOT_PATH="$(gate_core_log_latest)"
  GATE_LOG_SNAPSHOT_SIZE=0
  if [[ -n "$GATE_LOG_SNAPSHOT_PATH" ]]; then
    GATE_LOG_SNAPSHOT_SIZE="$(gate_file_size "$GATE_LOG_SNAPSHOT_PATH")"
  fi
}

# 快照之后的新增内容里出现 TUN 监听行。跨天换文件、或文件被截断时从头读，避免漏判。
gate_tun_listening_since_snapshot() {
  local latest offset=0 hits
  latest="$(gate_core_log_latest)"
  [[ -n "$latest" ]] || return 1
  if [[ "$latest" == "$GATE_LOG_SNAPSHOT_PATH" ]]; then
    offset="$GATE_LOG_SNAPSHOT_SIZE"
    if [[ "$(gate_file_size "$latest")" -lt "$offset" ]]; then
      offset=0
    fi
  fi
  # grep -c 会读完整个输入；用 -q 提前退出会让 tail 吃 SIGPIPE，在 pipefail 下把命中误判为失败。
  hits="$(tail -c +$((offset + 1)) "$latest" 2>/dev/null | grep -cF "$GATE_TUN_LOG_LINE" || true)"
  [[ "${hits:-0}" -gt 0 ]]
}

# 单轮检查：全部通过返回 0 并在 GATE_PASSED_CHECKS 里记下实际验证过的项；
# 否则返回 1 并在 GATE_FAILURE 里写明第一个不满足的条件。
gate_check_once() {
  GATE_FAILURE=""
  GATE_PASSED_CHECKS="listener"
  if ! gate_proxy_listening; then
    GATE_FAILURE="proxy port ${GATE_PROXY_PORT} is not listening"
    return 1
  fi
  if [[ "$GATE_BASELINE_TRAFFIC" == "1" ]]; then
    if ! gate_data_plane_ok; then
      GATE_FAILURE="data plane: proxy :${GATE_PROXY_PORT} cannot reach ${GATE_PROBE_URL}"
      return 1
    fi
    GATE_PASSED_CHECKS="${GATE_PASSED_CHECKS}, data-plane"
  fi
  if [[ "$GATE_STRICT" == "1" && "$(effective_core_permission_mode "$DEST")" == "service" ]]; then
    gate_core_fresh || return 1
    GATE_PASSED_CHECKS="${GATE_PASSED_CHECKS}, fresh-core"
    if tun_enabled; then
      if ! gate_tun_listening_since_snapshot; then
        GATE_FAILURE="TUN: the new core has not reported a listening adapter"
        return 1
      fi
      GATE_PASSED_CHECKS="${GATE_PASSED_CHECKS}, tun"
    fi
  fi
  return 0
}

# 同一份字节已装好且健康时，安装是空操作；缺任一条都要走真实安装。
# 与 sparkleInstallSafetyCore.resolveInstallShortCircuit 在「源包新鲜且 CDHash 一致」时同口径，
# 契约测试逐格对齐。参数均为 1/0：App 在运行（或本就不该常驻）· 数据面通 · 内核权限要求已满足。
install_short_circuit_reason() {
  local app_running="$1" data_plane="$2" permission_ok="$3"
  if [[ "$app_running" != "1" ]]; then
    echo "app_not_running"
  elif [[ "$data_plane" != "1" ]]; then
    echo "data_plane_down"
  elif [[ "$permission_ok" != "1" ]]; then
    echo "core_setuid_missing"
  else
    echo "skip"
  fi
}

# 轮询门禁直到通过（返回 0）或超时（返回 1，原因在 GATE_FAILURE）。
# 超时按墙钟算：每轮检查本身（curl 最长 5 秒）也要计入，否则数据面卡住时总时长会被放大数倍。
# `$1` 为每轮调用的保活回调（用来刷新静默标记），可省略。
gate_wait() {
  local keepalive="${1:-}" started
  started="$(date +%s)"
  while true; do
    if gate_check_once; then
      return 0
    fi
    if [[ $(( $(date +%s) - started )) -ge "$GATE_TIMEOUT_SEC" ]]; then
      return 1
    fi
    if [[ -n "$keepalive" ]]; then
      "$keepalive"
    fi
    sleep "$GATE_POLL_SEC"
  done
}
