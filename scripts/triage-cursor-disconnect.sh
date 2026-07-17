#!/usr/bin/env bash
# Collect Mac-side evidence for Cursor disconnect triage (SOP v2).
# Usage: ./scripts/triage-cursor-disconnect.sh <REQUEST_ID> [INCIDENT_UTC_PREFIX]
# Example: ./scripts/triage-cursor-disconnect.sh 810a64d5-deac-403e-af1b-85fa9d6edb22 2026-07-17T14:47
set -euo pipefail

RID="${1:-}"
INCIDENT_UTC="${2:-}"

if [[ -z "$RID" ]]; then
  echo "Usage: $0 <REQUEST_ID> [INCIDENT_UTC_PREFIX]" >&2
  exit 1
fi

TS="$(date +%Y%m%dT%H%M%S)"
OUT="${HOME}/Desktop/cursor-triage-${RID%%-*}-${TS}"
mkdir -p "$OUT"

log() { echo "[triage] $*" >&2; }

APP_LOG_GLOB="${HOME}/Library/Application Support/sparkle/logs/app-$(date +%Y)-*.log"
CORE_LOG_GLOB="${HOME}/Library/Application Support/sparkle/logs/core-$(date +%Y)-*.log"
GUARD_DIR="${HOME}/.cursor-500-guard"
SPARKLE_DIR="${HOME}/.sparkle"

log "Writing bundle to $OUT"

{
  echo "# Cursor Disconnect Triage Report"
  echo ""
  echo "- Request ID: \`$RID\`"
  echo "- Collected: $(date -u '+%Y-%m-%dT%H:%M:%SZ') UTC / $(date '+%Y-%m-%d %H:%M:%S %Z') local"
  echo "- INCIDENT_UTC filter: ${INCIDENT_UTC:-<not set — set 2nd arg for A-window ledger/events>}"
  echo ""
  echo "## §6 Template (fill after VPS @ A)"
  echo ""
  echo '```'
  echo "Request: $RID"
  echo "A: <local> / <UTC>"
  echo ""
  echo "[Cursor] errMsg=… lastSse=… duration=… activeAgents=… fault_class=…"
  echo "[Guard] mode=… decision=… attempt=…"
  echo "[Sparkle] L0/L1=… active=… probe_ok=… hung=… recovery=…"
  echo "[VPS @ A] V5.1=… V5.2-KR=… V5.2-JP=… V5.4=… V5.5=…"
  echo ""
  echo "ROOT CAUSE: …   CONFIDENCE: definitive|partial|inconclusive"
  echo "NOT: …"
  echo "USER ACTION: …"
  echo '```'
  echo ""
  echo "## Manual VPS @ A (required unless max-steps-cap)"
  echo ""
  echo "See CURSOR-DISCONNECT-TRIAGE.md §V5 and VPS-CONNECT.md."
  echo ""
  echo '```bash'
  echo "# V5.2 — must bypass TUN fake-ip (do not trust ledger scope=vps alone)"
  echo 'ssh kr-vps "systemctl is-active sing-box && curl -o /dev/null -s -w '"'"'KR api2 %{time_total}s %{http_code}\n'"'"' --connect-timeout 10 https://api2.cursor.sh"'
  echo 'ssh jp-vps "systemctl is-active sing-box && curl -o /dev/null -s -w '"'"'JP api2 %{time_total}s %{http_code}\n'"'"' --connect-timeout 10 https://api2.cursor.sh"'
  echo '```'
} >"$OUT/REPORT.md"

# Renderer logs (Cursor 3.1.15 + default)
RENDERER_LOGS=()
while IFS= read -r f; do
  RENDERER_LOGS+=("$f")
done < <(find "${HOME}/Library/Application Support" -path '*Cursor*data/logs/*/window*/renderer.log' 2>/dev/null | head -20)

if ((${#RENDERER_LOGS[@]} > 0)); then
  log "Scanning ${#RENDERER_LOGS[@]} renderer.log files"
  for f in "${RENDERER_LOGS[@]}"; do
    if rg -q "$RID" "$f" 2>/dev/null; then
      rg "$RID" "$f" >"$OUT/renderer-all.txt" 2>/dev/null || true
      rg "$RID" "$f" | rg 'agent-error|disconnect|stream-transport|resumeAction|DECIDED_|j-decision|\[ifm-patch-20 HTTP\]' \
        >"$OUT/renderer-key.txt" 2>/dev/null || true
      echo "$f" >"$OUT/renderer-path.txt"
      break
    fi
  done
fi

# Guard
for src in \
  "$GUARD_DIR/billing-guard-events.jsonl" \
  "$GUARD_DIR/runtime-events/validated-ledger.v1.jsonl" \
  "$GUARD_DIR/billing-correlation-audit.jsonl"; do
  if [[ -f "$src" ]]; then
    base="$(basename "$src")"
    rg "$RID" "$src" >"$OUT/guard-${base}" 2>/dev/null || true
  fi
done

if [[ -f "$GUARD_DIR/profiles/3.1.15/workbench-gate165-live.json" ]]; then
  cp "$GUARD_DIR/profiles/3.1.15/workbench-gate165-live.json" "$OUT/guard-workbench-gate165-live.json" 2>/dev/null || true
fi
[[ -f "$GUARD_DIR/workbench-gate165-live.json" ]] && cp "$GUARD_DIR/workbench-gate165-live.json" "$OUT/guard-workbench-gate165-live-root.json" 2>/dev/null || true

# Sparkle jsonl
if [[ -n "$INCIDENT_UTC" ]]; then
  UTC_ESC="${INCIDENT_UTC//-/\\-}"
  for src in \
    "$SPARKLE_DIR/api2-probe-ledger.jsonl" \
    "$SPARKLE_DIR/network-stability-events.jsonl" \
    "$SPARKLE_DIR/agent-transport-failures.jsonl"; do
    if [[ -f "$src" ]]; then
      base="$(basename "$src")"
      rg "\"ts\":\"${UTC_ESC}" "$src" >"$OUT/sparkle-A-window-${base}" 2>/dev/null || true
    fi
  done
fi

rg "$RID" "$SPARKLE_DIR/agent-transport-failures.jsonl" >"$OUT/sparkle-agent-transport-by-rid.jsonl" 2>/dev/null || true

# App/core log — CTHC near A if UTC prefix given
if [[ -n "$INCIDENT_UTC" ]]; then
  for f in $APP_LOG_GLOB; do
    [[ -f "$f" ]] || continue
    rg "${INCIDENT_UTC}" "$f" | rg 'CursorTransportHealth|L0|L1|hung|VpsL4Probe|Triangulation' \
      >"$OUT/sparkle-app-A-window.log" 2>/dev/null || true
    break
  done
fi

# Latest ledger tail (context)
if [[ -f "$SPARKLE_DIR/api2-probe-ledger.jsonl" ]]; then
  tail -40 "$SPARKLE_DIR/api2-probe-ledger.jsonl" >"$OUT/sparkle-ledger-tail.jsonl"
fi

log "Done. Open $OUT/REPORT.md and fill §V5 VPS @ A."
