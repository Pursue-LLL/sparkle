import { getAppConfig } from '../config'
import { showNotification } from '../utils/notification'

export interface NetworkAlertConfig {
  enabled: boolean
  delayThresholdMs: number
  probeLatencyThresholdMs: number
  consecutiveHits: number
  cooldownMs: number
}

interface ProbeAlertInput {
  proxyNode?: string
  proxyDelayMs?: number
  probeOk: boolean
  probeLatencyMs: number
  errorDetail?: string
}

type AlertKind = 'high_delay' | 'disconnect'

let consecutiveHighDelay = 0
let consecutiveProbeFail = 0
let latchedHighDelay = false
let latchedDisconnect = false
const lastNotifyAt: Partial<Record<AlertKind | 'recovery', number>> = {}

export async function resolveNetworkAlertConfig(): Promise<NetworkAlertConfig> {
  const cfg = await getAppConfig()
  return {
    enabled: cfg.networkAlertEnabled !== false,
    delayThresholdMs: cfg.networkAlertDelayThresholdMs ?? 800,
    probeLatencyThresholdMs: cfg.networkAlertProbeLatencyThresholdMs ?? 2000,
    consecutiveHits: cfg.networkAlertConsecutiveHits ?? 2,
    cooldownMs: cfg.networkAlertCooldownMs ?? 15 * 60_000
  }
}

export function resetNetworkAlertState(): void {
  consecutiveHighDelay = 0
  consecutiveProbeFail = 0
  latchedHighDelay = false
  latchedDisconnect = false
  for (const key of Object.keys(lastNotifyAt)) {
    delete lastNotifyAt[key as AlertKind | 'recovery']
  }
}

function isHighDelaySample(
  proxyDelayMs: number | undefined,
  probeLatencyMs: number,
  config: NetworkAlertConfig
): boolean {
  const nodeDelayHigh =
    proxyDelayMs !== undefined && proxyDelayMs > 0 && proxyDelayMs >= config.delayThresholdMs
  const probeLatencyHigh = probeLatencyMs >= config.probeLatencyThresholdMs
  return nodeDelayHigh || probeLatencyHigh
}

function canNotify(kind: AlertKind | 'recovery', cooldownMs: number): boolean {
  const lastAt = lastNotifyAt[kind]
  if (lastAt === undefined) return true
  return Date.now() - lastAt >= cooldownMs
}

function markNotified(kind: AlertKind | 'recovery'): void {
  lastNotifyAt[kind] = Date.now()
}

async function notifyAlert(
  kind: AlertKind,
  config: NetworkAlertConfig,
  title: string,
  body: string
): Promise<void> {
  if (!canNotify(kind, config.cooldownMs)) return
  markNotified(kind)
  await showNotification({
    id: `sparkle-network-${kind}`,
    title,
    body,
    variant: kind === 'disconnect' ? 'danger' : 'warning'
  })
}

async function notifyRecovery(config: NetworkAlertConfig, body: string): Promise<void> {
  if (!canNotify('recovery', config.cooldownMs)) return
  markNotified('recovery')
  await showNotification({
    id: 'sparkle-network-recovery',
    title: 'Cursor 网络已恢复',
    body,
    variant: 'success'
  })
}

export async function handleNetworkOfflineAlert(): Promise<void> {
  const config = await resolveNetworkAlertConfig()
  if (!config.enabled) return

  latchedDisconnect = true
  await notifyAlert(
    'disconnect',
    config,
    'Cursor 网络离线',
    '系统网络不可用，Cursor Agent 可能中断。'
  )
}

export async function evaluateNetworkProbeAlert(input: ProbeAlertInput): Promise<void> {
  const config = await resolveNetworkAlertConfig()
  if (!config.enabled) return

  const nodeLabel = input.proxyNode ?? 'unknown'

  if (!input.probeOk) {
    consecutiveProbeFail += 1
    consecutiveHighDelay = 0
  } else {
    consecutiveProbeFail = 0
    if (isHighDelaySample(input.proxyDelayMs, input.probeLatencyMs, config)) {
      consecutiveHighDelay += 1
    } else {
      consecutiveHighDelay = 0
    }
  }

  if (
    consecutiveProbeFail >= config.consecutiveHits &&
    !latchedDisconnect
  ) {
    latchedDisconnect = true
    const detail = input.errorDetail ? ` ${input.errorDetail}` : ''
    await notifyAlert(
      'disconnect',
      config,
      'Cursor 代理断连',
      `节点 ${nodeLabel}：api2 探针连续 ${config.consecutiveHits} 次失败。${detail}`.trim()
    )
  }

  if (
    input.probeOk &&
    consecutiveHighDelay >= config.consecutiveHits &&
    !latchedHighDelay
  ) {
    latchedHighDelay = true
    const delayParts: string[] = []
    if (input.proxyDelayMs !== undefined && input.proxyDelayMs > 0) {
      delayParts.push(`节点 delay ${input.proxyDelayMs}ms`)
    }
    if (input.probeLatencyMs >= config.probeLatencyThresholdMs) {
      delayParts.push(`api2 往返 ${input.probeLatencyMs}ms`)
    }
    await notifyAlert(
      'high_delay',
      config,
      'Cursor 节点延迟偏高',
      `${nodeLabel}：${delayParts.join('，')}（连续 ${config.consecutiveHits} 次超阈值）。`
    )
  }

  const healthyProbe =
    input.probeOk &&
    !isHighDelaySample(input.proxyDelayMs, input.probeLatencyMs, config)

  if (!healthyProbe) return

  if (latchedHighDelay || latchedDisconnect) {
    const wasDisconnect = latchedDisconnect
    latchedHighDelay = false
    latchedDisconnect = false
    consecutiveHighDelay = 0
    consecutiveProbeFail = 0
    await notifyRecovery(
      config,
      wasDisconnect
        ? `节点 ${nodeLabel}：api2 探针已恢复。`
        : `节点 ${nodeLabel}：延迟已回到正常范围。`
    )
  }
}

