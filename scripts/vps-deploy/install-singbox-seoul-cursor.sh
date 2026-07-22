#!/usr/bin/env bash
# Seoul VPS — Cursor-dedicated node (Reality + Hysteria2, stable TCP-first)
set -euo pipefail

NODE_TAG="KR-Seoul-Cursor"
REALITY_DEST="www.microsoft.com:443"
REALITY_SERVER="www.microsoft.com"
HY2_PORT=36712
REALITY_PORT=443

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

UUID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
HY2_PASS="$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 20)"
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
      "users": [{ "uuid": "${UUID}", "flow": "xtls-rprx-vision" }],
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
  ufw --force enable || true
fi

IP="$(curl -fsS4 --max-time 5 ifconfig.me || hostname -I | awk '{print $1}')"

OUT="/root/${NODE_TAG}-nodes.txt"
{
  echo "=== ${NODE_TAG} Cursor Dedicated ==="
  echo "IP: ${IP}"
  echo ""
  echo "[Reality] name=${NODE_TAG}-Reality"
  echo "vless://${UUID}@${IP}:${REALITY_PORT}?encryption=none&flow=xtls-rprx-vision&security=reality&sni=${REALITY_SERVER}&fp=chrome&pbk=${REALITY_PUBLIC}&sid=${SHORT_ID}&type=tcp#${NODE_TAG}-Reality"
  echo ""
  echo "[Hysteria2] name=${NODE_TAG}-HY2"
  echo "hy2://${HY2_PASS}@${IP}:${HY2_PORT}?sni=${REALITY_SERVER}&insecure=1#${NODE_TAG}-HY2"
  echo ""
  echo "Sparkle override snippet (proxies):"
  echo "  - { name: ${NODE_TAG}-Reality, type: vless, server: ${IP}, port: ${REALITY_PORT}, uuid: ${UUID}, network: tcp, tls: true, udp: true, flow: xtls-rprx-vision, servername: ${REALITY_SERVER}, reality-opts: { public-key: ${REALITY_PUBLIC}, short-id: ${SHORT_ID} }, client-fingerprint: chrome }"
  echo "  - { name: ${NODE_TAG}-HY2, type: hysteria2, server: ${IP}, port: ${HY2_PORT}, password: ${HY2_PASS}, sni: ${REALITY_SERVER}, skip-cert-verify: true }"
} | tee "$OUT"

echo "Done. Saved to $OUT"
systemctl --no-pager status sing-box | head -5
