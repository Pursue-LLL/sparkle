#!/usr/bin/env bash
# Post-install verification: VPS provider split and retired JP Reality transport.
# Exit 0 = PASS, non-zero = FAIL (do not claim fix until this passes).
set -euo pipefail

MIN_VERSION="1.26.39"
SOCK="/tmp/sparkle-mihomo-api.sock"
APP_PLIST="/Applications/Sparkle.app/Contents/Info.plist"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

version_ge() {
  local current=$1 required=$2
  local IFS=.
  read -r c1 c2 c3 <<<"$current"
  read -r r1 r2 r3 <<<"$required"
  for pair in "$c1:$r1" "$c2:$r2" "$c3:$r3"; do
    local a=${pair%%:*} b=${pair##*:}
    a=${a:-0}; b=${b:-0}
    if ((10#$a > 10#$b)); then return 0; fi
    if ((10#$a < 10#$b)); then return 1; fi
  done
  return 0
}

[[ -f "$APP_PLIST" ]] || fail "Sparkle.app not found at /Applications"
VER=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP_PLIST" 2>/dev/null || echo "0")
version_ge "$VER" "$MIN_VERSION" || fail "Sparkle version $VER < $MIN_VERSION (fix not installed)"

[[ -S "$SOCK" ]] || fail "mihomo socket missing — start Sparkle core first"

python3 <<'PY'
import json, subprocess, sys

sock = "/tmp/sparkle-mihomo-api.sock"
raw = subprocess.check_output(
    ["curl", "-s", "--unix-socket", sock, "http://localhost/providers/proxies"],
    text=True,
)
data = json.loads(raw)
providers = data.get("providers") or {}

vps_ids = [k for k in providers if k.endswith("-vps")]
if not vps_ids:
    sys.exit("no provider ending with -vps")

vps_id = sorted(vps_ids)[0]
base_id = vps_id[: -len("-vps")]
vps_leaves = providers[vps_id].get("proxies") or []
commercial = providers.get(base_id, {}).get("proxies") or []

if len(vps_leaves) != 6:
    sys.exit(f"vps provider {vps_id} has {len(vps_leaves)} leaves, want 6")

vps_names = {p.get("name") for p in vps_leaves}
expected = {
    "JP-VPS-HY2", "JP-VPS-TLS", "JP-VPS-TUIC",
    "KR-VPS-HY2", "KR-VPS-Reality", "KR-VPS-TUIC",
}
if not expected.issubset(vps_names):
    sys.exit(f"missing canonical VPS nodes in {vps_id}: {sorted(vps_names)}")
if "JP-VPS-Reality" in vps_names:
    sys.exit(f"retired JP-VPS-Reality reappeared in {vps_id}")

for name in vps_names:
    if name and "VPS" in name and name in {p.get("name") for p in commercial}:
        sys.exit(f"VPS node {name} still duplicated in commercial provider {base_id}")

if len(commercial) >= 70:
    # still valid if subscription large; key is no VPS names in commercial
    dup = [n for n in vps_names if n in {p.get("name") for p in commercial}]
    if dup:
        sys.exit(f"commercial provider still contains VPS: {dup}")

print(f"providers OK: {base_id}={len(commercial)} commercial, {vps_id}={len(vps_leaves)} vps")
PY

pass "Sparkle $VER + mihomo VPS provider split verified"
