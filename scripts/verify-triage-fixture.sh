#!/usr/bin/env bash
# Hermetic regression gate for triage-cursor-disconnect.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TRIAGE="$ROOT/scripts/triage-cursor-disconnect.sh"
TRIAGE_VPS_LIB="$ROOT/scripts/triage-cursor-vps-lib.sh"
FIXTURE_RID="${TRIAGE_FIXTURE_RID:-be8ce1d8-a4b5-4212-af97-abc30d4df17f}"

fail() { echo "[verify-triage] FAIL: $*" >&2; exit 1; }
pass() { echo "[verify-triage] PASS: $*"; }

[[ -x "$TRIAGE" ]] || fail "missing executable $TRIAGE"
[[ -r "$TRIAGE_VPS_LIB" ]] || fail "missing readable $TRIAGE_VPS_LIB"

bash -n "$TRIAGE" || fail "bash syntax check"
bash -n "$TRIAGE_VPS_LIB" || fail "VPS library syntax check"

FIXTURE_ROOT="$(mktemp -d)"
trap 'rm -rf "$FIXTURE_ROOT"' EXIT
RENDERER_DIR="$FIXTURE_ROOT/cursor/logs/session/window1"
SPARKLE_LOG_DIR="$FIXTURE_ROOT/sparkle-logs"
mkdir -p "$RENDERER_DIR" "$SPARKLE_LOG_DIR" "$FIXTURE_ROOT/guard" "$FIXTURE_ROOT/sparkle" "$FIXTURE_ROOT/out"

cat >"$RENDERER_DIR/renderer.log" <<EOF
2026-07-18 21:08:03.012 [info] [ifm-patch-29 agent-error] requestId="$FIXTURE_RID" originalRequestId="$FIXTURE_RID" attempt=0 actionCase="userMessageAction" willRetry=true errMsg="[aborted] Client network socket disconnected before secure TLS connection was established" connectCode=10 lastSseCase="tokenDelta" lastSseN=25030 activeAgents=1 composerId="fixture-composer" httpVerObserved="1.1" streamPrimarySub="tls-handshake" disconnectPhase="phase1_stream" durationMs=2113554 ts=1784380081940
2026-07-18 21:08:03.012 [info] [ifm-patch-51 disconnect] requestId="$FIXTURE_RID" originalRequestId="$FIXTURE_RID" attempt=0 actionCase="userMessageAction" errMsg="[aborted] Client network socket disconnected before secure TLS connection was established" connectCode=10 ts=1784380081940
EOF

for second in $(seq -w 0 59); do
  echo "time=\"2026-07-18T21:08:${second}.000000000+08:00\" level=info msg=\"[TCP] fixture Cursor --> api2direct.cursor.sh:443 using Cursor 专用[JP-VPS-Reality]\"" \
    >>"$SPARKLE_LOG_DIR/core-2026-7-18.log"
done
cat >>"$SPARKLE_LOG_DIR/core-2026-7-18.log" <<'EOF'
time="2026-07-18T21:08:01.928911000+08:00" level=warning msg="[TCP] dial Cursor 专用 (match Domain/api2.cursor.sh) 198.18.0.1:60308(Cursor Helper (Plugin)) --> api2geo.cursor.sh:443 error: 45.76.104.78:443 connect error: context deadline exceeded"
EOF

log_out="$(
  TRIAGE_OUT_BASE="$FIXTURE_ROOT/out" \
  TRIAGE_RENDERER_ROOT="$FIXTURE_ROOT/cursor" \
  TRIAGE_SPARKLE_LOG_DIR="$SPARKLE_LOG_DIR" \
  TRIAGE_GUARD_DIR="$FIXTURE_ROOT/guard" \
  TRIAGE_SPARKLE_DIR="$FIXTURE_ROOT/sparkle" \
  TRIAGE_MIHOMO_SOCKET="$FIXTURE_ROOT/no-mihomo.sock" \
  TRIAGE_SKIP_VPS=1 \
    "$TRIAGE" "$FIXTURE_RID" "2026-07-18 21:08" 2>&1
)"
OUT="$(echo "$log_out" | sed -nE 's/^\[triage\] Writing bundle to (.+)$/\1/p' | tail -1)"
[[ -n "$OUT" && -d "$OUT" ]] || fail "triage did not produce output dir"

[[ -s "$OUT/incident-local-prefix.txt" ]] || fail "incident-local-prefix.txt empty"
[[ "$(cat "$OUT/incident-local-exact.txt")" == "2026-07-18 21:08:01.940" ]] \
  || fail "millisecond A timestamp was not preserved"
[[ "$(cat "$OUT/incident-renderer-log-exact.txt")" == "2026-07-18 21:08:03.012" ]] \
  || fail "renderer emission timestamp was not preserved separately"
[[ -s "$OUT/renderer-A-full-disconnect.txt" ]] || fail "renderer-A-full-disconnect.txt empty"
[[ -s "$OUT/disconnect-facts.txt" ]] || fail "disconnect-facts.txt empty"
[[ -s "$OUT/core-A-failed-cursor-dials.log" ]] || fail "failed Cursor dial evidence missing"

core_lines="$(wc -l <"$OUT/core-A-cursor-hy2.log" 2>/dev/null | tr -d ' ' || echo 0)"
[[ "${core_lines:-0}" -gt 50 ]] || fail "core-A-cursor-hy2.log too small: ${core_lines:-0}"

if ! rg -q 'ifm-patch-29 agent-error|WritableIterable' "$OUT/renderer-A-full-disconnect.txt"; then
  fail "renderer-A-full-disconnect missing agent-error/WritableIterable"
fi

pass "bundle=$OUT core_lines=$core_lines local=$(cat "$OUT/incident-local-prefix.txt")"
