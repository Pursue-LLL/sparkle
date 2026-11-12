// [INPUT] runtimeConfigSyncCore::decideRuntimeConfigReload/fingerprintRuntimeConfig (POS: 对齐纯决策层) ·
//         utils/errorMessage::describeError · utils/bestEffortLog::bestEffortLog
// [OUTPUT] createRuntimeConfigSync · RuntimeConfigSyncDeps · RuntimeConfigSync · RuntimeConfigSyncOptions
// [POS] 运行时配置对齐的状态与编排。规则、分组或 provider 定义变化时整配置重载（不断开已建立连接，新连接仅在毫秒级重载窗口内受影响）；
//       其余情况只热刷新 provider 节点文件。所有对齐请求串行执行，重载失败只记日志并保留当前内核配置。
//       读写内核与生成配置的动作经 deps 注入，本层不依赖 Electron 与控制器，可脱离内核单测。

import { bestEffortLog } from '../utils/bestEffortLog'
import { describeError } from '../utils/errorMessage'
import { decideRuntimeConfigReload, fingerprintRuntimeConfig } from './runtimeConfigSyncCore'

export interface RuntimeConfigSyncOptions {
  /** 调用方刚改动过规则 / 分组（如 Cursor 路径前缀），无需对账，直接整配置重载。 */
  force?: boolean
}

export interface RuntimeConfigSyncDeps {
  generateProfile: () => Promise<void>
  /** 磁盘上最新生成的运行时配置；尚未生成时为 undefined。 */
  getRuntimeConfig: () => Promise<MihomoConfig | undefined>
  /** 运行内核当前载入的规则条数；控制器不可用时 reject。 */
  liveRuleCount: () => Promise<number>
  reloadFromDisk: () => Promise<void>
  /** 整配置重载后释放缓存恢复的固定。 */
  releaseCachedPins: () => Promise<unknown>
  reloadProviders: (profileId: string, hasVpsProvider: boolean) => Promise<void>
  resolveVpsProviderId: (profileId: string) => string
  log: (line: string) => Promise<void>
}

export interface RuntimeConfigSync {
  /** 让运行中的内核采用磁盘上最新生成的配置；返回是否发生了整配置重载。 */
  sync: (options?: RuntimeConfigSyncOptions) => Promise<boolean>
  /** 重新生成配置并对齐内核：规则 / 分组变化走整配置重载，否则只热刷新 provider 节点。返回是否整配置重载。 */
  regenerateAndSync: (profileId: string) => Promise<boolean>
}

export function createRuntimeConfigSync(deps: RuntimeConfigSyncDeps): RuntimeConfigSync {
  const writeLog = bestEffortLog(deps.log)
  /** 本进程最近一次确认内核已采用的配置指纹；进程重启后为未知，由规则数对账兜底。 */
  let appliedFingerprint: string | undefined
  let syncChain: Promise<void> = Promise.resolve()

  async function syncOnce({ force = false }: RuntimeConfigSyncOptions): Promise<boolean> {
    const runtime = await deps.getRuntimeConfig()
    if (!runtime) {
      await writeLog('[RuntimeConfigSync]: skipped, runtime config has not been generated\n')
      return false
    }

    const diskFingerprint = fingerprintRuntimeConfig(runtime)
    const diskRuleCount = runtime.rules?.length ?? 0
    const liveRuleCount = await deps.liveRuleCount().catch(() => undefined)
    const reason = force
      ? 'forced'
      : decideRuntimeConfigReload({
          diskFingerprint,
          diskRuleCount,
          appliedFingerprint,
          liveRuleCount
        })

    if (!reason) {
      if (liveRuleCount !== undefined) {
        appliedFingerprint = diskFingerprint
      }
      return false
    }

    try {
      await deps.reloadFromDisk()
    } catch (error) {
      await writeLog(
        `[RuntimeConfigSync]: reload failed reason=${reason} err=${describeError(error)}\n`
      )
      return false
    }
    appliedFingerprint = diskFingerprint
    await writeLog(
      `[RuntimeConfigSync]: reloaded reason=${reason} rules=${liveRuleCount ?? 'unknown'}->${diskRuleCount}\n`
    )
    // store-selected 会在重载时把 cache.db 的历史选点重新恢复为固定，与内核启动后的处理一致。
    await deps.releaseCachedPins()
    return true
  }

  function sync(options: RuntimeConfigSyncOptions = {}): Promise<boolean> {
    const run = syncChain.then(() => syncOnce(options))
    syncChain = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  async function regenerateAndSync(profileId: string): Promise<boolean> {
    await deps.generateProfile()
    if (await sync()) {
      return true
    }
    const runtime = await deps.getRuntimeConfig()
    const hasVpsProvider = Boolean(
      runtime?.['proxy-providers']?.[deps.resolveVpsProviderId(profileId)]
    )
    await deps.reloadProviders(profileId, hasVpsProvider)
    return false
  }

  return { sync, regenerateAndSync }
}
