import { getAppConfig } from '../config'
import { appendAppLog } from '../utils/log'
import { countCursorConnections } from './cursorConnectionHygiene'
import { mihomoProxyDelay, type MihomoDelayOptions } from './mihomoApi'
import { isMihomoDelayProbeCongested } from './mihomoProbeCoordinator'
import {
  getNetworkBurstUntilMs,
  isNetworkStabilityBurstActive,
  isNetworkStabilityShortProbeActive
} from './networkStabilityMonitor'
import { MARATHON_DIAL_TIMEOUT_MARATHON_SEC } from './marathonDialToleranceCore'
import {
  evaluateUiVpsDelayWaitStep,
  formatUiVpsDelayDeferReason,
  isVpsCursorLeafBatch,
  isVpsCursorLeafNode,
  resolveVpsDelayTestTimeoutMs,
  VpsDelayTestSlotBusyError,
  type UiVpsDelayDeferContext
} from './vpsDelayTestPolicyCore'

export interface ManagedVpsDelayTestResult {
  deferredMs: number
  proxyNames: string[]
  testUrl?: string
  delays: Record<string, ControllerProxiesDelay>
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function buildDeferContext(): Promise<UiVpsDelayDeferContext> {
  return {
    cursorConnectionCount: await countCursorConnections(),
    burstActive: isNetworkStabilityBurstActive(),
    delayProbeCongested: isMihomoDelayProbeCongested(),
    shortProbeActive: isNetworkStabilityShortProbeActive()
  }
}

async function waitForUiVpsDelaySlot(startedAtMs: number): Promise<number> {
  let loggedDefer = false
  while (true) {
    const context = await buildDeferContext()
    const step = evaluateUiVpsDelayWaitStep(startedAtMs, context)
    if (step === 'ready') {
      return Date.now() - startedAtMs
    }
    if (step === 'slot_busy') {
      const waitedMs = Date.now() - startedAtMs
      await appendAppLog(
        `[ManagedVpsDelayTest]: slot_busy after ${waitedMs}ms — ${formatUiVpsDelayDeferReason(context)} burst_until=${new Date(getNetworkBurstUntilMs()).toISOString()}\n`
      )
      throw new VpsDelayTestSlotBusyError(context, waitedMs)
    }
    if (!loggedDefer) {
      loggedDefer = true
      await appendAppLog(
        `[ManagedVpsDelayTest]: defer ui vps delay (${formatUiVpsDelayDeferReason(context)})\n`
      )
    }
    await sleep(VPS_UI_DELAY_POLL_MS)
  }
}

async function resolveManagedTimeoutMs(): Promise<number> {
  const appConfig = await getAppConfig()
  return resolveVpsDelayTestTimeoutMs(
    appConfig.delayTestTimeout,
    MARATHON_DIAL_TIMEOUT_MARATHON_SEC
  )
}

export async function runManagedVpsDelayTests(
  proxyNames: readonly string[],
  testUrl?: string
): Promise<ManagedVpsDelayTestResult> {
  const names = proxyNames.map((name) => name.trim()).filter(Boolean)
  if (!isVpsCursorLeafBatch(names)) {
    throw new Error('ManagedVpsDelayTest requires an all-VPS leaf batch')
  }

  const startedAtMs = Date.now()
  const deferredMs = await waitForUiVpsDelaySlot(startedAtMs)
  const timeoutMs = await resolveManagedTimeoutMs()
  const options: MihomoDelayOptions = { timeoutMs }
  const delays: Record<string, ControllerProxiesDelay> = {}

  for (const proxyName of names) {
    try {
      delays[proxyName] = await mihomoProxyDelay(proxyName, testUrl, options)
    } catch (error) {
      delays[proxyName] = {
        delay: 0,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }

  return { deferredMs, proxyNames: names, testUrl, delays }
}

export async function runManagedVpsDelayTestSingle(
  proxyName: string,
  testUrl?: string
): Promise<ControllerProxiesDelay> {
  const trimmed = proxyName.trim()
  if (!isVpsCursorLeafNode(trimmed)) {
    const timeoutMs = await resolveManagedTimeoutMs()
    return mihomoProxyDelay(trimmed, testUrl, { timeoutMs })
  }
  const result = await runManagedVpsDelayTests([trimmed], testUrl)
  return result.delays[trimmed] ?? { delay: 0, message: 'managed delay result missing' }
}

export { isVpsCursorLeafNode } from './vpsDelayTestPolicyCore'
