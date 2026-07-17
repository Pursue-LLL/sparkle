#!/usr/bin/env bash
# Enable full sing-box audit logging on KR/JP VPS:
# - info-level file log (all inbound/outbound events)
# - clash_api on 127.0.0.1 for live /connections evidence
# - logrotate (30 days, compressed)
set -euo pipefail

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "Run as root: sudo bash $0"
  exit 1
fi

CFG=/etc/sing-box/config.json
BACKUP="${CFG}.bak.$(date +%Y%m%d-%H%M%S)"
LOG_DIR=/var/log/sing-box
LOG_FILE="${LOG_DIR}/sing-box.log"
CLASH_PORT=19090
SECRET_FILE=/root/.sing-box-clash-secret

SING_BOX="$(command -v sing-box || echo /usr/bin/sing-box)"
if [[ ! -x "$SING_BOX" ]]; then
  echo "sing-box binary not found"
  exit 1
fi

cp -a "$CFG" "$BACKUP"
echo "Backed up config → $BACKUP"

mkdir -p "$LOG_DIR"
chmod 755 "$LOG_DIR"
touch "$LOG_FILE"
chmod 640 "$LOG_FILE"

if [[ -f "$SECRET_FILE" ]]; then
  CLASH_SECRET="$(cat "$SECRET_FILE")"
else
  CLASH_SECRET="$(openssl rand -hex 16)"
  echo "$CLASH_SECRET" >"$SECRET_FILE"
  chmod 600 "$SECRET_FILE"
fi

python3 - "$CFG" "$LOG_FILE" "$CLASH_PORT" "$CLASH_SECRET" <<'PY'
import json, sys
cfg_path, log_file, clash_port, clash_secret = sys.argv[1:5]
with open(cfg_path, encoding="utf-8") as f:
    cfg = json.load(f)

cfg["log"] = {
    "disabled": False,
    "level": "info",
    "output": log_file,
    "timestamp": True,
}

exp = cfg.get("experimental") or {}
exp["clash_api"] = {
    "external_controller": f"127.0.0.1:{clash_port}",
    "secret": clash_secret,
}
cfg["experimental"] = exp

with open(cfg_path, "w", encoding="utf-8") as f:
    json.dump(cfg, f, indent=2)
    f.write("\n")
PY

cat >/etc/logrotate.d/sing-box <<ROT
${LOG_FILE} {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
    maxsize 200M
}
ROT

if "$SING_BOX" check -c "$CFG" 2>/dev/null; then
  echo "sing-box check: OK"
else
  echo "sing-box check failed — restoring backup"
  cp -a "$BACKUP" "$CFG"
  exit 1
fi

systemctl restart sing-box
sleep 2

if ! systemctl is-active --quiet sing-box; then
  echo "sing-box failed to start — restoring backup"
  cp -a "$BACKUP" "$CFG"
  systemctl restart sing-box
  exit 1
fi

echo "=== sing-box audit logging enabled ==="
echo "Log file:    $LOG_FILE"
echo "Clash API:   127.0.0.1:${CLASH_PORT} (secret: $SECRET_FILE)"
echo "Live conns:  curl -s -H 'Authorization: Bearer \$(cat $SECRET_FILE)' http://127.0.0.1:${CLASH_PORT}/connections | head -c 2000"
echo "Tail log:    tail -f $LOG_FILE"
