#!/usr/bin/env bash
# Idempotent: 2GB swap + vm.swappiness=10 for 1GB Cursor VPS (OOM reboot guard).
# Does NOT restart sing-box — safe during marathon when only adding swap.
#
# Usage (on VPS as root):
#   bash setup-vps-swap-oom-guard.sh
#   bash setup-vps-swap-oom-guard.sh --dry-run
#
# From Mac (Sparkle repo root, when SSH works):
#   ssh jp-vps 'bash -s' < scripts/vps-deploy/setup-vps-swap-oom-guard.sh
set -euo pipefail

SWAP_FILE="${VPS_SWAP_FILE:-/swapfile}"
SWAP_SIZE_GB="${VPS_SWAP_SIZE_GB:-2}"
SYSCTL_FILE="${VPS_SYSCTL_FILE:-/etc/sysctl.d/99-cursor-hy2.conf}"
SWAPPINESS="${VPS_SWAPPINESS:-10}"
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

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "Run as root: sudo bash $0"
  exit 1
fi

run() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] $*"
  else
    "$@"
  fi
}

echo "[swap-guard] before:"
free -h || true
swapon --show 2>/dev/null || true

echo "[swap-guard] OOM history (current boot):"
journalctl -b --no-pager 2>/dev/null | grep -iE 'oom|out of memory|killed process' | tail -10 || echo "  (no oom lines)"

if swapon --show 2>/dev/null | grep -qF "$SWAP_FILE"; then
  echo "[swap-guard] swap already active at $SWAP_FILE"
elif [[ -f "$SWAP_FILE" ]]; then
  echo "[swap-guard] activating existing $SWAP_FILE"
  run chmod 600 "$SWAP_FILE"
  run swapon "$SWAP_FILE"
else
  echo "[swap-guard] creating ${SWAP_SIZE_GB}G swap at $SWAP_FILE"
  run fallocate -l "${SWAP_SIZE_GB}G" "$SWAP_FILE"
  run chmod 600 "$SWAP_FILE"
  run mkswap "$SWAP_FILE"
  run swapon "$SWAP_FILE"
fi

if ! grep -qF "$SWAP_FILE" /etc/fstab 2>/dev/null; then
  echo "[swap-guard] persist fstab"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] echo '$SWAP_FILE none swap sw 0 0' >> /etc/fstab"
  else
    echo "$SWAP_FILE none swap sw 0 0" >> /etc/fstab
  fi
fi

run mkdir -p "$(dirname "$SYSCTL_FILE")"
if ! grep -q 'vm.swappiness' "$SYSCTL_FILE" 2>/dev/null; then
  echo "[swap-guard] append vm.swappiness=$SWAPPINESS to $SYSCTL_FILE"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] echo 'vm.swappiness=$SWAPPINESS' >> $SYSCTL_FILE"
  else
    echo "vm.swappiness=$SWAPPINESS" >> "$SYSCTL_FILE"
  fi
fi

if [[ "$DRY_RUN" -eq 0 ]]; then
  sysctl -p "$SYSCTL_FILE" 2>/dev/null || true
fi

echo "[swap-guard] after:"
if [[ "$DRY_RUN" -eq 0 ]]; then
  free -h
  swapon --show
  systemctl is-active sing-box 2>/dev/null || true
fi

# Optional: whitelist operator IP so fail2ban never blocks SSH again.
OPERATOR_IP="${VPS_OPERATOR_IP:-}"
if [[ -n "$OPERATOR_IP" ]]; then
  JAIL_LOCAL="/etc/fail2ban/jail.local"
  echo "[swap-guard] fail2ban whitelist $OPERATOR_IP"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] write $JAIL_LOCAL ignoreip += $OPERATOR_IP"
  else
    fail2ban-client set sshd unbanip "$OPERATOR_IP" 2>/dev/null || true
    if [[ ! -f "$JAIL_LOCAL" ]]; then
      cat >"$JAIL_LOCAL" <<EOF
[sshd]
enabled = true
maxretry = 10
bantime = 1h
ignoreip = 127.0.0.1/8 $OPERATOR_IP
EOF
    elif ! grep -qF "$OPERATOR_IP" "$JAIL_LOCAL"; then
      if grep -q '^ignoreip' "$JAIL_LOCAL"; then
        sed -i "s|^ignoreip = \\(.*\\)|ignoreip = \\1 $OPERATOR_IP|" "$JAIL_LOCAL"
      else
        echo "ignoreip = 127.0.0.1/8 $OPERATOR_IP" >>"$JAIL_LOCAL"
      fi
    fi
    systemctl reload fail2ban 2>/dev/null || systemctl restart fail2ban 2>/dev/null || true
  fi
fi

echo "[swap-guard] done (sing-box NOT restarted)"
