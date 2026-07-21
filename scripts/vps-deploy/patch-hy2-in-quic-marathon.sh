#!/usr/bin/env bash
# Idempotent: HY2 + TUIC inbound marathon QUIC tuning (KR/JP Cursor VPS).
# Layers: conntrack sysctl · sing-box udp_timeout (1.13+) · idle_timeout+keep_alive_period (1.14+).
# SSOT: Sparkle cursorHy2MarathonKeepaliveCore.ts (3600s idle · 30s keepalive · nudge 40s).
#
# Usage (on VPS as root, no marathon Agent running):
#   bash patch-hy2-in-quic-marathon.sh
#   bash patch-hy2-in-quic-marathon.sh --dry-run
#
# Env: HY2_UDP_TIMEOUT HY2_IDLE_TIMEOUT HY2_KEEPALIVE_PERIOD SING_BOX_ALPHA_VERSION SING_BOX_CONFIG
set -euo pipefail

CONFIG="${SING_BOX_CONFIG:-/etc/sing-box/config.json}"
SYSCTL_FILE="${SINGBOX_SYSCTL_FILE:-/etc/sysctl.d/99-cursor-hy2.conf}"
UDP_TIMEOUT="${HY2_UDP_TIMEOUT:-3600s}"
IDLE_TIMEOUT="${HY2_IDLE_TIMEOUT:-3600s}"
KEEPALIVE="${HY2_KEEPALIVE_PERIOD:-30s}"
ALPHA_VERSION="${SING_BOX_ALPHA_VERSION:-1.14.0-alpha.48}"
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      echo "Usage: bash $0 [--dry-run]"
      exit 0
      ;;
  esac
done

[[ "${EUID:-0}" -eq 0 ]] || { echo "run as root"; exit 1; }
[[ -f "$CONFIG" ]] || { echo "missing $CONFIG"; exit 1; }
command -v jq >/dev/null || { echo "jq required"; exit 1; }

SING_BOX="$(command -v sing-box || echo /usr/local/bin/sing-box)"
[[ -x "$SING_BOX" ]] || { echo "sing-box not found"; exit 1; }

sing_box_version_tuple() {
  local ver="$("$SING_BOX" version 2>/dev/null | head -1 || true)"
  SB_MAJOR="$(printf '%s' "$ver" | sed -nE 's/^sing-box version ([0-9]+)\.([0-9]+).*/\1/p')"
  SB_MINOR="$(printf '%s' "$ver" | sed -nE 's/^sing-box version ([0-9]+)\.([0-9]+).*/\2/p')"
}

sing_box_needs_upgrade() {
  [[ -n "$SB_MAJOR" && ( "$SB_MAJOR" -lt 1 || ( "$SB_MAJOR" -eq 1 && "$SB_MINOR" -lt 14 ) ) ]]
}

apply_sysctl() {
  [[ -f "$SYSCTL_FILE" ]] || { echo "[hy2-quic-marathon] skip sysctl — missing $SYSCTL_FILE"; return 0; }
  modprobe nf_conntrack 2>/dev/null || true
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[hy2-quic-marathon] dry-run — would sysctl -p $SYSCTL_FILE"
    return 0
  fi
  sysctl -p "$SYSCTL_FILE" >/dev/null || true
  local ct_udp ct_stream
  ct_udp="$(sysctl -n net.netfilter.nf_conntrack_udp_timeout 2>/dev/null || echo 0)"
  ct_stream="$(sysctl -n net.netfilter.nf_conntrack_udp_timeout_stream 2>/dev/null || echo 0)"
  echo "[hy2-quic-marathon] conntrack: udp_timeout=${ct_udp} udp_stream=${ct_stream}"
  if [[ "$ct_udp" -lt 3600 || "$ct_stream" -lt 3600 ]]; then
    echo "[hy2-quic-marathon] WARN: conntrack UDP timeouts below 3600 — marathon HY2 may still split-brain"
  fi
}

upgrade_sing_box_if_needed() {
  sing_box_version_tuple
  if ! sing_box_needs_upgrade; then
    return 0
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[hy2-quic-marathon] dry-run — would upgrade sing-box to >=1.14.0 (alpha ${ALPHA_VERSION})"
    return 0
  fi
  echo "[hy2-quic-marathon] upgrading sing-box (stable 1.13.x lacks idle_timeout/keep_alive_period)..."
  bash <(curl -fsSL https://sing-box.app/install.sh) --version "$ALPHA_VERSION"
  SING_BOX="$(command -v sing-box || echo /usr/local/bin/sing-box)"
  sing_box_version_tuple
}

patch_config() {
  if sing_box_needs_upgrade; then
    jq --arg udp "$UDP_TIMEOUT" '
      .inbounds |= map(
        if (.type == "hysteria2" and .tag == "hy2-in") or (.type == "tuic" and .tag == "tuic-in") then
          . + { udp_timeout: $udp }
        else .
        end
      )
    ' "$CONFIG"
  else
    jq --arg udp "$UDP_TIMEOUT" --arg idle "$IDLE_TIMEOUT" --arg ka "$KEEPALIVE" '
      .inbounds |= map(
        if (.type == "hysteria2" and .tag == "hy2-in") or (.type == "tuic" and .tag == "tuic-in") then
          . + { udp_timeout: $udp, idle_timeout: $idle, keep_alive_period: $ka }
        else .
        end
      )
    ' "$CONFIG"
  fi
}

snapshot_quic_inbounds() {
  jq -c '[.inbounds[] | select((.type=="hysteria2" and .tag=="hy2-in") or (.type=="tuic" and .tag=="tuic-in")) | {type,tag,listen_port,udp_timeout,idle_timeout,keep_alive_period}]' "$1"
}

sing_box_version_tuple
echo "[hy2-quic-marathon] sing-box: $("$SING_BOX" version 2>/dev/null | head -1 || echo unknown)"

apply_sysctl
upgrade_sing_box_if_needed
sing_box_version_tuple
echo "[hy2-quic-marathon] sing-box after upgrade check: $("$SING_BOX" version 2>/dev/null | head -1 || echo unknown)"

BEFORE="$(snapshot_quic_inbounds "$CONFIG")"
PATCHED="$(patch_config)"
AFTER="$(snapshot_quic_inbounds <(echo "$PATCHED"))"

echo "[hy2-quic-marathon] before: $BEFORE"
echo "[hy2-quic-marathon] after:  $AFTER"

if [[ "$BEFORE" == "$AFTER" ]]; then
  echo "[hy2-quic-marathon] already patched — no sing-box restart"
  exit 0
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[hy2-quic-marathon] dry-run — would write $CONFIG and restart sing-box once"
  exit 0
fi

BACKUP="${CONFIG}.bak.$(date -u +%Y%m%dT%H%M%SZ)"
cp -a "$CONFIG" "$BACKUP"
echo "[hy2-quic-marathon] backup: $BACKUP"

TMP="$(mktemp)"
echo "$PATCHED" >"$TMP"
"$SING_BOX" check -c "$TMP" || { rm -f "$TMP"; echo "sing-box check failed"; exit 1; }
mv "$TMP" "$CONFIG"

echo "[hy2-quic-marathon] restarting sing-box once (RST all inbounds)"
systemctl restart sing-box
sleep 2
systemctl is-active sing-box >/dev/null && echo "[hy2-quic-marathon] sing-box active" || {
  echo "[hy2-quic-marathon] sing-box not active — restore $BACKUP manually"
  exit 1
}
