import { existsSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { getCurrentProfileItem } from '../config'
import { profilesDir } from '../utils/dirs'
import { parseYaml, stringifyYaml } from '../utils/yaml'
import { appendAppLog } from '../utils/log'
import { applyVlessVisionMuxGuard } from './vlessVisionMuxGuardCore'
import {
  applyMarathonDialToleranceToProxies,
  resolveMarathonDialTimeoutSec,
} from './marathonDialToleranceCore'
import {
  resolveMarathonDialToleranceApplySec,
  resolveMarathonDialTolerancePendingTarget,
  shouldApplyMarathonDialToleranceNow,
  shouldDeferMarathonDialToleranceApply,
} from './marathonDialToleranceIdleApplyCore'
import { reloadMihomoProfileProviders, resolveVpsProviderId } from './provider'
import {
  MTDO_ACTIVE_STREAM_MAX_GAP_MS,
  MTDO_MARATHON_STREAM_MIN_AGE_MS,
} from './marathonTransportDialOrchestratorCore'
import { buildMarathonStreamRegistry, hasActiveMarathonStream } from './marathonStreamRegistryCore'
import {
  collectRendererActivitySamplesForMtdo,
  collectRendererToolAuditLinesForMtdo,
} from './marathonTransportDialReader'

let lastAppliedDialTimeoutSec: number | undefined
let pendingDialTimeoutSec: number | undefined

function vpsProviderFilePath(profileId: string): string {
  return path.join(profilesDir(), `${resolveVpsProviderId(profileId)}-proxies.yaml`)
}

async function resolveMarathonDialToleranceIdleContext(cursorConnectionCount: number): Promise<{
  hasActiveMarathonStream: boolean
  quiesceActive: boolean
}> {
  const nowMs = Date.now()
  const { getMarathonQuiesceSnapshot } = await import('./marathonQuiesce')
  const quiesceSnapshot = getMarathonQuiesceSnapshot()
  const [activitySamples, toolLines] = await Promise.all([
    collectRendererActivitySamplesForMtdo(nowMs),
    collectRendererToolAuditLinesForMtdo(nowMs),
  ])
  const registry = buildMarathonStreamRegistry(
    activitySamples,
    toolLines,
    nowMs,
    MTDO_ACTIVE_STREAM_MAX_GAP_MS,
  )
  return {
    hasActiveMarathonStream: hasActiveMarathonStream(registry, nowMs, {
      minStreamAgeMs: MTDO_MARATHON_STREAM_MIN_AGE_MS,
      maxLastActivityGapMs: MTDO_ACTIVE_STREAM_MAX_GAP_MS,
    }),
    quiesceActive: quiesceSnapshot.active,
  }
}

/** Hot-update VPS leaf dial-timeout when idle — never reload during active marathon streams. */
export async function syncMarathonDialToleranceIfNeeded(
  cursorConnectionCount: number,
): Promise<boolean> {
  const targetDialTimeoutSec = resolveMarathonDialTimeoutSec(cursorConnectionCount)
  const { hasActiveMarathonStream, quiesceActive } =
    await resolveMarathonDialToleranceIdleContext(cursorConnectionCount)
  const defer = shouldDeferMarathonDialToleranceApply(
    cursorConnectionCount,
    hasActiveMarathonStream,
    quiesceActive,
  )

  pendingDialTimeoutSec = resolveMarathonDialTolerancePendingTarget(
    targetDialTimeoutSec,
    defer,
    pendingDialTimeoutSec,
  )

  const applyContext = {
    cursorConnectionCount,
    hasActiveMarathonStream,
    quiesceActive,
    targetDialTimeoutSec,
    lastAppliedDialTimeoutSec,
    pendingDialTimeoutSec,
  }

  if (defer) {
    if (pendingDialTimeoutSec != null && lastAppliedDialTimeoutSec !== pendingDialTimeoutSec) {
      await appendAppLog(
        `[MarathonDialTolerance]: apply_deferred_idle_gate cursor_conn=${cursorConnectionCount}` +
          ` target_timeout=${pendingDialTimeoutSec}s active_stream=${hasActiveMarathonStream ? 1 : 0}` +
          ` quiesce=${quiesceActive ? 1 : 0}\n`,
      )
    }
    return false
  }

  if (!shouldApplyMarathonDialToleranceNow(applyContext)) {
    return false
  }

  const applyDialTimeoutSec = resolveMarathonDialToleranceApplySec(applyContext)
  const profile = await getCurrentProfileItem()
  const providerPath = vpsProviderFilePath(profile.id)
  if (!existsSync(providerPath)) {
    return false
  }

  const raw = await readFile(providerPath, 'utf8')
  const parsed = parseYaml(raw) as { proxies?: unknown[] } | null
  const proxies = Array.isArray(parsed?.proxies) ? parsed.proxies : []
  if (proxies.length === 0) {
    return false
  }

  const result = applyMarathonDialToleranceToProxies(proxies, cursorConnectionCount)
  const guardedProxies = applyVlessVisionMuxGuard(result.proxies)
  if (!result.changed && lastAppliedDialTimeoutSec === applyDialTimeoutSec) {
    pendingDialTimeoutSec = undefined
    return false
  }

  await writeFile(providerPath, stringifyYaml({ proxies: guardedProxies }), 'utf8')
  await reloadMihomoProfileProviders(profile.id, true)
  lastAppliedDialTimeoutSec = applyDialTimeoutSec
  pendingDialTimeoutSec = undefined
  await appendAppLog(
    `[MarathonDialTolerance]: dial_timeout=${applyDialTimeoutSec}s cursor_conn=${cursorConnectionCount}` +
      ` idle_apply=1\n`,
  )
  return true
}

export function resetMarathonDialToleranceStateForTests(): void {
  lastAppliedDialTimeoutSec = undefined
  pendingDialTimeoutSec = undefined
}
