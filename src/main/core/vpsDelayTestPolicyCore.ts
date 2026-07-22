/** UI VPS batch delay tests: defer under Cursor load, align timeouts with marathon dial-timeout. */

import { MARATHON_DIAL_TOLERANCE_CONN_THRESHOLD } from './marathonDialToleranceCore'

export const DEFAULT_DELAY_TEST_TIMEOUT_MS = 10_000
export const VPS_DELAY_TEST_TIMEOUT_MS = 15_000
export const VPS_UI_DELAY_DEFER_CONN_THRESHOLD = MARATHON_DIAL_TOLERANCE_CONN_THRESHOLD
export const VPS_UI_DELAY_MAX_WAIT_MS = 120_000
export const VPS_UI_DELAY_POLL_MS = 3_000
export const VPS_DELAY_TEST_CONCURRENCY = 1

const VPS_NODE_SUFFIX = /-(HY2|Reality|TUIC|TLS)$/i

export function isVpsCursorLeafNode(name: string): boolean {
  return VPS_NODE_SUFFIX.test(name.trim())
}

export function isVpsCursorLeafBatch(proxyNames: readonly string[]): boolean {
  return proxyNames.length > 0 && proxyNames.every(isVpsCursorLeafNode)
}

export interface UiVpsDelayDeferContext {
  cursorConnectionCount: number
  burstActive: boolean
  delayProbeCongested: boolean
  shortProbeActive: boolean
}

export function shouldDeferUiVpsDelayTest(context: UiVpsDelayDeferContext): boolean {
  if (context.burstActive || context.delayProbeCongested || context.shortProbeActive) {
    return true
  }
  return context.cursorConnectionCount >= VPS_UI_DELAY_DEFER_CONN_THRESHOLD
}

export function resolveUiVpsDelayWaitRemainingMs(
  startedAtMs: number,
  nowMs: number = Date.now()
): number {
  return Math.max(0, VPS_UI_DELAY_MAX_WAIT_MS - (nowMs - startedAtMs))
}

export function resolveVpsDelayTestTimeoutMs(
  appTimeoutMs: number | undefined,
  leafDialTimeoutSec: number | undefined
): number {
  const fromApp = Number.isFinite(appTimeoutMs) && appTimeoutMs! > 0
    ? Math.floor(appTimeoutMs!)
    : DEFAULT_DELAY_TEST_TIMEOUT_MS
  const fromDial =
    Number.isFinite(leafDialTimeoutSec) && leafDialTimeoutSec! > 0
      ? Math.min(Math.floor(leafDialTimeoutSec! * 1000), VPS_DELAY_TEST_TIMEOUT_MS)
      : VPS_DELAY_TEST_TIMEOUT_MS
  return Math.max(fromApp, fromDial, DEFAULT_DELAY_TEST_TIMEOUT_MS)
}

export function formatUiVpsDelayDeferReason(context: UiVpsDelayDeferContext): string {
  if (context.burstActive) {
    return 'network stability burst window'
  }
  if (context.shortProbeActive) {
    return 'active api2 transport probe'
  }
  if (context.delayProbeCongested) {
    return 'mihomo delay probe slot congested'
  }
  return `cursor_conn=${context.cursorConnectionCount}>=${VPS_UI_DELAY_DEFER_CONN_THRESHOLD}`
}

export type UiVpsDelayWaitStep = 'ready' | 'keep_waiting' | 'slot_busy'

export function evaluateUiVpsDelayWaitStep(
  startedAtMs: number,
  context: UiVpsDelayDeferContext,
  nowMs: number = Date.now()
): UiVpsDelayWaitStep {
  if (!shouldDeferUiVpsDelayTest(context)) {
    return 'ready'
  }
  if (resolveUiVpsDelayWaitRemainingMs(startedAtMs, nowMs) <= 0) {
    return 'slot_busy'
  }
  return 'keep_waiting'
}

export class VpsDelayTestSlotBusyError extends Error {
  readonly code = 'VPS_DELAY_TEST_SLOT_BUSY' as const

  constructor(
    readonly context: UiVpsDelayDeferContext,
    readonly waitedMs: number
  ) {
    super(
      `VPS delay test deferred: ${formatUiVpsDelayDeferReason(context)} after ${waitedMs}ms — Cursor load too high to probe safely`
    )
    this.name = 'VpsDelayTestSlotBusyError'
  }
}
