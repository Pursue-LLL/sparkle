#!/usr/bin/env tsx
/**
 * 升级前停掉 sparkle-service 托管的内核，让新 App 启动时拉起新包里的内核。
 * 退出码：0 = 已停止或本就没有服务托管的内核；2 = 服务在运行但停止失败（调用方降级为告警）。
 */
import { stopServiceCore } from './lib/serviceCoreStop'

async function main(): Promise<void> {
  const timeoutMs = Number(process.env.SPARKLE_CORE_STOP_TIMEOUT_MS)
  const outcome = await stopServiceCore(
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? { timeoutMs } : {}
  )

  switch (outcome.kind) {
    case 'stopped':
      console.log(`[core-stop] service core stopped (HTTP ${outcome.statusCode})`)
      return
    case 'service-absent':
      console.log(`[core-stop] nothing to stop: ${outcome.reason}`)
      return
    case 'failed':
      console.error(`[core-stop] FAILED: ${outcome.reason}`)
      process.exit(2)
  }
}

void main().catch((error) => {
  console.error(`[core-stop] FAILED: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(2)
})
