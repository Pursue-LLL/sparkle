// [INPUT] factory::generateProfile/getRuntimeConfig (POS: runtime 配置生成) ·
//         mihomoApi::mihomoRules/reloadMihomoConfigFromDisk (POS: mihomo 控制器访问层) ·
//         provider::reloadMihomoProfileProviders (POS: provider 文件热刷新) ·
//         autoSwitchPinRelease::releaseAutoSwitchPins · runtimeConfigSyncCore (POS: 对齐纯决策层)
// [OUTPUT] syncRuntimeConfigToCore · regenerateAndSyncProfile: 配置生成后让运行内核采用最新规则 / 分组
// [POS] 运行时配置对齐执行层。规则、分组或 provider 定义变化时整配置重载（不断开已建立连接，新连接仅在毫秒级重载窗口内受影响）；
//       其余情况只热刷新 provider 节点文件。所有对齐请求串行执行，重载失败只记日志并保留当前内核配置。

import { appendAppLog } from '../utils/log'
import { releaseAutoSwitchPins } from './autoSwitchPinRelease'
import { generateProfile, getRuntimeConfig } from './factory'
import { mihomoRules, reloadMihomoConfigFromDisk } from './mihomoApi'
import { reloadMihomoProfileProviders, resolveVpsProviderId } from './provider'
import { decideRuntimeConfigReload, fingerprintRuntimeConfig } from './runtimeConfigSyncCore'

export interface RuntimeConfigSyncOptions {
  /** 调用方刚改动过规则 / 分组（如 Cursor 路径前缀），无需对账，直接整配置重载。 */
  force?: boolean
}

/** 本进程最近一次确认内核已采用的配置指纹；进程重启后为未知，由规则数对账兜底。 */
let appliedFingerprint: string | undefined
let syncChain: Promise<void> = Promise.resolve()

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : JSON.stringify(error)
}

async function syncOnce({ force = false }: RuntimeConfigSyncOptions): Promise<boolean> {
  const runtime = await getRuntimeConfig()
  if (!runtime) {
    await appendAppLog('[RuntimeConfigSync]: skipped, runtime config has not been generated\n')
    return false
  }

  const diskFingerprint = fingerprintRuntimeConfig(runtime)
  const diskRuleCount = runtime.rules?.length ?? 0
  const liveRuleCount = await mihomoRules().then(
    ({ rules }) => rules.length,
    () => undefined
  )
  const reason = force
    ? 'forced'
    : decideRuntimeConfigReload({ diskFingerprint, diskRuleCount, appliedFingerprint, liveRuleCount })

  if (!reason) {
    if (liveRuleCount !== undefined) {
      appliedFingerprint = diskFingerprint
    }
    return false
  }

  try {
    await reloadMihomoConfigFromDisk()
  } catch (error) {
    await appendAppLog(`[RuntimeConfigSync]: reload failed reason=${reason} err=${describeError(error)}\n`)
    return false
  }
  appliedFingerprint = diskFingerprint
  await appendAppLog(
    `[RuntimeConfigSync]: reloaded reason=${reason} rules=${liveRuleCount ?? 'unknown'}->${diskRuleCount}\n`
  )
  // store-selected 会在重载时把 cache.db 的历史选点重新恢复为固定，与内核启动后的处理一致。
  await releaseAutoSwitchPins('all')
  return true
}

/** 让运行中的内核采用磁盘上最新生成的配置；返回是否发生了整配置重载。 */
export function syncRuntimeConfigToCore(options: RuntimeConfigSyncOptions = {}): Promise<boolean> {
  const run = syncChain.then(() => syncOnce(options))
  syncChain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

/** 重新生成配置并对齐内核：规则 / 分组变化走整配置重载，否则只热刷新 provider 节点。返回是否整配置重载。 */
export async function regenerateAndSyncProfile(profileId: string): Promise<boolean> {
  await generateProfile()
  if (await syncRuntimeConfigToCore()) {
    return true
  }
  const runtime = await getRuntimeConfig()
  const hasVpsProvider = Boolean(runtime['proxy-providers']?.[resolveVpsProviderId(profileId)])
  await reloadMihomoProfileProviders(profileId, hasVpsProvider)
  return false
}
