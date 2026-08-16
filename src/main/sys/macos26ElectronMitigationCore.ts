import os from 'os'

/** macOS 26 ships Darwin 25.x; macOS 15 is Darwin 24.x. */
export function darwinMajorFromRelease(release: string): number {
  const head = release.split('.')[0] ?? '0'
  const parsed = parseInt(head, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

export function isMacOs26OrNewer(platform: NodeJS.Platform, release: string): boolean {
  return platform === 'darwin' && darwinMajorFromRelease(release) >= 25
}

export interface MacOs26MitigationPatch {
  disableGPU?: true
  corePermissionMode?: 'service'
}

export function computeMacOs26MitigationPatch(input: {
  platform: NodeJS.Platform
  release: string
  disableGPU: boolean
  corePermissionMode: AppConfig['corePermissionMode']
  sparkleServiceBinaryExists: boolean
}): MacOs26MitigationPatch {
  if (!isMacOs26OrNewer(input.platform, input.release)) {
    return {}
  }

  const patch: MacOs26MitigationPatch = {}

  if (!input.disableGPU) {
    patch.disableGPU = true
  }

  if (input.corePermissionMode === 'elevated' && input.sparkleServiceBinaryExists) {
    patch.corePermissionMode = 'service'
  }

  return patch
}

export function shouldForceDisableGpu(
  platform: NodeJS.Platform,
  release: string,
  disableGPU: boolean,
): boolean {
  if (disableGPU) return true
  return isMacOs26OrNewer(platform, release)
}

/** hung_scan drives periodic fs + V8 callbacks; disable on macOS 26 to reduce SIGTRAP rate. */
export function shouldDisableHungScanOnMacOs26(
  platform: NodeJS.Platform,
  release: string,
): boolean {
  return isMacOs26OrNewer(platform, release)
}

export const MACOS26_FORCE_GUI_ARG = '--sparkle-force-gui'

/** User intentionally opens settings UI (CLI flag, env, or persisted config). */
export function wantsMacOs26ForceGui(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  configForceGui?: boolean,
): boolean {
  if (configForceGui === true) return true
  if (argv.includes(MACOS26_FORCE_GUI_ARG)) return true
  return env.SPARKLE_FORCE_GUI === '1'
}

/** Default on macOS 26+: bootstrap mihomo/service then exit Electron — avoids V8 SIGTRAP in GUI. */
export function shouldUseMacOs26HeadlessBootstrap(
  platform: NodeJS.Platform,
  release: string,
  forceGui: boolean,
): boolean {
  return isMacOs26OrNewer(platform, release) && !forceGui
}

/**
 * macOS 26 GUI (BrowserWindow) defers Api2ProbePlane / agentTransportFailureSync /
 * networkPathMonitor — fs-heavy callbacks on main thread correlate with V8 ThreadIsolation SIGTRAP.
 * Headless path never calls runPostCoreBootstrap; this applies only to force-GUI sessions.
 */
export function shouldSkipMacOs26GuiPostCoreObservabilityStack(
  platform: NodeJS.Platform,
  release: string,
): boolean {
  return isMacOs26OrNewer(platform, release)
}

export function currentPlatformRelease(): { platform: NodeJS.Platform; release: string } {
  return { platform: process.platform, release: os.release() }
}
