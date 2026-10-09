#!/usr/bin/env bash
# Build Sparkle (vite + electron-builder dir) and install to /Applications.
# SSOT for local dev upgrades — avoids stale asar, Gatekeeper flash-exit, and ditto overlay.
#
# AI Agent: read BUGFIX_LOG.md §「Sparkle 本地安装」+ §「AI Agent 操作约束」 before any install.
# Do NOT edit BUGFIX_LOG_315.md for Sparkle issues.
#
# Usage: bash scripts/upgrade-sparkle-local.sh
# Requires: pnpm, network for electron-builder deps scan (~2min first time after clean)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail() { echo "[upgrade-sparkle] FAIL: $*" >&2; exit 1; }
log() { echo "[upgrade-sparkle] $*" >&2; }

# electron-builder 26 node module collector runs `pnpm list --depth Infinity`.
# A stale system pnpm (e.g. /usr/local/bin/pnpm v7) exits 1 → collector fails with no fallback.
# package.json pins pnpm@11.1.1 — prepend a corepack wrapper so `which pnpm` resolves correctly.
resolve_corepack_bin() {
  local node_bin d nvm_corepack
  if [[ -n "${SPARKLE_COREPACK_BIN:-}" && -x "${SPARKLE_COREPACK_BIN}" ]]; then
    echo "${SPARKLE_COREPACK_BIN}"
    return 0
  fi
  if command -v corepack >/dev/null 2>&1; then
    command -v corepack
    return 0
  fi
  node_bin="$(command -v node 2>/dev/null || true)"
  if [[ -n "$node_bin" ]]; then
    d="$(dirname "$node_bin")"
    if [[ -x "${d}/corepack" ]]; then
      echo "${d}/corepack"
      return 0
    fi
  fi
  nvm_corepack="${HOME}/.nvm/versions/node/$(node -p 'process.version.slice(1)' 2>/dev/null)/bin/corepack"
  if [[ -x "$nvm_corepack" ]]; then
    echo "$nvm_corepack"
    return 0
  fi
  return 1
}

ensure_electron_builder_pnpm() {
  local pm_ver corepack_bin wrap_dir resolved_ver
  pm_ver="$(node -p "(require('./package.json').packageManager||'pnpm@11.1.1').split('@')[1]")"
  corepack_bin="$(resolve_corepack_bin || true)"
  [[ -n "$corepack_bin" ]] || fail "corepack not found — required for pnpm@${pm_ver} (electron-builder node module collector)"
  "$corepack_bin" enable >/dev/null 2>&1 || true
  "$corepack_bin" prepare "pnpm@${pm_ver}" --activate
  wrap_dir="${SPARKLE_PNPM_SHIM_DIR:-$(mktemp -d)}"
  export SPARKLE_PNPM_SHIM_DIR="$wrap_dir"
  printf '#!/usr/bin/env bash\nexec "%s" pnpm "$@"\n' "$corepack_bin" > "${wrap_dir}/pnpm"
  chmod +x "${wrap_dir}/pnpm"
  export PATH="${wrap_dir}:${PATH}"
  resolved_ver="$(pnpm --version 2>/dev/null || echo unknown)"
  [[ "$resolved_ver" == "$pm_ver" ]] || fail "pnpm shim version=$resolved_ver expected=$pm_ver (PATH/corepack mismatch)"
  log "electron-builder pnpm shim active: $resolved_ver"
}

EXPECTED_VER="$(node -p "require('./package.json').version")"
DIST_ARM64="$ROOT/dist/mac-arm64"
APP="$DIST_ARM64/Sparkle.app"

log "Building Sparkle $EXPECTED_VER (electron-vite + electron-builder dir)..."
export SPARKLE_UPGRADE_TARGET_VERSION="$EXPECTED_VER"

if [[ "${SPARKLE_UPGRADE_SKIP_G9_GATE:-}" != "1" ]]; then
  log "G9 pre-install gate (attempt_rate SLO + remedial incident registry)..."
  if ! "$ROOT/node_modules/.bin/tsx" "$ROOT/scripts/evaluate-sparkle-g9-preinstall-gate.mts"; then
    fail "G9 pre-install gate blocked upgrade — attempt_rate below 90% with sufficient sample and no remedial incident. Fix root cause or add incident to ~/.sparkle/upgrade-incident-registry.json."
  fi
else
  log "WARN: SPARKLE_UPGRADE_SKIP_G9_GATE=1 — deprecated; prefer remedial registry in ~/.sparkle/upgrade-incident-registry.json"
fi

if [[ -f "$ROOT/extra/sidecar/mihomo" ]]; then
  export SKIP_PREPARE=1
  log "SKIP_PREPARE=1 (extra/sidecar/mihomo present — skip GitHub sidecar re-download)"
fi

pnpm run write-build-stamp

pnpm exec electron-vite build

log "Stage-A bundle gate (out/main, fail-fast before electron-builder)..."
"$ROOT/node_modules/.bin/tsx" "$ROOT/scripts/verify-sparkle-main-bundle.mts" "$ROOT/out/main"
"$ROOT/node_modules/.bin/tsx" "$ROOT/scripts/verify-marathon-mutation-callers.mts"

# Stale dist/mac-arm64 (e.g. interrupted packaging leaves Electron.app only) causes
# @electron/osx-sign "Sparkle.app could not be found" — always clean before dir build.
log "Cleaning $DIST_ARM64 (avoid stale Electron.app signing race)..."
rm -rf "$DIST_ARM64"

# Adhoc deep sign only — matches electron-builder.yml mac.identity: "-"
export CSC_IDENTITY_AUTO_DISCOVERY=false

ensure_electron_builder_pnpm

run_electron_builder_dir() {
  # GitHub releases via TUN often hit 600s got timeout; npmmirror is the stable fallback.
  export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"
  npx electron-builder --publish never --mac dir
}

if ! run_electron_builder_dir; then
  log "electron-builder --mac dir failed — retry once after clean..."
  rm -rf "$DIST_ARM64"
  run_electron_builder_dir || fail "electron-builder --mac dir failed twice (see log above)"
fi

[[ -d "$APP" ]] || fail "missing $APP after build (dist may have Electron.app only — BUG-2026-07-23-005)"

BUILT_VER="$(defaults read "$APP/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || echo "")"
[[ "$BUILT_VER" == "$EXPECTED_VER" ]] || fail "version mismatch: package.json=$EXPECTED_VER dist=$BUILT_VER"

if ! codesign --verify --deep --strict "$APP" >/dev/null 2>&1; then
  fail "dist app signature invalid after build — afterSign deepSignMac.cjs may have failed"
fi

# Stage-B bundle gate — same SSOT collector as stage A (scripts/sparkleMainAsarSourceCore.ts)
log "Stage-B bundle gate (app.asar, post electron-builder)..."
"$ROOT/node_modules/.bin/tsx" "$ROOT/scripts/verify-sparkle-main-asar.mts" "$APP/Contents/Resources/app.asar"

log "Writing dist source fingerprint meta (DistFreshness gate SSOT)..."
"$ROOT/node_modules/.bin/tsx" "$ROOT/scripts/write-sparkle-dist-build-meta.mts" "$APP"

# Meta is written after electron-builder afterSign — re-deep-sign so install gate passes.
log "Re-signing after build-meta write (deepSignMac parity)..."
codesign --deep --force --sign - "$APP"
xattr -cr "$APP" 2>/dev/null || true
if ! codesign --verify --deep --strict "$APP" >/dev/null 2>&1; then
  fail "dist app signature invalid after build-meta re-sign"
fi

log "Build OK ($BUILT_VER). Installing..."

# Build keeps the caller's HOME (toolchain lookup); install gates must read the real user home.
# shellcheck source=lib/login-home.sh
source "$ROOT/scripts/lib/login-home.sh"
sparkle_pin_login_home

SPARKLE_LOG_DIR="$HOME/Library/Application Support/sparkle/logs"
APP_LOG="$(ls -t "$SPARKLE_LOG_DIR"/app-*.log 2>/dev/null | head -1 || true)"
BUG014_GATE_SINCE_LINE=0
if [[ -n "$APP_LOG" && -f "$APP_LOG" ]]; then
  BUG014_GATE_SINCE_LINE="$(wc -l < "$APP_LOG" | tr -d ' ')"
  log "BUG-014 gate: snapshot app log at line=$BUG014_GATE_SINCE_LINE ($APP_LOG)"
fi

log "Upgrade Safe Window — wait for idle before install (SPARKLE_UPGRADE_BREAK_GLASS=1 to override)..."
"$ROOT/node_modules/.bin/tsx" "$ROOT/scripts/upgradeSafeWindowWaitCli.mts"

# shellcheck source=lib/marathon-core-restart-guard.sh
source "$ROOT/scripts/lib/marathon-core-restart-guard.sh"
export MARATHON_GUARD_ROOT="$ROOT"
marathon_core_restart_guard_assert_idle "upgrade-sparkle-local"

bash "$ROOT/scripts/install-sparkle-local.sh"

log "Post-install checks..."
VER="$(defaults read /Applications/Sparkle.app/Contents/Info.plist CFBundleShortVersionString 2>/dev/null || echo unknown)"
[[ "$VER" == "$EXPECTED_VER" ]] || fail "installed version=$VER expected=$EXPECTED_VER"

MACOS_PRODUCT_MAJOR="$(sw_vers -productVersion 2>/dev/null | cut -d. -f1)"
# Headless bootstrap is the macOS 26 default; macos26ForceGui keeps the GUI process (and PostCoreBootstrap) alive.
MACOS26_FORCE_GUI=false
if grep -Eq '^macos26ForceGui:[[:space:]]*true[[:space:]]*$' "$HOME/Library/Application Support/sparkle/config.yaml" 2>/dev/null; then
  MACOS26_FORCE_GUI=true
fi
if [[ "${MACOS_PRODUCT_MAJOR:-0}" -ge 26 && "$MACOS26_FORCE_GUI" != true ]]; then
  log "Post-install: macOS 26 headless path (GUI may exit after bootstrap)"
  headless_ok=0
  for _ in $(seq 1 30); do
    APP_LOG="$(ls -t "$SPARKLE_LOG_DIR"/app-*.log 2>/dev/null | head -1 || true)"
    if [[ -n "$APP_LOG" && -f "$APP_LOG" ]]; then
      headless_ok="$(
        "$ROOT/node_modules/.bin/tsx" -e "
          import { readFileSync } from 'node:fs';
          import { hasMacOs26HeadlessBootstrapCompleteSinceLine } from './scripts/upgradeSparklePostInstallGateCore.ts';
          const text = readFileSync(process.argv[1], 'utf8');
          process.stdout.write(
            hasMacOs26HeadlessBootstrapCompleteSinceLine(text, Number(process.argv[2])) ? '1' : '0',
          );
        " "$APP_LOG" "$BUG014_GATE_SINCE_LINE"
      )"
      [[ "$headless_ok" == "1" ]] && break
    fi
    sleep 2
  done
  [[ "$headless_ok" == "1" ]] || fail "macOS 26 headless bootstrap not logged — check $APP_LOG"
  curl -sf --max-time 10 -x http://127.0.0.1:7890 https://api2.cursor.sh/ >/dev/null \
    || fail "macOS 26 post-install: proxy :7890 not reachable after headless bootstrap"
  log "macOS 26 headless post-install OK (bootstrap log + proxy :7890)"
  log "Done. Sparkle $VER installed (headless); proxy via sparkle-service"
  exit 0
fi

if ! pgrep -x Sparkle >/dev/null 2>&1; then
  fail "Sparkle not running after install — see install-sparkle log above"
fi

if ! "$ROOT/node_modules/.bin/tsx" "$ROOT/scripts/sparkle-mihomo-close-smoke.mts" >/dev/null 2>&1; then
  log "WARN: mihomo close API smoke not ready yet (direct or service path)"
else
  log "mihomo close API OK (direct or service path)"
fi

# Marathon readiness gate — PostCoreBootstrap must succeed or CTHC/keepalive blind (BUG-004).
if [[ -z "${SPARKLE_LOG_DIR:-}" ]]; then
  SPARKLE_LOG_DIR="$HOME/Library/Application Support/sparkle/logs"
fi
if [[ -z "${APP_LOG:-}" ]]; then
  APP_LOG="$(ls -t "$SPARKLE_LOG_DIR"/app-*.log 2>/dev/null | head -1 || true)"
fi
if [[ -n "$APP_LOG" ]]; then
  post_install_bootstrap_ok=false
  recovery_round=0
  max_recovery_rounds="${SPARKLE_POST_INSTALL_RECOVERY_MAX_ROUNDS:-2}"
  while [[ "$post_install_bootstrap_ok" != true ]]; do
    post_core_fail="$(
      "$ROOT/node_modules/.bin/tsx" -e "
        import { readFileSync } from 'node:fs';
        import { countPostCoreBootstrapFailuresSinceLine } from './scripts/upgradeSparklePostInstallGateCore.ts';
        const text = readFileSync(process.argv[1], 'utf8');
        process.stdout.write(String(countPostCoreBootstrapFailuresSinceLine(text, Number(process.argv[2]))));
      " "$APP_LOG" "$BUG014_GATE_SINCE_LINE"
    )"
    if [[ "${post_core_fail:-0}" -gt 0 ]]; then
      log "WARN: PostCoreBootstrap failed ${post_core_fail} time(s) since install line $BUG014_GATE_SINCE_LINE"
    fi
    log "Waiting for Api2ProbePlane ON (PostCoreBootstrap, up to 90s)..."
    probe_ok=false
    for _ in $(seq 1 18); do
      if [[ -f "$APP_LOG" ]]; then
        post_core_fail="$(
          "$ROOT/node_modules/.bin/tsx" -e "
            import { readFileSync } from 'node:fs';
            import {
              countPostCoreBootstrapFailuresSinceLine,
              hasApi2ProbePlaneSettledSinceLine,
              hasMihomoApiReadySinceLine,
            } from './scripts/upgradeSparklePostInstallGateCore.ts';
            const text = readFileSync(process.argv[1], 'utf8');
            const since = Number(process.argv[2]);
            if (countPostCoreBootstrapFailuresSinceLine(text, since) > 0) {
              process.stdout.write('fail');
              process.exit(0);
            }
            if (hasMihomoApiReadySinceLine(text, since) && hasApi2ProbePlaneSettledSinceLine(text, since)) {
              process.stdout.write('ok');
              process.exit(0);
            }
            process.stdout.write('wait');
          " "$APP_LOG" "$BUG014_GATE_SINCE_LINE"
        )"
        if [[ "$post_core_fail" == "ok" ]]; then
          probe_ok=true
          break
        fi
      fi
      sleep 5
      APP_LOG="$(ls -t "$SPARKLE_LOG_DIR"/app-*.log 2>/dev/null | head -1 || true)"
    done
    if [[ "$probe_ok" == true ]]; then
      post_install_bootstrap_ok=true
      log "PostCoreBootstrap OK (mihomo API ready + Api2ProbePlane ON)"
      break
    fi
    if (( recovery_round >= max_recovery_rounds )); then
      fail "PostCoreBootstrap not ready after ${max_recovery_rounds} recovery round(s) — check $APP_LOG"
    fi
    recovery_round=$((recovery_round + 1))
    log "Post-install recovery round ${recovery_round}/${max_recovery_rounds} (socket hygiene + GUI relaunch)..."
    if ! "$ROOT/node_modules/.bin/tsx" "$ROOT/scripts/upgrade-sparkle-post-install-recovery.mts" "$BUG014_GATE_SINCE_LINE" "$recovery_round"; then
      fail "Post-install recovery round ${recovery_round} failed — check $APP_LOG"
    fi
    APP_LOG="$(ls -t "$SPARKLE_LOG_DIR"/app-*.log 2>/dev/null | head -1 || true)"
  done

  log "BUG-014 gate: waiting 45s for post-install hung_scan sample..."
  sleep 45
  APP_LOG="$(ls -t "$SPARKLE_LOG_DIR"/app-*.log 2>/dev/null | head -1 || true)"
  if [[ -n "$APP_LOG" && -f "$APP_LOG" ]]; then
    recent_fail="$(
      "$ROOT/node_modules/.bin/tsx" -e "
        import { readFileSync } from 'node:fs';
        import { countBug014RescueFailuresSinceLine } from './scripts/upgradeSparklePostInstallGateCore.ts';
        const text = readFileSync(process.argv[1], 'utf8');
        process.stdout.write(String(countBug014RescueFailuresSinceLine(text, Number(process.argv[2]))));
      " "$APP_LOG" "$BUG014_GATE_SINCE_LINE"
    )"
    if [[ "${recent_fail:-0}" -gt 0 ]]; then
      fail "BUG-014 gate: $recent_fail post-install Resource not found rescue failure(s) since line $BUG014_GATE_SINCE_LINE in $APP_LOG"
    fi
    log "BUG-014 gate OK (no post-install Resource not found on rescue paths since line $BUG014_GATE_SINCE_LINE)"
  fi

  log "Preflight 1.28.0 bundle (R-34 + G8 + close smoke)..."
  bash "$ROOT/scripts/preflight-sparkle-1280.sh" || fail "preflight-sparkle-1280 failed — see report above"
else
  log "WARN: no sparkle app-*.log yet — skip PostCoreBootstrap gate"
fi

log "Done. Sparkle $VER running from /Applications/Sparkle.app"
