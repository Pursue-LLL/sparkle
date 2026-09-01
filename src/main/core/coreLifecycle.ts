// [INPUT] coreLifecycleCore · mihomoApi · log
// [OUTPUT] runPostCoreReadyLifecycle · pending core-ready reason
// [POS] SSOT — post core-ready hygiene (fake-ip flush after cold restart).

import { appendAppLog } from '../utils/log'
import {
  formatCoreLifecycleLogLine,
  POST_CORE_READY_FAKE_IP_FLUSH_RETRIES,
  POST_CORE_READY_FAKE_IP_FLUSH_RETRY_MS,
  type CoreReadyReason,
} from './coreLifecycleCore'

let pendingCoreReadyReason: CoreReadyReason = 'cold_start'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function setPendingCoreReadyReason(reason: CoreReadyReason): void {
  pendingCoreReadyReason = reason
}

export function resetCoreLifecycleForTests(reason: CoreReadyReason = 'cold_start'): void {
  pendingCoreReadyReason = reason
}

export function consumePendingCoreReadyReason(): CoreReadyReason {
  const reason = pendingCoreReadyReason
  pendingCoreReadyReason = 'cold_start'
  return reason
}

async function flushFakeIpCacheWithRetry(reason: CoreReadyReason): Promise<boolean> {
  const { mihomoFlushFakeIpCache } = await import('./mihomoApi')
  for (let attempt = 1; attempt <= POST_CORE_READY_FAKE_IP_FLUSH_RETRIES; attempt += 1) {
    try {
      await mihomoFlushFakeIpCache()
      await appendAppLog(
        formatCoreLifecycleLogLine({
          phase: 'post_ready',
          action: 'fake_ip_flush',
          outcome: 'executed',
          reason,
          attempt,
        }),
      )
      return true
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error)
      if (attempt >= POST_CORE_READY_FAKE_IP_FLUSH_RETRIES) {
        await appendAppLog(
          formatCoreLifecycleLogLine({
            phase: 'post_ready',
            action: 'fake_ip_flush',
            outcome: 'failed',
            reason,
            attempt,
            err,
          }),
        )
        return false
      }
      await delay(POST_CORE_READY_FAKE_IP_FLUSH_RETRY_MS)
    }
  }
  return false
}

export async function runPostCoreReadyLifecycle(): Promise<{ fakeIpFlushOk: boolean }> {
  const reason = consumePendingCoreReadyReason()
  const fakeIpFlushOk = await flushFakeIpCacheWithRetry(reason)
  return { fakeIpFlushOk }
}
