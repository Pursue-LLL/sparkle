#!/usr/bin/env bash
set -euo pipefail

pass=0
fail=0

check() {
  local name="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "PASS: $name"
    pass=$((pass + 1))
  else
    echo "FAIL: $name"
    fail=$((fail + 1))
  fi
}

check_http() {
  local name="$1"
  local expect="$2"
  shift 2
  local code
  code=$(curl -sS -o /dev/null -w "%{http_code}" "$@" 2>/dev/null || echo "000")
  if [[ "$code" == "$expect" ]] || [[ "$expect" == "ok" && "$code" =~ ^[23] ]]; then
    echo "PASS: $name ($code)"
    pass=$((pass + 1))
    return 0
  fi
  if [[ "$expect" == "403" ]]; then
    sleep 2
    code=$(curl -sS -o /dev/null -w "%{http_code}" "$@" 2>/dev/null || echo "000")
    if [[ "$code" =~ ^[23] ]]; then
      echo "PASS: $name ($code, retry)"
      pass=$((pass + 1))
      return 0
    fi
  fi
  echo "FAIL: $name (got $code, want $expect)"
  fail=$((fail + 1))
}

echo "=== DNS/Proxy 5-round validation ==="

for round in 1 2 3 4 5; do
  echo "--- Round $round ---"
  sys_dns=$(networksetup -getdnsservers Wi-Fi 2>/dev/null | head -1 || echo "unknown")
  if [[ "$sys_dns" == "223.5.5.5" ]]; then
    echo "PASS: system DNS is public ($sys_dns)"
    pass=$((pass + 1))
  else
    echo "FAIL: system DNS ($sys_dns)"
    fail=$((fail + 1))
  fi

  fake_ip=$(dig +short www.google.com 2>/dev/null | head -1)
  if [[ "$fake_ip" == 198.18.* ]]; then
    echo "PASS: google fake-ip ($fake_ip)"
    pass=$((pass + 1))
  else
    echo "FAIL: google resolve ($fake_ip)"
    fail=$((fail + 1))
  fi

  check_http "google TUN" "ok" --max-time 12 https://www.google.com
  check_http "chatgpt TUN" "403" --max-time 25 -A "Mozilla/5.0" https://chatgpt.com
  check_http "sub2api health" "200" --max-time 5 http://127.0.0.1:8090/health
  check_http "google proxy 7890" "ok" --max-time 12 -x http://127.0.0.1:7890 https://www.google.com

  sleep 1
done

echo "=== Summary: $pass passed, $fail failed ==="
exit $(( fail > 0 ? 1 : 0 ))
