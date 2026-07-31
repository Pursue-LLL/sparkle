import { existsSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { getProfileConfig } from '../config'
import { appendAppLog } from '../utils/log'
import { profilesDir } from '../utils/dirs'
import { parseYaml, stringifyYaml } from '../utils/yaml'
import {
  ensureVpsCursorLeafBootstrapDialTimeout,
  MARATHON_DIAL_TOLERANCE_CONN_THRESHOLD,
  MARATHON_DIAL_TIMEOUT_MARATHON_SEC,
  shouldAllowMarathonDialToleranceBootstrapAtIdle,
  shouldEnableMarathonDialTolerance,
} from './marathonDialToleranceCore'
import { reloadMihomoProfileProviders, resolveVpsProviderId } from './provider'
import { applyVlessVisionMuxGuard } from './vlessVisionMuxGuardCore'

let bootstrapVerifiedThisSession = false
let lastLoggedMarathonDialSsotConn = -1

function vpsProviderFilePath(profileId: string): string {
  return path.join(profilesDir(), `${resolveVpsProviderId(profileId)}-proxies.yaml`)
}

/** Idle-only backfill: patch on-disk VPS provider yaml to marathon-safe dial-timeout without mid-session reload. */
export async function ensureVpsProviderMarathonDialTimeoutBootstrapAtIdle(
  cursorConnectionCount: number,
): Promise<boolean> {
  const { resolveMarathonSSETruthNow } = await import('./marathonSSETruthRuntime')
  const truth = await resolveMarathonSSETruthNow(cursorConnectionCount)
  if (
    !shouldAllowMarathonDialToleranceBootstrapAtIdle(
      cursorConnectionCount,
      truth.marathonTruthActive,
    )
  ) {
    return false
  }

  const { current } = await getProfileConfig()
  const providerPath = vpsProviderFilePath(current)
  if (!existsSync(providerPath)) {
    bootstrapVerifiedThisSession = true
    return false
  }

  const parsed = parseYaml<{ proxies?: unknown[] }>(await readFile(providerPath, 'utf8'))
  const proxies = Array.isArray(parsed?.proxies) ? parsed.proxies : []
  if (proxies.length === 0) {
    bootstrapVerifiedThisSession = true
    return false
  }

  const result = ensureVpsCursorLeafBootstrapDialTimeout(proxies)
  if (!result.changed) {
    bootstrapVerifiedThisSession = true
    return false
  }

  const guardedProxies = applyVlessVisionMuxGuard(result.proxies)
  await writeFile(providerPath, stringifyYaml({ proxies: guardedProxies }), 'utf8')
  await reloadMihomoProfileProviders(current, true)
  bootstrapVerifiedThisSession = true
  await appendAppLog(
    `[MarathonDialTolerance]: bootstrap_idle_apply dial_timeout=${MARATHON_DIAL_TIMEOUT_MARATHON_SEC}s` +
      ` cursor_conn=${cursorConnectionCount} data_plane_action=provider_update\n`,
  )
  return true
}

/** Observability + idle bootstrap; never mutates data plane during marathon/quiesce. */
export async function syncMarathonDialToleranceIfNeeded(
  cursorConnectionCount: number,
): Promise<boolean> {
  if (!shouldEnableMarathonDialTolerance(cursorConnectionCount)) {
    lastLoggedMarathonDialSsotConn = -1
    await ensureVpsProviderMarathonDialTimeoutBootstrapAtIdle(cursorConnectionCount)
    return false
  }

  if (lastLoggedMarathonDialSsotConn < MARATHON_DIAL_TOLERANCE_CONN_THRESHOLD) {
    lastLoggedMarathonDialSsotConn = cursorConnectionCount
    await appendAppLog(
      `[MarathonDialTolerance]: ssot_active dial_timeout=${MARATHON_DIAL_TIMEOUT_MARATHON_SEC}s` +
        ` cursor_conn=${cursorConnectionCount} data_plane_action=none` +
        ` bootstrap_verified=${bootstrapVerifiedThisSession ? 1 : 0}\n`,
    )
  }
  return false
}

export function resetMarathonDialToleranceStateForTests(): void {
  bootstrapVerifiedThisSession = false
  lastLoggedMarathonDialSsotConn = -1
}
