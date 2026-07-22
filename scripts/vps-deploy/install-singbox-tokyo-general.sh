#!/usr/bin/env bash
# Tokyo VPS — General traffic node (Reality + Hysteria2 + TUIC)
set -euo pipefail

NODE_TAG="JP-Tokyo"
REALITY_DEST="www.cloudflare.com:443"
REALITY_SERVER="www.cloudflare.com"
REALITY_PORT=443
HY2_PORT=36712
TUIC_PORT=8443

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "Run as root: sudo bash $0"
  exit 1
fi

apt-get update -y
apt-get install -y curl jq uuid-runtime openssl qrencode

bash <(curl -fsSL https://sing-box.app/install.sh) || true
SING_BOX="$(command -v sing-box || echo /usr/local/bin/sing-box)"
if [[ ! -x "$SING_BOX" ]]; then
  echo "sing-box install failed"
  exit 1
fi

VLESS_UUID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
TUIC_UUID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
HY2_PASS="$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 20)"
TUIC_PASS="$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 20)"
KEYPAIR="$("$SING_BOX" generate reality-keypair)"
REALITY_PRIVATE="$(echo "$KEYPAIR" | awk '/PrivateKey/ {print $2}')"
REALITY_PUBLIC="$(echo "$KEYPAIR" | awk '/PublicKey/ {print $2}')"
SHORT_ID="$(openssl rand -hex 4)"

mkdir -p /etc/sing-box
cat >/etc/sing-box/config.json <<EOF
{
  "log": { "level": "info", "timestamp": true },
  "inbounds": [
    {
      "type": "vless",
      "tag": "vless-reality-in",
      "listen": "::",
      "listen_port": ${REALITY_PORT},
      "users": [{ "uuid": "${VLESS_UUID}", "flow": "xtls-rprx-vision" }],
      "tls": {
        "enabled": true,
        "server_name": "${REALITY_SERVER}",
        "reality": {
          "enabled": true,
          "handshake": { "server": "${REALITY_SERVER}", "server_port": 443 },
          "private_key": "${REALITY_PRIVATE}",
          "short_id": ["${SHORT_ID}"]
        }
      }
    },
    {
      "type": "hysteria2",
      "tag": "hy2-in",
      "listen": "::",
      "listen_port": ${HY2_PORT},
      "users": [{ "password": "${HY2_PASS}" }],
      "tls": {
        "enabled": true,
        "certificate_path": "/etc/sing-box/fullchain.pem",
        "key_path": "/etc/sing-box/privkey.pem"
      },
      "ignore_client_bandwidth": true,
      "udp_timeout": "3600s"
    },
    {
      "type": "tuic",
      "tag": "tuic-in",
      "listen": "::",
      "listen_port": ${TUIC_PORT},
      "users": [
        { "uuid": "${TUIC_UUID}", "password": "${TUIC_PASS}", "name": "tuic-user" }
      ],
      "tls": {
        "enabled": true,
        "certificate_path": "/etc/sing-box/fullchain.pem",
        "key_path": "/etc/sing-box/privkey.pem"
      }
    }
  ],
  "outbounds": [{ "type": "direct", "tag": "direct" }]
}
EOF

openssl req -x509 -newkey rsa:2048 -keyout /etc/sing-box/privkey.pem -out /etc/sing-box/fullchain.pem \
  -days 3650 -nodes -subj "/CN=${REALITY_SERVER}" 2>/dev/null

cat >/etc/systemd/system/sing-box.service <<'UNIT'
[Unit]
Description=sing-box service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/sing-box run -c /etc/sing-box/config.json
Restart=on-failure
RestartSec=5
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable sing-box
systemctl restart sing-box

if command -v ufw >/dev/null 2>&1; then
  ufw allow 22/tcp
  ufw allow ${REALITY_PORT}/tcp
  ufw allow ${HY2_PORT}/udp
  ufw allow ${TUIC_PORT}/udp
  ufw --force enable || true
fi

IP="$(curl -fsS4 --max-time 5 ifconfig.me || hostname -I | awk '{print $1}')"

OUT="/root/${NODE_TAG}-nodes.txt"
{
  echo "=== ${NODE_TAG} General (Reality + HY2 + TUIC) ==="
  echo "IP: ${IP}"
  echo ""
  echo "[Reality] name=${NODE_TAG}-Reality"
  echo "vless://${VLESS_UUID}@${IP}:${REALITY_PORT}?encryption=none&flow=xtls-rprx-vision&security=reality&sni=${REALITY_SERVER}&fp=chrome&pbk=${REALITY_PUBLIC}&sid=${SHORT_ID}&type=tcp#${NODE_TAG}-Reality"
  echo ""
  echo "[Hysteria2] name=${NODE_TAG}-HY2"
  echo "hy2://${HY2_PASS}@${IP}:${HY2_PORT}?sni=${REALITY_SERVER}&insecure=1#${NODE_TAG}-HY2"
  echo ""
  echo "[TUIC] name=${NODE_TAG}-TUIC"
  echo "tuic://${TUIC_UUID}:${TUIC_PASS}@${IP}:${TUIC_PORT}?congestion_control=bbr&udp_relay_mode=native&alpn=h3&allow_insecure=1#${NODE_TAG}-TUIC"
} | tee "$OUT"

echo "Done. Saved to $OUT"
systemctl --no-pager status sing-box | head -5
