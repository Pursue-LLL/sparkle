#!/usr/bin/env bash
# Collect Mac-side evidence for Cursor disconnect triage (SOP v3).
# Usage: ./scripts/triage-cursor-disconnect.sh <REQUEST_ID> [INCIDENT_LOCAL_PREFIX]
# Example: ./scripts/triage-cursor-disconnect.sh 1a4bfbe0-4126-475a-ac88-c8ebee58dcc3 "2026-07-18 10:03"
# INCIDENT_LOCAL_PREFIX is optional — auto-detected from renderer agent-error when omitted.
set -euo pipefail

RID="${1:-}"
INCIDENT_LOCAL="${2:-}"
INCIDENT_LOCAL_EXACT=""
INCIDENT_UTC_EXACT=""

if [[ -z "$RID" ]]; then
  echo "Usage: $0 <REQUEST_ID> [INCIDENT_LOCAL_PREFIX]" >&2
  echo '  INCIDENT_LOCAL_PREFIX example: "2026-07-18 10:03" (local +08, auto-detected if omitted)' >&2
  exit 1
fi

TS="$(date +%Y%m%dT%H%M%S)"
OUT_BASE="${TRIAGE_OUT_BASE:-${HOME}/Desktop}"
OUT="${OUT_BASE}/cursor-triage-${RID%%-*}-${TS}"
mkdir -p "$OUT"

log() { echo "[triage] $*" >&2; }

RENDERER_SEARCH_ROOT="${TRIAGE_RENDERER_ROOT:-${HOME}/Library/Application Support}"
SPARKLE_LOG_DIR="${TRIAGE_SPARKLE_LOG_DIR:-${HOME}/Library/Application Support/sparkle/logs}"
GUARD_DIR="${TRIAGE_GUARD_DIR:-${HOME}/.cursor-500-guard}"
SPARKLE_DIR="${TRIAGE_SPARKLE_DIR:-${HOME}/.sparkle}"
SOCK="${TRIAGE_MIHOMO_SOCKET:-/tmp/sparkle-mihomo-api.sock}"
SKIP_VPS="${TRIAGE_SKIP_VPS:-0}"

log "Writing bundle to $OUT"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/triage-cursor-vps-lib.sh"

find_renderer_logs() {
  find "$RENDERER_SEARCH_ROOT" \
    -path '*logs/*/window*/renderer*.log' 2>/dev/null \
    | sort -r
}

find_cursor_native_logs() {
  find "$RENDERER_SEARCH_ROOT" \
    -path '*logs/*/window*/*/cursor.requestTraces.log' -o \
    -path '*logs/*/window*/exthost/*/Cursor Structured Logs.log' 2>/dev/null \
    | sort -r
}

utc_exact_to_local() {
  local utc_exact="$1"
  local whole_seconds="${utc_exact%%.*}"
  local millis="${utc_exact##*.}"
  local epoch
  epoch="$(TZ=UTC date -j -f "%Y-%m-%dT%H:%M:%S" "$whole_seconds" "+%s" 2>/dev/null || true)"
  [[ -n "$epoch" ]] || return 1
  printf '%s.%s\n' "$(date -r "$epoch" "+%Y-%m-%d %H:%M:%S")" "$millis"
}

collect_cursor_native_evidence() {
  local trace_hit=0 structured_hit=0 f
  : >"$OUT/cursor-native-request-traces.txt"
  : >"$OUT/cursor-native-structured-retries.txt"

  while IFS= read -r f; do
    [[ -f "$f" ]] || continue
    if [[ "$f" == *cursor.requestTraces.log ]] && rg -q "$RID" "$f" 2>/dev/null; then
      trace_hit=1
      echo "$f" >>"$OUT/cursor-native-trace-paths.txt"
      rg "$RID" "$f" >>"$OUT/cursor-native-request-traces.txt" 2>/dev/null || true
    elif [[ "$f" == *'Cursor Structured Logs.log' ]] && rg -q "$RID" "$f" 2>/dev/null; then
      structured_hit=1
      echo "$f" >>"$OUT/cursor-native-structured-paths.txt"
      rg "$RID" "$f" \
        | rg 'AGENT_ERROR_DIAGNOSTICS|nal_agent_retries|Stream ended without turnEnded|simulated_thinking_timeout' \
        >>"$OUT/cursor-native-structured-retries.txt" 2>/dev/null || true
    fi
  done < <(find_cursor_native_logs)

  if [[ "$trace_hit" -eq 1 ]]; then
    local rpc_error_line utc_exact local_exact
    rpc_error_line="$(rg 'span_completed name="rpc.run".*error=true' \
      "$OUT/cursor-native-request-traces.txt" 2>/dev/null | tail -1 || true)"
    if [[ -n "$rpc_error_line" ]]; then
      printf '%s\n' "$rpc_error_line" >"$OUT/cursor-native-rpc-error.txt"
      utc_exact="$(printf '%s\n' "$rpc_error_line" \
        | sed -nE 's/^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3})Z.*/\1/p')"
      if [[ -n "$utc_exact" && -z "$INCIDENT_LOCAL_EXACT" ]]; then
        local_exact="$(utc_exact_to_local "$utc_exact" || true)"
        if [[ -n "$local_exact" ]]; then
          INCIDENT_UTC_EXACT="$utc_exact"
          INCIDENT_LOCAL_EXACT="$local_exact"
          [[ -n "$INCIDENT_LOCAL" ]] || INCIDENT_LOCAL="${local_exact:0:16}"
          log "Resolved incident A event: $INCIDENT_LOCAL_EXACT local (Cursor native rpc.run error)"
        fi
      fi
    fi
  fi

  [[ "$structured_hit" -eq 1 ]] \
    || log "RID not found in Cursor Structured Logs; Guard retry/notification coverage is unproven"
}

collect_renderer_evidence() {
  local logs=()
  while IFS= read -r f; do
    [[ -n "$f" ]] && logs+=("$f")
  done < <(find_renderer_logs)

  if ((${#logs[@]} == 0)); then
    log "No renderer*.log found under Cursor Application Support"
    return 1
  fi

  log "Scanning ${#logs[@]} renderer*.log files — incl. rotated renderer.N.log"
  local hit=0
  : >"$OUT/renderer-all.txt"
  for f in "${logs[@]}"; do
    if rg -q "$RID" "$f" 2>/dev/null; then
      hit=1
      echo "$f" >>"$OUT/renderer-paths.txt"
      rg "$RID" "$f" >>"$OUT/renderer-all.txt" 2>/dev/null || true
    fi
  done

  if [[ "$hit" -eq 0 ]]; then
    log "RID not found in any renderer*.log"
    return 1
  fi

  rg "$RID" "$OUT/renderer-all.txt" \
    | rg 'agent-error|disconnect|stream-transport|resumeAction|DECIDED_|j-decision|\[ifm-patch-20 HTTP\]' \
    >"$OUT/renderer-key.txt" 2>/dev/null || true

  rg "$RID" "$OUT/renderer-all.txt" \
    | rg 'contextUsage|BLOB_FATAL|blob-not-found|transport-failure|stream_terminated|toolCallStarted|WritableIterable|LostConnection|marathon-stream|quic-stream' \
    >"$OUT/renderer-disconnect-context.txt" 2>/dev/null || true

  # Always recover the millisecond A timestamp from renderer. A user-supplied
  # minute narrows the match; it must not silently downgrade A to :00.000.
  local ts_line=""
  if [[ -n "$INCIDENT_LOCAL" ]]; then
    ts_line="$(rg --no-filename 'ifm-patch-29 agent-error|ifm-patch-51 disconnect' \
      "$OUT/renderer-all.txt" 2>/dev/null | rg "^${INCIDENT_LOCAL}" | head -1 || true)"
  else
    ts_line="$(rg --no-filename 'ifm-patch-29 agent-error|ifm-patch-51 disconnect|transport-failure.*WritableIterable' \
      "$OUT/renderer-all.txt" 2>/dev/null | head -1 || true)"
  fi
  if [[ -n "$ts_line" ]]; then
    local detected_exact renderer_log_exact event_ts_ms event_epoch event_millis
    renderer_log_exact="$(echo "$ts_line" | sed -nE 's/^([0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}).*/\1/p')"
    event_ts_ms="$(echo "$ts_line" | rg -o 'ts=[0-9]{13}' | tail -1 | cut -d= -f2 || true)"
    detected_exact=""
    if [[ "$event_ts_ms" =~ ^[0-9]{13}$ ]]; then
      event_epoch="${event_ts_ms:0:10}"
      event_millis="${event_ts_ms:10:3}"
      detected_exact="$(date -r "$event_epoch" '+%Y-%m-%d %H:%M:%S').${event_millis}"
      echo "$event_ts_ms" >"$OUT/incident-event-ts-ms.txt"
    elif [[ -n "$renderer_log_exact" ]]; then
      detected_exact="$renderer_log_exact"
    fi
    if [[ -n "$detected_exact" ]]; then
      INCIDENT_LOCAL_EXACT="$detected_exact"
      [[ -n "$INCIDENT_LOCAL" ]] || INCIDENT_LOCAL="${INCIDENT_LOCAL_EXACT:0:16}"
      log "Resolved incident A event: $INCIDENT_LOCAL_EXACT local (renderer log: ${renderer_log_exact:-n/a})"
      echo "$INCIDENT_LOCAL" >"$OUT/incident-local-prefix.txt"
      echo "$INCIDENT_LOCAL_EXACT" >"$OUT/incident-local-exact.txt"
      [[ -n "$renderer_log_exact" ]] \
        && echo "$renderer_log_exact" >"$OUT/incident-renderer-log-exact.txt"
    fi
  fi

  # Full disconnect excerpt from the log file that contains agent-error @ A
  while IFS= read -r logfile; do
    [[ -f "$logfile" ]] || continue
    local line
    line="$(rg -n 'ifm-patch-29 agent-error|ifm-patch-51 disconnect' "$logfile" 2>/dev/null \
      | rg "$RID" | head -1 | cut -d: -f1 || true)"
    [[ -n "$line" ]] || continue
    local start=$((line - 40))
    ((start < 1)) && start=1
    local end=$((line + 40))
    sed -n "${start},${end}p" "$logfile" >"$OUT/renderer-A-full-disconnect.txt" 2>/dev/null || true
    echo "$logfile" >"$OUT/renderer-disconnect-source.txt"
    break
  done <"$OUT/renderer-paths.txt"
  return 0
}

local_prefix_to_utc() {
  local local_prefix="$1"
  local normalized="${local_prefix}:00"
  if ! date -j -f "%Y-%m-%d %H:%M:%S" "$normalized" "+%s" >/dev/null 2>&1; then
    return 1
  fi
  local epoch
  epoch="$(date -j -f "%Y-%m-%d %H:%M:%S" "$normalized" "+%s")"
  date -u -r "$epoch" "+%Y-%m-%dT%H:%M"
}

local_exact_to_utc() {
  local local_exact="$1"
  local whole_seconds="${local_exact%%.*}"
  local millis="${local_exact##*.}"
  local epoch
  epoch="$(date -j -f "%Y-%m-%d %H:%M:%S" "$whole_seconds" "+%s" 2>/dev/null || true)"
  [[ -n "$epoch" ]] || return 1
  printf '%s.%s\n' "$(date -u -r "$epoch" "+%Y-%m-%dT%H:%M:%S")" "$millis"
}

build_utc_second_pattern() {
  local utc_exact="$1"
  local radius_seconds="${2:-5}"
  local whole_seconds="${utc_exact%%.*}"
  local epoch offset pattern=""
  epoch="$(TZ=UTC date -j -f "%Y-%m-%dT%H:%M:%S" "$whole_seconds" "+%s" 2>/dev/null || true)"
  [[ -n "$epoch" ]] || return 1
  for offset in $(seq "-$radius_seconds" "$radius_seconds"); do
    [[ -n "$pattern" ]] && pattern="${pattern}|"
    pattern="${pattern}^\\+0000 $(TZ=UTC date -u -r "$((epoch + offset))" "+%Y-%m-%d %H:%M:%S")"
  done
  printf '%s\n' "$pattern"
}

collect_guard_evidence() {
  while IFS= read -r src; do
    if [[ -f "$src" ]]; then
      local parent base
      parent="$(basename "$(dirname "$src")")"
      base="${parent}-$(basename "$src")"
      rg "$RID" "$src" >"$OUT/guard-${base}" 2>/dev/null || true
    fi
  done < <(find "$GUARD_DIR" -maxdepth 4 -type f \
    \( -name 'billing-guard-events.jsonl' \
    -o -name 'validated-ledger.v1.jsonl' \
    -o -name 'invalid-events.v1.jsonl' \
    -o -name 'billing-correlation-audit.jsonl' \) 2>/dev/null | sort)

  if [[ -f "$GUARD_DIR/profiles/3.1.15/workbench-gate165-live.json" ]]; then
    cp "$GUARD_DIR/profiles/3.1.15/workbench-gate165-live.json" "$OUT/guard-workbench-gate165-live.json" 2>/dev/null || true
  fi
  [[ -f "$GUARD_DIR/workbench-gate165-live.json" ]] \
    && cp "$GUARD_DIR/workbench-gate165-live.json" "$OUT/guard-workbench-gate165-live-root.json" 2>/dev/null || true
}

collect_sparkle_jsonl_at_a() {
  local utc_prefix="$1"
  [[ -n "$utc_prefix" ]] || return 0
  local prefixes=()
  while IFS= read -r p; do
    [[ -n "$p" ]] && prefixes+=("$p")
  done < <(expand_utc_minute_prefixes "$utc_prefix")

  for src in \
    "$SPARKLE_DIR/api2-probe-ledger.jsonl" \
    "$SPARKLE_DIR/network-stability-events.jsonl" \
    "$SPARKLE_DIR/agent-transport-failures.jsonl"; do
    if [[ ! -f "$src" ]]; then
      continue
    fi
    base="$(basename "$src")"
    : >"$OUT/sparkle-A-window-${base}"
    for p in "${prefixes[@]}"; do
      local utc_esc="${p//-/\\-}"
      rg "\"ts\":\"${utc_esc}" "$src" >>"$OUT/sparkle-A-window-${base}" 2>/dev/null || true
    done
  done
}

expand_utc_minute_prefixes() {
  local utc_prefix="$1"
  local window_min="${2:-2}"
  local normalized="${utc_prefix}:00"
  local epoch offset
  epoch="$(TZ=UTC date -j -f "%Y-%m-%dT%H:%M:%S" "$normalized" "+%s" 2>/dev/null || true)"
  if [[ -z "$epoch" ]]; then
    echo "$utc_prefix"
    return 0
  fi
  for offset in $(seq "-$window_min" "$window_min"); do
    TZ=UTC date -r "$((epoch + offset * 60))" "+%Y-%m-%dT%H:%M"
  done
}

collect_agent_transport_by_ts() {
  [[ -f "$OUT/renderer-disconnect-context.txt" ]] || return 0
  local ts_ms
  ts_ms="$(rg -o 'ts=[0-9]{10,}' "$OUT/renderer-disconnect-context.txt" 2>/dev/null | head -1 | cut -d= -f2 || true)"
  [[ -n "$ts_ms" ]] || return 0
  echo "$ts_ms" >"$OUT/disconnect-ts-ms.txt"
  if [[ -f "$SPARKLE_DIR/agent-transport-failures.jsonl" ]]; then
    rg "$ts_ms" "$SPARKLE_DIR/agent-transport-failures.jsonl" \
      >"$OUT/sparkle-agent-transport-by-ts.jsonl" 2>/dev/null || true
  fi
}

write_disconnect_facts() {
  [[ -f "$OUT/renderer-disconnect-context.txt" ]] || return 0
  {
    echo "# disconnect-facts @ A"
    rg 'ifm-patch-29 agent-error|ifm-patch-51 disconnect|ifm-patch-99 transport-failure|BLOB_FATAL|retry-coordinator' \
      "$OUT/renderer-disconnect-context.txt" 2>/dev/null | head -20 || true
    echo ""
    if [[ -s "$OUT/core-A-cursor-hy2.log" ]]; then
      echo "core_hy2_lines=$(wc -l <"$OUT/core-A-cursor-hy2.log" | tr -d ' ')"
      rg -o 'Cursor 专用\[[^]]+\]' "$OUT/core-A-cursor-hy2.log" 2>/dev/null \
        | sort | uniq -c | sort -nr | head -5 || true
    fi
    if [[ -s "$OUT/core-A-failed-cursor-dials.log" ]]; then
      echo ""
      echo "# failed Cursor dials @ A minute"
      cat "$OUT/core-A-failed-cursor-dials.log"
    fi
  } >"$OUT/disconnect-facts.txt"
}

collect_app_core_at_a() {
  local local_prefix="$1"
  local utc_prefix="$2"
  [[ -n "$local_prefix" || -n "$utc_prefix" ]] || return 0

  local core_iso=""
  if [[ -n "$local_prefix" ]]; then
    core_iso="${local_prefix/ /T}"
  fi
  local utc_esc=""
  if [[ -n "$utc_prefix" ]]; then
    utc_esc="${utc_prefix//-/\\-}"
  fi

  for f in "$SPARKLE_LOG_DIR"/app-*.log; do
    [[ -f "$f" ]] || continue
    if [[ -n "$utc_prefix" ]]; then
      while IFS= read -r p; do
        [[ -n "$p" ]] || continue
        local p_esc="${p//-/\\-}"
        rg "${p_esc}" "$f" \
          | rg 'CursorTransportHealth|L0|L1|hung|VpsL4Probe|Triangulation|defer|protocol upgrade|mihomoChangeProxy|hung_scan_heartbeat' \
          >>"$OUT/sparkle-app-A-window.log" 2>/dev/null || true
      done < <(expand_utc_minute_prefixes "$utc_prefix")
    fi
  done

  if [[ -n "$core_iso" ]]; then
    local core_esc="${core_iso//-/\\-}"
    rg "${core_esc}" "$SPARKLE_LOG_DIR"/core-*.log 2>/dev/null \
      | rg 'api2|HY2|Reality|TUIC|warn|error|connection|closed|Cursor' \
      >"$OUT/core-A-cursor-hy2.log" || true
    rg "${core_esc}" "$SPARKLE_LOG_DIR"/core-*.log 2>/dev/null \
      | rg 'level=(warning|error).*\[TCP\] dial .*Cursor.*--> api2(geo|direct)?\.cursor\.sh:443.*(connect error|timeout|EOF|reset)' \
      >"$OUT/core-A-failed-cursor-dials.log" || true
  fi

  if [[ -f "$OUT/sparkle-app-A-window.log" ]]; then
    local count
    count="$(wc -l <"$OUT/sparkle-app-A-window.log" | tr -d ' ')"
    echo "CTHC/app lines @ A window UTC ${utc_prefix:-n/a}: ${count}" >"$OUT/app-log-blindspot.txt"
    if [[ "$count" -eq 0 ]]; then
      echo "WARNING: zero CTHC/app lines @ A — hung_scan may early-return when hung=0; check ±5min manually" \
        >>"$OUT/app-log-blindspot.txt"
    fi
  else
    echo "CTHC/app lines @ A window: 0 — no app log match for UTC ${utc_prefix:-n/a}" >"$OUT/app-log-blindspot.txt"
    echo "WARNING: app-log blind spot @ A — see CURSOR-DISCONNECT-TRIAGE.md" >>"$OUT/app-log-blindspot.txt"
  fi
}

write_risk_review() {
  {
    echo "# RISK-REVIEW (anti-shallow)"
    echo ""
    echo "## 最可能翻车点"
    echo "1. IFM reasonType=proxy-network 但 proxyNode 空 — 不可盲信标签"
    echo "2. ledger @ A 全绿 + 长流断 — split-brain / L3 QUIC 瞬断"
    echo "3. B 时刻 VPS/UI 正常不能否定 A 断连"
    echo "4. events vps_node_snapshots 是单点快照，≠ UI history[-8]"
    echo "5. agent-transport-failures 常缺 RID（Guard 写入缺口）"
    echo ""
    echo "## CONFIDENCE 档位"
    echo "- definitive: 仅 max-steps-cap / SSH L4 硬失败 / 同刻 ledger+core 双证"
    echo "- partial: HY2/TUIC + marathon + probe 全绿 @ A"
    echo "- inconclusive: 无 A 窗口 ledger 且无 renderer 断连行"
  } >"$OUT/RISK-REVIEW.md"
}

write_report_skeleton() {
  local utc_prefix="$1"
  {
    echo "# Cursor Disconnect Triage Report"
    echo ""
    echo "- Request ID: \`$RID\`"
    echo "- Collected: $(date -u '+%Y-%m-%dT%H:%M:%SZ') UTC / $(date '+%Y-%m-%d %H:%M:%S %Z') local"
    echo "- INCIDENT local: ${INCIDENT_LOCAL:-<auto-detect failed — pass 2nd arg>}"
    echo "- INCIDENT UTC prefix: ${utc_prefix:-<n/a>}"
    echo "- Bundle: \`$OUT\`"
    echo ""
    echo "## 【断连罪魁祸首】（必填）"
    echo ""
    echo "**层级**："
    echo "**链路**："
    echo "**机制**："
    echo "**节点/协议**："
    echo "**CONFIDENCE**：definitive | partial | inconclusive"
    echo ""
    echo "## 逐步证据链"
    echo ""
    echo "（每步：结论 + 证据路径/行/原文 — 见 CURSOR-DISCONNECT-TRIAGE.md Anti-shallow）"
    echo ""
    echo "预填线索（需人工核实）："
    if [[ -s "$OUT/renderer-disconnect-context.txt" ]]; then
      echo "- renderer contextUsage/BLOB: see \`renderer-disconnect-context.txt\`"
    fi
    if [[ -s "$OUT/core-A-cursor-hy2.log" ]]; then
      local hy2_burst
      hy2_burst="$(rg -c 'HY2|hysteria' "$OUT/core-A-cursor-hy2.log" 2>/dev/null || echo 0)"
      echo "- core @ A HY2-related lines: ${hy2_burst} (see \`core-A-cursor-hy2.log\`)"
    fi
    if [[ -s "$OUT/app-log-blindspot.txt" ]]; then
      echo "- app-log: \`$(cat "$OUT/app-log-blindspot.txt" | head -1)\`"
    fi
    echo ""
    echo "## 定责摘要"
    echo ""
    echo "## 附件"
    echo "- LOG-MATRIX-A.md"
    echo "- RISK-REVIEW.md"
    echo "- disconnect-facts.txt"
    echo "- renderer-A-full-disconnect.txt"
    echo ""
    echo "Handbook: CURSOR-DISCONNECT-TRIAGE.md"
  } >"$OUT/REPORT.md"
}

# --- main ---
collect_renderer_evidence || true
collect_cursor_native_evidence
collect_guard_evidence

INCIDENT_UTC=""
if [[ -z "$INCIDENT_LOCAL_EXACT" && -n "$INCIDENT_LOCAL" ]]; then
  INCIDENT_LOCAL_EXACT="${INCIDENT_LOCAL}:00.000"
fi
if [[ -n "$INCIDENT_LOCAL_EXACT" ]]; then
  echo "$INCIDENT_LOCAL_EXACT" >"$OUT/incident-local-exact.txt"
  INCIDENT_UTC_EXACT="$(local_exact_to_utc "$INCIDENT_LOCAL_EXACT" || true)"
  [[ -n "$INCIDENT_UTC_EXACT" ]] && echo "$INCIDENT_UTC_EXACT" >"$OUT/incident-utc-exact.txt"
fi
if [[ -n "$INCIDENT_LOCAL" ]]; then
  echo "$INCIDENT_LOCAL" >"$OUT/incident-local-prefix.txt"
  INCIDENT_UTC="$(local_prefix_to_utc "$INCIDENT_LOCAL" || true)"
  [[ -n "$INCIDENT_UTC" ]] && echo "$INCIDENT_UTC" >"$OUT/incident-utc-prefix.txt"
fi

collect_sparkle_jsonl_at_a "$INCIDENT_UTC"
collect_app_core_at_a "$INCIDENT_LOCAL" "$INCIDENT_UTC"
collect_agent_transport_by_ts
write_disconnect_facts
collect_mihomo_state
if [[ "$SKIP_VPS" != "1" ]]; then
  run_vps_v52
else
  log "Skipping VPS collection (TRIAGE_SKIP_VPS=1)"
fi

if [[ -f "$SPARKLE_DIR/agent-transport-failures.jsonl" ]]; then
  rg "$RID" "$SPARKLE_DIR/agent-transport-failures.jsonl" \
    >"$OUT/sparkle-agent-transport-by-rid.jsonl" 2>/dev/null || true
fi

if [[ -f "$SPARKLE_DIR/api2-probe-ledger.jsonl" ]]; then
  tail -40 "$SPARKLE_DIR/api2-probe-ledger.jsonl" >"$OUT/sparkle-ledger-tail.jsonl"
fi

write_log_matrix "$INCIDENT_UTC"
write_risk_review
write_report_skeleton "$INCIDENT_UTC"

log "Done. Open $OUT/REPORT.md — fill 【断连罪魁祸首】 using LOG-MATRIX-A.md + RISK-REVIEW.md"
