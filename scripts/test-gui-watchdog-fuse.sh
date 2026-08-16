#!/usr/bin/env bash
# Pre-install gate: GUI watchdog crash-loop fuse must count ledger rows without node.
set -euo pipefail

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

CRASH_LEDGER="${TMP_DIR}/gui-crash-ledger.jsonl"
WINDOW_SEC=60
PYTHON=/usr/bin/python3

now_iso="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
old_iso="$(date -u -v-2H +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null || date -u -d '2 hours ago' +%Y-%m-%dT%H:%M:%S.000Z)"

cat > "$CRASH_LEDGER" <<EOF
{"ts":"${old_iso}","reason":"unexpected_exit","pid":null,"restart_count_window":1}
{"ts":"${now_iso}","reason":"unexpected_exit","pid":null,"restart_count_window":1}
{"ts":"${now_iso}","reason":"unexpected_exit","pid":null,"restart_count_window":2}
{"ts":"${now_iso}","reason":"unexpected_exit","pid":null,"restart_count_window":3}
EOF

now=$(date +%s)
cutoff=$((now - WINDOW_SEC))

recent="$("$PYTHON" - "$CRASH_LEDGER" "$cutoff" <<'PY'
import json
import sys
from datetime import datetime

path = sys.argv[1]
cutoff = float(sys.argv[2])
count = 0
with open(path, encoding="utf-8") as handle:
    for line in handle:
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if row.get("reason") != "unexpected_exit":
            continue
        ts_raw = row.get("ts")
        if not isinstance(ts_raw, str) or not ts_raw:
            continue
        normalized = ts_raw.replace("Z", "+00:00")
        ts = datetime.fromisoformat(normalized).timestamp()
        if ts >= cutoff:
            count += 1
print(count)
PY
)"

if [[ "$recent" -lt 3 ]]; then
  echo "[test-gui-watchdog-fuse] FAIL: expected recent>=3 got=${recent}" >&2
  exit 1
fi

echo "[test-gui-watchdog-fuse] PASS: fuse counter recent=${recent}"
