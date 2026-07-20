#!/usr/bin/env bash
# Mihomo and VPS evidence collectors for triage-cursor-disconnect.sh.

collect_mihomo_state() {
  [[ -S "$SOCK" ]] || return 0

  curl -s --unix-socket "$SOCK" http://localhost/providers/proxies \
    | python3 -c "
import json,sys
nodes=['JP-VPS-HY2','JP-VPS-Reality','JP-VPS-TUIC','KR-VPS-HY2','KR-VPS-Reality','KR-VPS-TUIC']
d=json.load(sys.stdin)
for pid, prov in d.get('providers',{}).items():
    if not pid.endswith('-vps'):
        continue
    for px in prov.get('proxies',[]):
        if px.get('name') not in nodes:
            continue
        last8=[{'time':h.get('time'),'delay':h.get('delay',0)} for h in (px.get('history') or [])[-8:]]
        print(px['name'], 'provider=', pid, 'last8=', json.dumps(last8, ensure_ascii=False), 'alive=', px.get('alive'))
" >"$OUT/mihomo-vps-history-last8.txt" 2>/dev/null || true

  curl -s --unix-socket "$SOCK" http://localhost/proxies \
    | python3 -c "
import json,sys
d=json.load(sys.stdin)
for name, detail in d.get('proxies',{}).items():
    if 'Cursor' in name or 'cursor' in name.lower():
        print(name, 'now=', detail.get('now'), 'type=', detail.get('type'))
" >"$OUT/mihomo-cursor-groups.txt" 2>/dev/null || true
}
resolve_active_vps_ssh_host() {
  local node=""
  if [[ -s "${OUT:-}/sparkle-A-window-api2-probe-ledger.jsonl" ]]; then
    node="$(
      rg '"node":"' "${OUT}/sparkle-A-window-api2-probe-ledger.jsonl" 2>/dev/null \
        | head -1 \
        | sed -E 's/.*"node":"([^"]+)".*/\1/' \
        || true
    )"
  fi
  if [[ -z "$node" && -s "${OUT:-}/core-A-cursor-hy2.log" ]]; then
    node="$(
      rg -o 'Cursor 专用\[[^]]+\]' "${OUT}/core-A-cursor-hy2.log" 2>/dev/null \
        | sort | uniq -c | sort -nr | head -1 \
        | sed -E 's/.*\[(.+)\]/\1/' \
        || true
    )"
  fi
  case "$node" in
    KR-*) echo "kr-vps" ;;
    JP-*) echo "jp-vps" ;;
    *) echo "" ;;
  esac
}

collect_vps_singbox_at_a() {
  local host="$1"
  local out_file="$2"
  [[ -n "${INCIDENT_UTC:-}" ]] || return 0
  [[ -n "$host" ]] || return 0
  ssh -o BatchMode=yes -o ConnectTimeout=8 "$host" true 2>/dev/null || return 0

  local prefixes=() p utc_date grep_re exact_re log_files
  while IFS= read -r p; do
    [[ -n "$p" ]] && prefixes+=("$p")
  done < <(expand_utc_minute_prefixes "$INCIDENT_UTC" 2)
  utc_date="${INCIDENT_UTC%T*}"
  grep_re=""
  for p in "${prefixes[@]}"; do
    local hm="${p#*T}"
    [[ -n "$grep_re" ]] && grep_re="${grep_re}|"
    grep_re="${grep_re}^\\+0000 ${utc_date} ${hm}:"
  done
  log_files="/var/log/sing-box/sing-box.log /var/log/sing-box/sing-box.log.1"
  exact_re="$(build_utc_second_pattern "$INCIDENT_UTC_EXACT" 5 2>/dev/null || true)"
  local grep_b64 exact_b64
  grep_b64="$(printf '%s' "$grep_re" | base64 | tr -d '\n')"
  exact_b64="$(printf '%s' "$exact_re" | base64 | tr -d '\n')"
  ssh -o BatchMode=yes -o ConnectTimeout=25 "$host" bash -s "$grep_b64" "$exact_b64" "$log_files" \
    >"$out_file" 2>/dev/null <<'REMOTE_SINGBOX' || true
pat="$(printf '%s' "$1" | base64 -d)"
exact_pat="$(printf '%s' "$2" | base64 -d)"
files=($3)
match() {
  local f
  for f in "${files[@]}"; do
    [[ -f "$f" ]] || continue
    grep -E "$pat" "$f" 2>/dev/null || true
  done
}

exact_match() {
  [[ -n "$exact_pat" ]] || return 0
  local f
  for f in "${files[@]}"; do
    [[ -f "$f" ]] || continue
    grep -E "$exact_pat" "$f" 2>/dev/null || true
  done
}
echo "$(match | wc -l | tr -d ' ')"
echo "---grep-pattern---"
echo "$pat"
echo "---error-warn-full---"
match | grep -E ' (ERROR|WARN) ' || true
echo "---A-plus-minus-5s-raw---"
exact_match
echo "---reality-handshake-failures-full---"
match | grep -iE 'vless-reality-in.*TLS handshake|REALITY:|invalid connection' || true
echo "---reality-inbound-per-second---"
match | grep -i 'vless-reality-in.*inbound connection from' \
  | cut -c7-25 | sort | uniq -c | sort -k2,2 -k3,3
echo "---reality-success-duration-top-30---"
match | grep -i 'vless-reality-in.*inbound connection to' \
  | awk '{d=$6; gsub(/]/,"",d); if(d ~ /ms$/){sub(/ms$/,"",d); ms=d}else if(d ~ /m/){split(d,a,"m"); sub(/s$/,"",a[2]); ms=(a[1]*60+a[2])*1000}else{sub(/s$/,"",d); ms=d*1000} printf "%.3f\t%s\n",ms,$0}' \
  | sort -nr | head -30 | cut -f2-
echo "---reality-sample---"
match | grep -i 'vless-reality-in' | head -30
echo "---mux-sample---"
match | grep -i mux | head -30
echo "---hy2-sample---"
match | grep -i hysteria2 | head -30
echo "---raw-window-full---"
match
REMOTE_SINGBOX

  local epoch since until
  epoch="$(TZ=UTC date -j -f "%Y-%m-%dT%H:%M:%S" "${INCIDENT_UTC}:00" "+%s" 2>/dev/null || true)"
  if [[ -n "$epoch" ]]; then
    since="$(TZ=UTC date -u -r "$((epoch - 600))" "+%Y-%m-%d %H:%M:%S")"
    until="$(TZ=UTC date -u -r "$((epoch + 600))" "+%Y-%m-%d %H:%M:%S")"
    ssh -o BatchMode=yes -o ConnectTimeout=15 "$host" \
      "journalctl -u sing-box --since '${since}' --until '${until}' --no-pager 2>/dev/null | grep -iE 'Started|Stopped|restart|failed' | head -40" \
      >"${out_file%.log}-v55-restart-A.log" 2>/dev/null || true
  fi
}

collect_vps_safe_topology() {
  local host="$1"
  [[ -n "$host" ]] || return 0
  ssh -o BatchMode=yes -o ConnectTimeout=10 "$host" \
    'systemctl show sing-box -p ActiveState -p ActiveEnterTimestamp -p NRestarts -p ExecStart --no-pager; sing-box version | head -1' \
    >"$OUT/vps-active-service-state.txt" 2>/dev/null || true
  ssh -o BatchMode=yes -o ConnectTimeout=10 "$host" \
    "jq -c '[.inbounds[] | select(.tag == \"vless-reality-in\") | {type,tag,listen,listen_port,user_count:(.users|length),flow_values:([.users[].flow] | unique),tls:{enabled:.tls.enabled,reality:{enabled:.tls.reality.enabled,handshake_server:.tls.reality.handshake.server,handshake_port:.tls.reality.handshake.server_port,max_time_difference:.tls.reality.max_time_difference}}}]' /etc/sing-box/config.json" \
    >"$OUT/vps-active-reality-topology.json" 2>/dev/null || true
}

run_vps_v52() {
  {
    echo "# V5.2 @ collection time $(date '+%Y-%m-%d %H:%M:%S %Z')"
    for host in kr-vps jp-vps; do
      if ssh -o BatchMode=yes -o ConnectTimeout=8 "$host" \
        'systemctl is-active sing-box && curl -o /dev/null -s -w '"'"'%{http_code} %{time_total}s\n'"'"' --connect-timeout 10 https://api2.cursor.sh' \
        >"$OUT/vps-${host}-api2.txt" 2>"$OUT/vps-${host}-api2.err"; then
        echo "${host}: $(cat "$OUT/vps-${host}-api2.txt")"
      else
        echo "${host}: SSH failed — see vps-${host}-api2.err"
      fi
    done
  } >"$OUT/vps-v52-summary.txt" 2>&1 || true

  local active_host
  active_host="$(resolve_active_vps_ssh_host)"
  echo "$active_host" >"$OUT/vps-active-ssh-host.txt"
  if [[ -n "$active_host" ]]; then
    collect_vps_singbox_at_a "$active_host" "$OUT/vps-active-singbox-A-window.log"
    collect_vps_safe_topology "$active_host"
  else
    log "Active VPS unresolved; collecting both VPS logs instead of guessing"
    collect_vps_singbox_at_a "kr-vps" "$OUT/vps-kr-singbox-A-window.log"
    collect_vps_singbox_at_a "jp-vps" "$OUT/vps-jp-singbox-A-window.log"
  fi
  if [[ "$active_host" == "kr-vps" ]]; then
    cp "$OUT/vps-active-singbox-A-window.log" "$OUT/vps-kr-singbox-A-window.log" 2>/dev/null || true
  elif [[ "$active_host" == "jp-vps" ]]; then
    cp "$OUT/vps-active-singbox-A-window.log" "$OUT/vps-jp-singbox-A-window.log" 2>/dev/null || true
  fi
}

write_log_matrix() {
  local utc_prefix="$1"
  {
    echo "# LOG-MATRIX @ A"
    echo ""
    echo "| Signal | Path | @ A | Notes |"
    echo "|--------|------|-----|-------|"
    echo "| renderer disconnect | renderer-paths.txt / renderer-A-full-disconnect.txt | $(test -s "$OUT/renderer-A-full-disconnect.txt" && echo yes || echo no) | incl. rotated renderer.N.log |"
    echo "| Cursor native rpc error | cursor-native-rpc-error.txt | $(test -s "$OUT/cursor-native-rpc-error.txt" && echo yes || echo no) | authoritative fallback when IFM renderer event is absent |"
    echo "| Cursor native retry chain | cursor-native-structured-retries.txt | $(test -s "$OUT/cursor-native-structured-retries.txt" && echo yes || echo no) | attempts + final client retry decision |"
    echo "| contextUsage / BLOB | renderer-disconnect-context.txt | $(test -s "$OUT/renderer-disconnect-context.txt" && echo yes || echo no) | |"
    echo "| guard billing | guard-billing-guard-events.jsonl | $(test -s "$OUT/guard-billing-guard-events.jsonl" 2>/dev/null && echo yes || echo no) | |"
    echo "| guard invalid-events | guard-invalid-events.v1.jsonl | $(test -s "$OUT/guard-invalid-events.v1.jsonl" 2>/dev/null && echo yes || echo no) | BLOB_FATAL_BLOCK |"
    echo "| ledger @ A | sparkle-A-window-api2-probe-ledger.jsonl | $(test -s "$OUT/sparkle-A-window-api2-probe-ledger.jsonl" 2>/dev/null && echo yes || echo no) | UTC prefix ${utc_prefix:-n/a} |"
    echo "| events @ A | sparkle-A-window-network-stability-events.jsonl | $(test -s "$OUT/sparkle-A-window-network-stability-events.jsonl" 2>/dev/null && echo yes || echo no) | QUIC mid-stream may be empty |"
    echo "| agent-transport @ A | sparkle-A-window-agent-transport-failures.jsonl | $(test -s "$OUT/sparkle-A-window-agent-transport-failures.jsonl" 2>/dev/null && echo yes || echo no) | Guard may not write HTTP resume |"
    echo "| agent-transport by RID | sparkle-agent-transport-by-rid.jsonl | $(test -s "$OUT/sparkle-agent-transport-by-rid.jsonl" 2>/dev/null && echo yes || echo no) | |"
    echo "| app CTHC @ A | sparkle-app-A-window.log | $(test -s "$OUT/sparkle-app-A-window.log" 2>/dev/null && echo yes || echo no) | see app-log-blindspot.txt |"
    echo "| core @ A local +08 | core-A-cursor-hy2.log | $(test -s "$OUT/core-A-cursor-hy2.log" 2>/dev/null && echo yes || echo no) | filter ${INCIDENT_LOCAL:-n/a} |"
    echo "| mihomo VPS history | mihomo-vps-history-last8.txt | $(test -s "$OUT/mihomo-vps-history-last8.txt" 2>/dev/null && echo yes || echo no) | UI 测速 history[-8] |"
    echo "| VPS V5.2 | vps-v52-summary.txt | $(test -s "$OUT/vps-v52-summary.txt" 2>/dev/null && echo yes || echo no) | bypass TUN |"
    echo "| VPS sing-box @ A (active) | vps-active-singbox-A-window.log | $(test -s "$OUT/vps-active-singbox-A-window.log" 2>/dev/null && echo yes || echo no) | host=$(cat "$OUT/vps-active-ssh-host.txt" 2>/dev/null || echo n/a) |"
    echo "| VPS service state | vps-active-service-state.txt | $(test -s "$OUT/vps-active-service-state.txt" 2>/dev/null && echo yes || echo no) | NRestarts + ActiveEnterTimestamp |"
    echo "| Reality safe topology | vps-active-reality-topology.json | $(test -s "$OUT/vps-active-reality-topology.json" 2>/dev/null && echo yes || echo no) | no UUID/private_key/short_id values |"
  } >"$OUT/LOG-MATRIX-A.md"
}
