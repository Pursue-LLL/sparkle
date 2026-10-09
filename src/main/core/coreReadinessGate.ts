// [INPUT] sidecar API · bootstrap · startCore · mihomo API · HTTP proxy probe
// [OUTPUT] runCoreReadinessPipeline · checkProfileWithRetry · verifyDataPlaneLive
// [POS] SSOT startup gate for GUI / CLI / upgrade verification.

import { getAppConfig } from '../config'
import { appendAppLog } from '../utils/log'
import { showNotification } from '../utils/notification'
import { startCore } from './manager'
import { waitForMihomoControllerReady } from './postCoreBootstrap'
import { test as probeSidecarTest } from '../service/api'
import {
  CoreReadinessError,
  DATA_PLANE_READY_MAX_MS,
  SIDECAR_PROBE_TIMEOUT_MS,
  formatCoreReadinessPhaseLog,
  type CoreReadinessPhase,
} from './coreReadinessGateCore'

export type CoreReadinessCaller = 'gui' | 'profile-update-cli' | 'macos26-headless-bootstrap'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function logPhase(phase: CoreReadinessPhase, outcome: string, detail = ''): Promise<void> {
  await appendAppLog(formatCoreReadinessPhaseLog(phase, outcome, detail))
}

export async function ensureSidecarReachable(
  timeoutMs: number = SIDECAR_PROBE_TIMEOUT_MS,
): Promise<void> {
  const { corePermissionMode = 'elevated' } = await getAppConfig()
  if (corePermissionMode !== 'service') {
    await logPhase('sidecar', 'skipped', 'reason=elevated_mode')
    return
  }

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await probeSidecarTest()
      await logPhase('sidecar', 'reachable')
      return
    } catch {
      await delay(400)
    }
  }

  try {
    const { startService } = await import('../service/manager')
    await startService()
    await delay(1_500)
    await probeSidecarTest()
    await logPhase('sidecar', 'started_and_reachable')
    return
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new CoreReadinessError('SIDECAR_UNREACHABLE', 'sidecar', message)
  }
}

export async function verifyDataPlaneLive(
  maxWaitMs: number = DATA_PLANE_READY_MAX_MS,
): Promise<boolean> {
  const apiReady = await waitForMihomoControllerReady(maxWaitMs)
  if (!apiReady) {
    await logPhase('data_plane', 'controller_unreachable', `max_wait_ms=${maxWaitMs}`)
    return false
  }
  await logPhase('data_plane', 'controller_ready')
  return true
}

export interface CoreReadinessPipelineResult {
  startPromise: Promise<void>
}

export async function runCoreReadinessPipeline(
  caller: CoreReadinessCaller,
): Promise<CoreReadinessPipelineResult> {
  await appendAppLog(`[CoreReadiness]: pipeline begin caller=${caller}\n`)

  await ensureSidecarReachable()
  await logPhase('profile', 'bootstrap_begin')

  const [startPromise] = await startCore()
  const apiReady = await verifyDataPlaneLive()
  if (!apiReady) {
    void showNotification({
      title: 'Sparkle: 数据面未就绪',
      body: 'mihomo 已启动但控制器 API 暂不可用。请查看日志或重启 Sparkle。',
      variant: 'danger',
    })
    throw new CoreReadinessError(
      'DATA_PLANE_NOT_READY',
      'data_plane',
      'mihomo controller API probe failed after core start',
    )
  }

  await appendAppLog(`[CoreReadiness]: pipeline complete caller=${caller}\n`)
  return { startPromise }
}
