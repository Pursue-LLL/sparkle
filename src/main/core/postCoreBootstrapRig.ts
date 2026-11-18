// [INPUT] node:test 假时钟与模块替身 · postCoreBootstrap（被测模块，替身之后动态加载）·
//         groupFailoverEngineHarness::flush (POS: 故障转移引擎测试夹具) ·
//         dedicatedGroups::DedicatedGroupGate/DedicatedGroupId (POS: 可开关专用组注册表与开关解析)
// [OUTPUT] usePostCoreBootstrapRig · calls · logs · behavior · gates · allEnabled · advance · settle · runBootstrap
// [POS] postCoreBootstrap*.test.ts 共用夹具：把内核就绪后要启动的各服务换成按调用顺序记账的替身，
//       开关用 `behavior.enabled` 控制，各探测循环收到的开关留在 `gates`。仅供测试使用。

import { mock, after, afterEach, before, beforeEach } from 'node:test'
import type { DedicatedGroupGate, DedicatedGroupId } from './dedicatedGroups'
import { flush } from './groupFailoverEngineHarness'
import type * as PostCoreBootstrap from './postCoreBootstrap'

export const calls: string[] = []
export const logs: string[] = []

export function allEnabled(): Record<DedicatedGroupId, boolean> {
  return { grok: true, gemini: true, mail: true, agy: true }
}

export const behavior: {
  probe: () => Promise<void>
  syncResult: boolean
  warmedGroups: number
  cursorSwitched: boolean
  logFails: boolean
  failing: Set<string>
  enabled: Record<DedicatedGroupId, boolean>
} = {
  probe: async () => undefined,
  syncResult: true,
  warmedGroups: 0,
  cursorSwitched: true,
  logFails: false,
  failing: new Set(),
  enabled: allEnabled()
}

/** 各循环收到的开关：用来验证每个循环拿到的是自己那个组的开关。 */
export const gates = new Map<string, DedicatedGroupGate>()

/** 记录调用顺序；被标记为失败的步骤抛错，用来验证单步失败不会拖垮后续服务。 */
function step<Args extends unknown[], Result>(
  label: string,
  result?: Result
): (...args: Args) => Promise<Result> {
  return async () => {
    calls.push(label)
    if (behavior.failing.has(label)) {
      throw new Error(`${label} boom`)
    }
    return result as Result
  }
}

function syncStep<Result>(label: string, result?: Result): () => Result {
  return () => {
    calls.push(label)
    if (behavior.failing.has(label)) {
      throw new Error(`${label} boom`)
    }
    return result as Result
  }
}

/** 探测循环的启动桩：记录调用顺序，并留下收到的开关。 */
function loopStep(label: string): (gate: DedicatedGroupGate) => void {
  const record = syncStep<void>(label)
  return (gate) => {
    gates.set(label, gate)
    record()
  }
}

/** 假时钟按 500ms 推进，每步之后让异步流程跑完。 */
export async function advance(ms: number): Promise<void> {
  for (let remaining = ms; remaining > 0; remaining -= 500) {
    mock.timers.tick(Math.min(500, remaining))
    await flush()
  }
}

/** 动态 import 与异步步骤需要若干轮事件循环才能全部跑完。 */
export async function settle(): Promise<void> {
  for (let round = 0; round < 20; round++) {
    await flush()
  }
}

export function usePostCoreBootstrapRig(): () => typeof PostCoreBootstrap {
  let bootstrap: typeof PostCoreBootstrap

  before(async () => {
    mock.module('../utils/log', {
      exports: {
        appendAppLog: async (line: string): Promise<void> => {
          if (behavior.logFails) throw new Error('disk full')
          logs.push(line)
        }
      }
    })
    mock.module('./mihomoControllerReadyCore', {
      exports: { probeMihomoControllerVersion: (): Promise<void> => behavior.probe() }
    })
    mock.module('./probeWarmupState', {
      exports: {
        beginProbeWarmup: syncStep('warmup:begin'),
        endProbeWarmup: syncStep('warmup:end')
      }
    })
    mock.module('./runtimeConfigSync', {
      exports: {
        syncRuntimeConfigToCore: async (): Promise<boolean> => {
          calls.push('sync')
          if (behavior.failing.has('sync')) throw new Error('sync boom')
          return behavior.syncResult
        }
      }
    })
    mock.module('./autoSwitchPinRelease', {
      exports: {
        releaseAutoSwitchPins: async (scope: string): Promise<void> => {
          calls.push(`release:${scope}`)
        }
      }
    })
    mock.module('./dedicatedGroupSwitch', {
      exports: {
        dedicatedGroupGate:
          (id: DedicatedGroupId): DedicatedGroupGate =>
          async () =>
            behavior.enabled[id]
      }
    })
    mock.module('./sparkleFastLatencyOrder', {
      exports: {
        bootstrapSparkleFastLatencyOrder: step('fast:bootstrap'),
        startSparkleFastLatencyOrderLoop: syncStep('fast:loop')
      }
    })
    mock.module('./sparkleGeminiProbe', {
      exports: {
        bootstrapSparkleGeminiRegionAudit: step('gemini:bootstrap'),
        startSparkleGeminiRegionAuditLoop: loopStep('gemini:loop')
      }
    })
    mock.module('./sparkleMailProbe', {
      exports: {
        bootstrapSparkleMailProvider: step('mail:bootstrap'),
        startSparkleMailProbeLoop: loopStep('mail:loop')
      }
    })
    mock.module('./sparkleMailCurrentNodeProbe', {
      exports: { startSparkleMailCurrentNodeProbeLoop: loopStep('mail:current-node') }
    })
    mock.module('./sparkleGrokProbe', {
      exports: {
        bootstrapSparkleGrokProvider: step('grok:bootstrap'),
        startSparkleGrokProbeLoop: loopStep('grok:loop')
      }
    })
    mock.module('./sparkleAgyProbe', {
      exports: {
        bootstrapSparkleAgyProvider: step('agy:bootstrap'),
        startSparkleAgyProbeLoop: loopStep('agy:loop')
      }
    })
    mock.module('./autoSelectStickyPin', {
      exports: { startAutoSelectStickyPin: syncStep('sticky-pin') }
    })
    mock.module('./groupFailover', { exports: { startGroupFailover: syncStep('failover') } })
    mock.module('./profileUpdater', {
      exports: { initProfileUpdater: syncStep('profile-updater') }
    })
    mock.module('./cursorDedicatedDefault', {
      exports: {
        applyCursorDedicatedVpsSelection: async (): Promise<boolean> => {
          calls.push('cursor-default')
          if (behavior.failing.has('cursor-default')) throw new Error('cursor-default boom')
          return behavior.cursorSwitched
        }
      }
    })
    mock.module('./mihomoApi', {
      exports: {
        mihomoGroups: step('groups', []),
        mihomoChangeProxy: step('change-proxy', true),
        mihomoGetConnections: step('connections', { connections: [] }),
        mihomoGroupDelay: step('group-delay', {})
      }
    })
    mock.module('./regionalUrlTestWarmup', {
      exports: {
        collectActiveWarmupGroupNames: (): Set<string> => new Set(['Sparkle-台湾']),
        warmupRegionalUrlTestGroups: async (): Promise<number> => {
          calls.push('warmup:regional')
          if (behavior.failing.has('warmup:regional')) throw new Error('warmup boom')
          return behavior.warmedGroups
        }
      }
    })
    mock.module('./providerLeafProbe', {
      exports: { verifyUnconfirmedFailures: step('verify-failures', 0) }
    })
    bootstrap = await import('./postCoreBootstrap')
  })

  beforeEach(() => {
    calls.length = 0
    logs.length = 0
    behavior.probe = async () => undefined
    behavior.syncResult = true
    behavior.warmedGroups = 0
    behavior.cursorSwitched = true
    behavior.logFails = false
    behavior.failing = new Set()
    behavior.enabled = allEnabled()
    gates.clear()
    mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  })

  afterEach(() => {
    mock.timers.reset()
  })

  after(() => {
    mock.restoreAll()
  })

  return () => bootstrap
}

/** 跑完一次内核就绪后的启动编排（含其间所有异步步骤）。 */
export async function runBootstrap(
  bootstrap: typeof PostCoreBootstrap,
  coreInit: Promise<void> = Promise.resolve()
): Promise<void> {
  const done = bootstrap.runPostCoreBootstrap(coreInit)
  await settle()
  await done
  await settle()
}
