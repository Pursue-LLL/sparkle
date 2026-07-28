import { getAppConfig } from '../config'
import { formatUnknownErrorForUi } from '../utils/formatUnknownErrorForLog'
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
  VPS_UI_DELAY_POLL_MS,
  VPS_UI_EXPLICIT_DELAY_COOLDOWN_MS,
  VpsDelayTestSlotBusyError,
  type UiVpsDelayDeferContext
} from './vpsDelayTestPolicyCore'

export interface ManagedVpsDelayTestOptions {
  explicitUserRequest?: boolean
}

export interface ManagedVpsDelayTestResult {
  deferredMs: number
  proxyNames: string[]
  testUrl?: string
  delays: Record<string, ControllerProxiesDelay>
}

export class VpsDelayTestExplicitCooldownError extends Error {
  readonly code = 'VPS_DELAY_TEST_EXPLICIT_COOLDOWN' as const

  constructor(readonly remainingMs: number) {
    super(
      `VPS delay test cooldown: retry in ${Math.ceil(remainingMs / 1000)}s (explicit user request)`
    )
    this.name = 'VpsDelayTestExplicitCooldownError'
  }
}

let lastExplicitTestCompletedAtMs = 0
let explicitTestChain: Promise<void> = Promise.resolve()

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

async function waitForUiVpsDelaySlot(
  startedAtMs: number,
  options: ManagedVpsDelayTestOptions = {},
): Promise<number> {
  let loggedDefer = false
  while (true) {
    const context = await buildDeferContext()
    const step = evaluateUiVpsDelayWaitStep(startedAtMs, context, Date.now(), options)
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

function resolveExplicitCooldownRemainingMs(nowMs: number = Date.now()): number {
  const elapsed = nowMs - lastExplicitTestCompletedAtMs
  return Math.max(0, VPS_UI_EXPLICIT_DELAY_COOLDOWN_MS - elapsed)
}

async function withExplicitUserRequestGuard<T>(
  options: ManagedVpsDelayTestOptions,
  fn: () => Promise<T>,
): Promise<T> {
  if (!options.explicitUserRequest) {
    return fn()
  }

  const remainingMs = resolveExplicitCooldownRemainingMs()
  if (remainingMs > 0) {
    await appendAppLog(
      `[ManagedVpsDelayTest]: explicit cooldown remaining_ms=${remainingMs}\n`,
    )
    throw new VpsDelayTestExplicitCooldownError(remainingMs)
  }

  let release!: () => void
  const previous = explicitTestChain
  explicitTestChain = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous

  try {
    return await fn()
  } finally {
    lastExplicitTestCompletedAtMs = Date.now()
    release()
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
  testUrl?: string,
  options: ManagedVpsDelayTestOptions = {},
): Promise<ManagedVpsDelayTestResult> {
  return withExplicitUserRequestGuard(options, async () => {
    const names = proxyNames.map((name) => name.trim()).filter(Boolean)
    if (!isVpsCursorLeafBatch(names)) {
      throw new Error('ManagedVpsDelayTest requires an all-VPS leaf batch')
    }

    await appendAppLog(
      `[ManagedVpsDelayTest]: start explicit=${options.explicitUserRequest ? 1 : 0} proxies=${names.join(',')}\n`,
    )

    const startedAtMs = Date.now()
    const deferredMs = options.explicitUserRequest
      ? 0
      : await waitForUiVpsDelaySlot(startedAtMs, options)
    if (options.explicitUserRequest) {
      await appendAppLog('[ManagedVpsDelayTest]: explicit user delay bypass conn defer\n')
    }
    const timeoutMs = await resolveManagedTimeoutMs()
    const delayPurpose = options.explicitUserRequest ? ('user_explicit' as const) : undefined
    const delayOptions: MihomoDelayOptions = { timeoutMs, purpose: delayPurpose }
    const delays: Record<string, ControllerProxiesDelay> = {}
    const { resolveMarathonObservabilityDialContext, withMarathonObservabilityDialBudget } =
      await import('./marathonObservabilityDialBudget')
    const dialContext = await resolveMarathonObservabilityDialContext()

    for (const proxyName of names) {
      const dialKind = options.explicitUserRequest ? 'user_explicit' : 'defer_check'
      const budgetResult = await withMarathonObservabilityDialBudget(
        dialKind,
        dialContext,
        async () => {
          try {
            return await mihomoProxyDelay(proxyName, testUrl, delayOptions)
          } catch (error) {
            return {
              delay: 0,
              message: formatUnknownErrorForUi(error),
            } satisfies ControllerProxiesDelay
          }
        },
      )
      if (budgetResult.outcome === 'skipped_busy' || budgetResult.value === null) {
        delays[proxyName] = {
          delay: 0,
          message: 'observability dial budget busy (marathon)',
        }
        continue
      }
      delays[proxyName] = budgetResult.value
    }

    return { deferredMs, proxyNames: names, testUrl, delays }
  })
}

export async function runManagedVpsDelayTestSingle(
  proxyName: string,
  testUrl?: string,
  options: ManagedVpsDelayTestOptions = {},
): Promise<ControllerProxiesDelay> {
  const trimmed = proxyName.trim()
  if (!isVpsCursorLeafNode(trimmed)) {
    const timeoutMs = await resolveManagedTimeoutMs()
    const purpose = options.explicitUserRequest ? ('user_explicit' as const) : undefined
    return mihomoProxyDelay(trimmed, testUrl, { timeoutMs, purpose })
  }
  const result = await runManagedVpsDelayTests([trimmed], testUrl, options)
  return result.delays[trimmed] ?? { delay: 0, message: 'managed delay result missing' }
}

export { isVpsCursorLeafNode } from './vpsDelayTestPolicyCore'
