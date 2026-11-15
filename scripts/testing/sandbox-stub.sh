#!/bin/bash
# 安装流水线沙箱的命令桩：单文件分发器，按被调用的名字（符号链接名）模拟系统命令。
#
# 真实的 mv / rm / ditto / find / stat / sed 等文件系统命令照常执行（事务靠 rename 的真实语义），
# 只有会碰到真实系统的命令（osascript、launchctl、codesign、pgrep、curl、dscl……）被替换成
# 对 $SIM_DIR 里状态文件的读写，并支持三类注入：
#   SIM_FAIL_*   让某个命令失败             SIM_KILL_AT  在某个点 kill -9 安装进程（断电/强杀）
#   SIM_HOLD_AT  在某个点停住直到被放行     （给信号测试一个稳定的「正在运行」窗口）
# 新包的运行表现写在包自己的 Contents/Resources/sim-behavior 里：回滚后 DEST 里换成旧包，
# 行为也就跟着换成旧包的，不需要测试里再手动切换。
set -u

NAME="$(basename "$0")"
# 桩自己用的 rm/cat/sed 必须是真命令：沙箱 PATH 里同名的是桩，会递归并污染调用记录。
PATH=/usr/bin:/bin:/usr/sbin:/sbin
SIM="${SIM_DIR:?SIM_DIR must point at the simulation state directory}"
POLL_SEC=0.05

record() { printf '%s %s\n' "$NAME" "$*" >> "$SIM/calls.log"; }

# 命中崩溃点就 kill -9 安装进程并返回 0，调用方据此决定是否放弃后续动作。
crash_if() {
  if [[ "${SIM_KILL_AT:-}" == "$1" ]]; then
    kill -9 "$(cat "$SIM_INSTALLER_PID_FILE")" 2>/dev/null
    /bin/sleep 0.2
    return 0
  fi
  return 1
}

hold_if() {
  local waited=0
  if [[ "${SIM_HOLD_AT:-}" != "$1" ]]; then
    return 0
  fi
  : > "$SIM/held"
  while [[ ! -e "$SIM/release" && "$waited" -lt 200 ]]; do
    /bin/sleep "$POLL_SEC"
    waited=$((waited + 1))
  done
}

gui_running() { [[ -f "$SIM/gui.pid" ]]; }
core_running() { [[ -f "$SIM/core.pid" ]]; }
stop_core() {
  rm -f "$SIM/core.pid" "$SIM/core.path" "$SIM/core.start" "$SIM/core.traffic"
  echo down > "$SIM/proxy"
}

# 读新包的行为开关；缺省值代表「一切正常」。
behavior() {
  local value
  value="$(sed -n "s/^$2=//p" "$1/Contents/Resources/sim-behavior" 2>/dev/null | head -1)"
  echo "${value:-$3}"
}

core_log_file() { echo "$SPARKLE_APP_DATA_DIR/logs/core-2026-11-15.log"; }

start_core() {
  local app="$1"
  # 与真实 App 一致：核心已在运行就直接接管，不会重启它。
  if core_running; then
    return 0
  fi
  echo 5151 > "$SIM/core.pid"
  echo "$app/Contents/Resources/sidecar/mihomo" > "$SIM/core.path"
  date +%s > "$SIM/core.start"
  behavior "$app" traffic ok > "$SIM/core.traffic"
  behavior "$app" proxy up > "$SIM/proxy"
  if [[ "$(behavior "$app" tun listening)" == "listening" ]]; then
    mkdir -p "$SPARKLE_APP_DATA_DIR/logs"
    echo "[TUN] Tun adapter listening at: utun9" >> "$(core_log_file)"
  fi
}

launch_app() {
  local app="$1"
  if [[ "$(behavior "$app" launch ok)" == "fails" ]]; then
    return 0
  fi
  # headless：macOS 26 默认模式，引导完内核 GUI 就退出，没有 GUI 进程是正常的。
  if [[ "$(behavior "$app" headless 0)" != "1" ]]; then
    echo 4242 > "$SIM/gui.pid"
  fi
  if [[ "$(behavior "$app" core starts)" != "never" ]]; then
    start_core "$app"
  fi
}

format_etime() {
  local total="$1" d h m s
  d=$((total / 86400)); h=$(((total % 86400) / 3600)); m=$(((total % 3600) / 60)); s=$((total % 60))
  if [[ "$d" -gt 0 ]]; then printf '%d-%02d:%02d:%02d\n' "$d" "$h" "$m" "$s"
  elif [[ "$h" -gt 0 ]]; then printf '%02d:%02d:%02d\n' "$h" "$m" "$s"
  else printf '%02d:%02d\n' "$m" "$s"; fi
}

last_arg() { eval "echo \"\${$#}\""; }

case "$NAME" in
  codesign)
    record "$@"
    app="$(last_arg "$@")"
    case "${1:-}" in
      --verify)
        [[ -d "$app" ]] || exit 1
        [[ ! -e "$app/Contents/BAD_SIGNATURE" ]] || exit 1
        if [[ -n "${SIM_VERIFY_FAIL_FOR:-}" && "$app" == *"$SIM_VERIFY_FAIL_FOR"* ]]; then exit 1; fi
        exit 0 ;;
      -dv)
        [[ -d "$app" ]] || { echo "$app: No such file or directory" >&2; exit 1; }
        hash="$(cat "$app/Contents/CDHASH")"
        if [[ -n "${SIM_CDHASH_FOR:-}" && "$app" == *"${SIM_CDHASH_FOR%%=*}"* ]]; then hash="${SIM_CDHASH_FOR#*=}"; fi
        { echo "Executable=$app/Contents/MacOS/Sparkle"; echo "Identifier=app.sparkle.sim"
          echo "CDHash=$hash"; echo "Signature=adhoc"; echo "Info.plist entries=1"; } >&2
        exit 0 ;;
    esac
    exit 0 ;;

  ditto)
    record "$@"
    case "${SIM_FAIL_DITTO:-0}" in
      1) echo "ditto: No space left on device (simulated)" >&2; exit 1 ;;
      partial)
        mkdir -p "$(last_arg "$@")"
        echo partial > "$(last_arg "$@")/partial"
        echo "ditto: No space left on device (simulated, half-copied)" >&2
        exit 1 ;;
    esac
    /usr/bin/ditto "$@" || exit $?
    crash_if ditto
    exit 0 ;;

  mv)
    record "$@"
    point=""
    if [[ $# -ge 2 ]]; then
      second_last="$(eval "echo \"\${$(($# - 1))}\"")"
      case "$(basename "$second_last")>$(basename "$(last_arg "$@")")" in
        Sparkle.app\>.Sparkle.prev) point=mv_dest_to_prev ;;
        .Sparkle.staging\>Sparkle.app) point=mv_stage_to_dest ;;
        .Sparkle.prev\>Sparkle.app) point=mv_prev_to_dest ;;
        Sparkle.app\>.Sparkle.failed) point=mv_dest_to_failed ;;
        Sparkle.app\>Sparkle.app.bak.*) point=mv_user_copy ;;
      esac
    fi
    if [[ -n "$point" && "${SIM_FAIL_MV:-}" == "$point" ]]; then
      echo "mv: rename failed: Operation not permitted (simulated)" >&2; exit 1
    fi
    /bin/mv "$@" || exit $?
    if [[ -n "$point" ]]; then crash_if "$point"; fi
    exit 0 ;;

  rm)
    record "$@"
    is_prev=0
    if [[ "$(basename "$(last_arg "$@")")" == ".Sparkle.prev" ]]; then is_prev=1; fi
    if [[ "$is_prev" == "1" ]] && crash_if rm_prev_before; then exit 137; fi
    /bin/rm "$@"; rc=$?
    if [[ "$is_prev" == "1" ]]; then crash_if rm_prev_after; fi
    exit "$rc" ;;

  df)
    if [[ -n "${SIM_FREE_KB:-}" ]]; then
      echo "Filesystem 1024-blocks Used Available Capacity iused ifree %iused Mounted on"
      echo "/dev/sim 1000000000 1 ${SIM_FREE_KB} 1% 0 0 0% /"
      exit 0
    fi
    exec /bin/df "$@" ;;

  osascript)
    record "$@"
    script="${2:-}"
    case "$script" in
      *'to quit'*)
        if [[ "${SIM_QUIT_REFUSES:-0}" != "1" ]]; then
          rm -f "$SIM/gui.pid"
          if [[ "${SIM_QUIT_LEAVES_CORE:-0}" != "1" ]]; then stop_core; fi
        fi
        crash_if quit; hold_if quit
        exit 0 ;;
      *'open POSIX file'*)
        launch_app "$(printf '%s' "$script" | sed -n 's/.*open POSIX file "\(.*\)".*/\1/p')"
        crash_if launch; hold_if launch
        exit 0 ;;
      *'with administrator privileges'*)
        if [[ "${SIM_ELEVATION:-deny}" == "grant" ]]; then
          chmod u+s "$(printf '%s' "$script" | sed -n 's/.*chmod +sx \\"\(.*\)\\".*/\1/p')"
          exit 0
        fi
        echo "execution error: User canceled. (-128)" >&2
        exit 1 ;;
    esac
    exit 0 ;;

  pgrep)
    case "${2:-}" in
      Sparkle) if gui_running; then cat "$SIM/gui.pid"; exit 0; fi ;;
      *) if core_running && [[ "$(basename "$(cat "$SIM/core.path")")" == "${2:-}" ]]; then cat "$SIM/core.pid"; exit 0; fi ;;
    esac
    exit 1 ;;

  pkill)
    record "$@"
    if [[ "${SIM_PKILL_FAILS:-0}" != "1" ]]; then rm -f "$SIM/gui.pid"; fi
    exit 0 ;;

  ps)
    pid=""; field=""
    while [[ $# -gt 0 ]]; do
      case "$1" in -o) field="$2"; shift 2 ;; -p) pid="$2"; shift 2 ;; *) shift ;; esac
    done
    if core_running && [[ "$pid" == "$(cat "$SIM/core.pid")" ]]; then
      case "$field" in
        comm=) cat "$SIM/core.path" ;;
        etime=) format_etime $(( $(date +%s) - $(cat "$SIM/core.start") )) ;;
      esac
      exit 0
    fi
    if gui_running && [[ "$pid" == "$(cat "$SIM/gui.pid")" ]]; then
      [[ "$field" != "comm=" ]] || echo "/Applications/Sparkle.app/Contents/MacOS/Sparkle"
      exit 0
    fi
    exec /bin/ps -o "$field" -p "$pid" ;;

  nc)
    [[ "$(cat "$SIM/proxy" 2>/dev/null)" == "up" ]] ;;

  curl)
    [[ "$(cat "$SIM/proxy" 2>/dev/null)" == "up" && "$(cat "$SIM/network" 2>/dev/null)" == "ok" \
      && "$(cat "$SIM/core.traffic" 2>/dev/null)" == "ok" ]] || exit 7 ;;

  launchctl)
    record "$@"
    label="${2##*/}"
    case "${1:-}" in
      print)
        [[ -f "$SIM/launchd.$label" ]] || exit 113
        printf 'gui/501/%s = {\n\tpath = %s\n}\n' "$label" "$(cat "$SIM/launchd.$label")" ;;
      bootstrap)
        [[ "${SIM_FAIL_BOOTSTRAP:-0}" != "1" ]] || { echo "Bootstrap failed: 5: Input/output error" >&2; exit 5; }
        # 与真实 launchd 一致：同一个 label 已加载时再 bootstrap 会失败，必须先 bootout。
        [[ ! -f "$SIM/launchd.$(basename "$3" .plist)" ]] || { echo "Bootstrap failed: 5: Input/output error" >&2; exit 5; }
        printf '%s' "$3" > "$SIM/launchd.$(basename "$3" .plist)" ;;
      bootout)
        # SIM_FAIL_BOOTOUT=1：bootout 没能卸掉 job（返回非零，job 仍在），安装脚本用 `|| true` 吞掉了这个失败。
        [[ "${SIM_FAIL_BOOTOUT:-0}" != "1" ]] || exit 5
        rm -f "$SIM/launchd.$label" ;;
    esac
    exit 0 ;;

  defaults)
    cat "$(dirname "$2")/version" 2>/dev/null || exit 1 ;;

  sw_vers) echo "${SIM_MACOS:-26.5.2}" ;;

  uname)
    case "${1:-}" in
      -s) echo "${SIM_UNAME_S:-Darwin}" ;;
      -r) echo "${SIM_DARWIN:-25.5.0}" ;;
      *) exec /usr/bin/uname "$@" ;;
    esac ;;

  dscl) echo "NFSHomeDirectory: ${SIM_LOGIN_HOME:?}" ;;

  spctl)
    echo "$(last_arg "$@"): rejected" >&2
    exit 3 ;;

  sleep) /bin/sleep "$(awk -v s="${1:-0}" 'BEGIN { printf "%.3f", s / 50 }')" ;;

  tsx)
    record "$@"
    case "$(basename "${1:-}")" in
      sparkle-service-core-stop.mts)
        if [[ "${SIM_CORE_STOP_FAILS:-0}" == "1" ]]; then echo "[core-stop] FAILED: simulated"; exit 2; fi
        stop_core
        echo "[core-stop] stopped (status=204)" ;;
      sparkle-stale-mihomo-socket-hygiene.mts) ;;
      *) echo "sandbox: unexpected tsx script: $*" >&2; exit 99 ;;
    esac
    exit 0 ;;

  *)
    echo "sandbox-stub: no behaviour defined for '$NAME'" >&2
    exit 127 ;;
esac
