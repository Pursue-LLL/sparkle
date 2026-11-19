// [INPUT] node:test 假时钟 · sparkleAgyProbe 及其子模块（被测，每个用例重新加载）· sparkleAgyProbeMocks · sparkleAgyProbeDirs · sparkleAgyProbeWorld ·
//         groupFailoverEngineHarness::flush (POS: 故障转移引擎测试夹具) ·
//         localProbeChannel (POS: 本地隐藏探测通道) ·
//         sparkleAgyCli (POS: 官方 agy CLI 请求) ·
//         sparkleAgyGroupControl (POS: agy 组操作) ·
//         sparkleAgyProbeSnapshot (POS: agy 展示快照)
// [OUTPUT] useAgyRig · restartProbe · snapshot/syncSnapshot/groupControl/agyCli/probeChannel · runBootstrap/runDialFailureRepair/emitAlerts/drive/expireHangingProbe/settle · 重导出 sparkleAgyProbeDirs 与 sparkleAgyProbeWorld 的全部夹具
// [POS] sparkleAgyProbe 行为测试夹具的入口：装配模块替身、每个用例重建临时目录与被测模块，并提供驱动被测代码的异步辅助。
// 替身见 sparkleAgyProbeMocks，临时文件系统见 sparkleAgyProbeDirs，场景状态见 sparkleAgyProbeWorld。仅供测试使用。

import { after, afterEach, before, beforeEach, mock } from 'node:test'
import { flush } from './groupFailoverEngineHarness'
import type * as ProbeChannel from './localProbeChannel'
import type * as AgyCli from './sparkleAgyCli'
import type * as AgyProbe from './sparkleAgyProbe'
import type * as AgyGroupControl from './sparkleAgyGroupControl'
import type * as AgySnapshot from './sparkleAgyProbeSnapshot'
import { resetAgyDirs } from './sparkleAgyProbeDirs'
import { installMocks } from './sparkleAgyProbeMocks'
import { NOW, resetWorld, world, type Proxy } from './sparkleAgyProbeWorld'

export * from './sparkleAgyProbeDirs'
export * from './sparkleAgyProbeWorld'

export async function settle(): Promise<void> {
  for (let round = 0; round < 5; round++) {
    await flush()
  }
}

/** 悬挂的假进程到点会被探测超时杀掉：推进时钟到它的超时点；没有悬挂的进程时返回 false。 */
export function expireHangingProbe(): boolean {
  const wait = world.hangingTimeoutMs
  if (wait === undefined) {
    return false
  }
  world.hangingTimeoutMs = undefined
  world.perfNowMs += wait
  mock.timers.tick(wait)
  return true
}

/** 等一个异步操作做完；途中悬挂的假进程由这里推进时钟让探测超时。 */
export async function drive<T>(operation: Promise<T>): Promise<T> {
  const state = { finished: false }
  const run = operation.finally(() => {
    state.finished = true
  })
  for (let guard = 0; guard < 500 && !state.finished; guard++) {
    await settle()
    if (!state.finished) {
      expireHangingProbe()
    }
  }
  return run
}

/** 跑完一轮 bootstrap。 */
export function runBootstrap(agy: typeof AgyProbe): Promise<void> {
  return drive(agy.bootstrapSparkleAgyProvider())
}

/** 跑完一轮被动入口（拨号失败风暴触发的修复）。 */
export function runDialFailureRepair(agy: typeof AgyProbe): Promise<void> {
  return drive(agy.repairSparkleAgyPinOnDialFailures())
}

/** 向探针订阅的内核告警流投递 `count` 条同一 payload 的 warning；时间由假时钟决定，调用方自行推进。 */
export function emitAlerts(payload: string, count = 1): void {
  for (let index = 0; index < count; index++) {
    for (const listener of world.alertListeners) {
      listener({ type: 'warning', payload })
    }
  }
}

/** 每个用例都要从零开始：探针的几个模块各自带着内存状态。 */
const AGY_MODULES = [
  './localProbeChannel',
  './sparkleAgyCli',
  './sparkleAgyProbeSnapshot',
  './sparkleAgyGroupControl',
  './sparkleAgyRound',
  './sparkleAgyRepair',
  './sparkleAgyProbe'
] as const

/** 本用例里探针当前的展示快照。 */
export function snapshot(): AgyProbeSnapshot {
  return (require('./sparkleAgyProbeSnapshot') as typeof AgySnapshot).getSparkleAgyProbeSnapshot()
}

/** 用缓存与订阅节点重建展示快照（探针自己在每轮的固定位置做这件事）。 */
export function syncSnapshot(
  proxies: Proxy[] = world.profileProxies,
  cache: ReadonlyMap<string, { usable: boolean; rttMs: number; checkedAt: number }> = new Map()
): void {
  ;(require('./sparkleAgyProbeSnapshot') as typeof AgySnapshot).syncAgyProbeSnapshot(cache, proxies)
}

/** 本用例里的 agy CLI 请求模块（探针的最底层，可直接驱动）。 */
export function agyCli(): typeof AgyCli {
  return require('./sparkleAgyCli') as typeof AgyCli
}

/** 本用例里的本地隐藏探测通道模块：与探针共用同一个实例，测试可以用它占住通道。 */
export function probeChannel(): typeof ProbeChannel {
  return require('./localProbeChannel') as typeof ProbeChannel
}

/** 本用例里的 agy 组操作模块（探针的下层，可直接驱动）。 */
export function groupControl(): typeof AgyGroupControl {
  return require('./sparkleAgyGroupControl') as typeof AgyGroupControl
}

const SECRET_ENV_NAMES = [
  'GEMINI_API_KEY',
  'GOOGLE_GEMINI_BASE_URL',
  'GOOGLE_API_KEY',
  'CLOUD_CODE_URL'
] as const

/** 本用例里当前的探针模块实例。 */
let probe: typeof AgyProbe

/** 模拟进程重启：被测模块丢掉全部内存状态，只剩磁盘上的文件；配置与 mihomo（world）原样保留。 */
export function restartProbe(): typeof AgyProbe {
  for (const module of AGY_MODULES) {
    delete require.cache[require.resolve(module)]
  }
  probe = require('./sparkleAgyProbe') as typeof AgyProbe
  return probe
}

export function useAgyRig(): () => typeof AgyProbe {
  const savedEnv = new Map<string, string | undefined>()

  before(() => {
    installMocks()
    for (const name of ['HOME', ...SECRET_ENV_NAMES]) {
      savedEnv.set(name, process.env[name])
    }
  })
  after(() => {
    for (const [name, value] of savedEnv) {
      if (value === undefined) {
        delete process.env[name]
      } else {
        process.env[name] = value
      }
    }
  })
  beforeEach(() => {
    resetWorld()
    resetAgyDirs()
    mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: NOW })
    restartProbe()
  })
  afterEach(() => {
    mock.timers.reset()
  })

  return () => probe
}
