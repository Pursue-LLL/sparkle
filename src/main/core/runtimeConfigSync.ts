// [INPUT] factory::generateProfile/getRuntimeConfig (POS: runtime 配置生成) ·
//         mihomoApi::mihomoRules/reloadMihomoConfigFromDisk (POS: mihomo 控制器访问层) ·
//         provider::reloadMihomoProfileProviders/resolveVpsProviderId (POS: provider 文件热刷新) ·
//         autoSwitchPinRelease::releaseAutoSwitchPins (POS: 自动切换组固定释放执行层) ·
//         runtimeConfigSyncEngine::createRuntimeConfigSync (POS: 对齐编排层) · utils/log::appendAppLog
// [OUTPUT] syncRuntimeConfigToCore · regenerateAndSyncProfile: 配置生成后让运行内核采用最新规则 / 分组
// [POS] 运行时配置对齐接线层：把配置生成、控制器、provider 刷新与固定释放接入对齐编排，自身不含逻辑。

import { appendAppLog } from '../utils/log'
import { releaseAutoSwitchPins } from './autoSwitchPinRelease'
import { generateProfile, getRuntimeConfig } from './factory'
import { mihomoRules, reloadMihomoConfigFromDisk } from './mihomoApi'
import { reloadMihomoProfileProviders, resolveVpsProviderId } from './provider'
import { createRuntimeConfigSync } from './runtimeConfigSyncEngine'

const runtimeConfigSync = createRuntimeConfigSync({
  generateProfile,
  getRuntimeConfig,
  liveRuleCount: async () => (await mihomoRules()).rules.length,
  reloadFromDisk: reloadMihomoConfigFromDisk,
  releaseCachedPins: () => releaseAutoSwitchPins('all'),
  reloadProviders: reloadMihomoProfileProviders,
  resolveVpsProviderId,
  log: appendAppLog
})

export const syncRuntimeConfigToCore = runtimeConfigSync.sync
export const regenerateAndSyncProfile = runtimeConfigSync.regenerateAndSync
