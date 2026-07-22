#!/usr/bin/env bash
# Migrate VPS to sing-box only (no Xray). Role: cursor | general
set -euo pipefail
ROLE="${1:-general}"
NODE_PREFIX="${2:-VPS}"

if [[ "${EUID:-0}" -ne 0 ]]; then echo "run as root"; exit 1; fi

apt-get update -y >/dev/null 2>&1 || true
apt-get install -y curl openssl uuid-runtime jq >/dev/null 2>&1 || true

if ! command -v sing-box >/dev/null; then
  bash <(curl -fsSL https://sing-box.app/install.sh)
fi
SING_BOX="$(command -v sing-box)"

VLESS_UUID="${VLESS_UUID:-$(uuidgen | tr '[:upper:]' '[:lower:]')}"
HY2_PASS="${HY2_PASS:-$(openssl rand -hex 16)}"
REALITY_SERVER="${REALITY_SERVER:-www.cloudflare.com}"
REALITY_PORT=443
HY2_PORT=8443
TUIC_PORT=8444

KEYPAIR="$("$SING_BOX" generate reality-keypair)"
REALITY_PRIVATE="$(echo "$KEYPAIR" | awk '/PrivateKey/ {print $2}')"
REALITY_PUBLIC="$(echo "$KEYPAIR" | awk '/PublicKey/ {print $2}')"
SHORT_ID="$(openssl rand -hex 4)"

TUIC_UUID=""
TUIC_PASS=""
if [[ "$ROLE" == "general" ]]; then
  TUIC_UUID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
  TUIC_PASS="$(openssl rand -hex 12)"
fi

mkdir -p /etc/sing-box
openssl req -x509 -newkey rsa:2048 -keyout /etc/sing-box/key.pem -out /etc/sing-box/cert.pem \
  -days 3650 -nodes -subj "/CN=${REALITY_SERVER}" 2>/dev/null

INBOUNDS='[
  {
    "type": "vless",
    "tag": "vless-reality-in",
    "listen": "::",
    "listen_port": '"${REALITY_PORT}"',
    "users": [{"uuid": "'"${VLESS_UUID}"'", "flow": "xtls-rprx-vision"}],
    "tls": {
      "enabled": true,
      "server_name": "'"${REALITY_SERVER}"'",
      "reality": {
        "enabled": true,
        "handshake": {"server": "'"${REALITY_SERVER}"'", "server_port": 443},
        "private_key": "'"${REALITY_PRIVATE}"'",
        "short_id": ["'"${SHORT_ID}"'"]
      }
    }
  },
  {
    "type": "hysteria2",
    "tag": "hy2-in",
    "listen": "::",
    "listen_port": '"${HY2_PORT}"',
    "users": [{"password": "'"${HY2_PASS}"'"}],
    "tls": {
      "enabled": true,
      "certificate_path": "/etc/sing-box/cert.pem",
      "key_path": "/etc/sing-box/key.pem"
    },
    "ignore_client_bandwidth": true,
    "udp_timeout": "3600s"
  }'

if [[ "$ROLE" == "general" ]]; then
  INBOUNDS="${INBOUNDS},
  {
    \"type\": \"tuic\",
    \"tag\": \"tuic-in\",
    \"listen\": \"::\",
    \"listen_port\": ${TUIC_PORT},
    \"users\": [{\"uuid\": \"${TUIC_UUID}\", \"password\": \"${TUIC_PASS}\", \"name\": \"tuic\"}],
    \"congestion_control\": \"bbr\",
    \"heartbeat\": \"10s\",
    \"tls\": {
      \"enabled\": true,
      \"certificate_path\": \"/etc/sing-box/cert.pem\",
      \"key_path\": \"/etc/sing-box/key.pem\",
      \"alpn\": [\"h3\", \"h2\", \"http/1.1\"]
    }
  }"
fi

INBOUNDS="${INBOUNDS}
]"

cat >/etc/sing-box/config.json <<EOF
{
  "log": {
    "level": "info",
    "output": "/var/log/sing-box/sing-box.log",
    "timestamp": true
  },
  "inbounds": ${INBOUNDS},
  "outbounds": [{"type": "direct", "tag": "direct"}]
}
EOF

cat >/etc/systemd/system/sing-box.service <<UNIT
[Unit]
Description=sing-box service
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
ExecStart=${SING_BOX} run -c /etc/sing-box/config.json
Restart=on-failure
RestartSec=3
LimitNOFILE=1048576
[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable sing-box
systemctl restart sing-box

# Firewall: Reality/TCP + HY2/TUIC
ufw allow 443/tcp >/dev/null 2>&1 || true
ufw allow "${HY2_PORT}"/udp >/dev/null 2>&1 || true
ufw allow "${HY2_PORT}"/tcp >/dev/null 2>&1 || true
if [[ "$ROLE" == "general" ]]; then
  ufw allow "${TUIC_PORT}"/udp >/dev/null 2>&1 || true
fi

# Retire Xray / legacy hysteria
for svc in xray hysteria-server sing-box-tuic; do
  systemctl stop "$svc" 2>/dev/null || true
  systemctl disable "$svc" 2>/dev/null || true
done

sysctl -w net.core.default_qdisc=fq net.ipv4.tcp_congestion_control=bbr >/dev/null 2>&1 || true

cat >/etc/sysctl.d/99-cursor-hy2.conf <<'SYSCTL'
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.core.rmem_default = 1048576
net.core.wmem_default = 1048576
net.ipv4.udp_mem = 65536 131072 262144
net.netfilter.nf_conntrack_max = 1048576

net.netfilter.nf_conntrack_udp_timeout = 3600
net.netfilter.nf_conntrack_udp_timeout_stream = 3600
SYSCTL
sysctl --system >/dev/null 2>&1 || true

IP="$(curl -fsS4 --max-time 5 ifconfig.me || hostname -I | awk '{print $1}')"
PREFIX="${NODE_PREFIX}"

cat >/root/sparkle-nodes.yaml <<YAML
proxies:
  - name: ${PREFIX}-Reality
    type: vless
    server: ${IP}
    port: ${REALITY_PORT}
    uuid: ${VLESS_UUID}
    network: tcp
    tls: true
    udp: true
    flow: xtls-rprx-vision
    servername: ${REALITY_SERVER}
    reality-opts:
      public-key: ${REALITY_PUBLIC}
      short-id: ${SHORT_ID}
    client-fingerprint: chrome
  - name: ${PREFIX}-HY2
    type: hysteria2
    server: ${IP}
    port: ${HY2_PORT}
    password: ${HY2_PASS}
    sni: ${REALITY_SERVER}
    skip-cert-verify: true
YAML

if [[ "$ROLE" == "general" ]]; then
  cat >>/root/sparkle-nodes.yaml <<YAML
  - name: ${PREFIX}-TUIC
    type: tuic
    server: ${IP}
    port: ${TUIC_PORT}
    uuid: ${TUIC_UUID}
    password: ${TUIC_PASS}
    alpn: [h3]
    udp-relay-mode: native
    congestion-controller: bbr
    skip-cert-verify: true
YAML
fi

echo "MIGRATE_OK role=${ROLE} prefix=${PREFIX}"
systemctl is-active sing-box
cat /root/sparkle-nodes.yaml
