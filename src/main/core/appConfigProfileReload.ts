// [INPUT] appConfigProfileReloadCore::profileReloadKeys/shouldReloadProfileForAppConfigPatch (POS: 触发重载的配置键) ·
//         dedicatedGroupSwitch::loadDedicatedGroupSwitches (POS: 专用分组开关读取) ·
//         dedicatedGroups::newlyEnabledGroupIds/resolveDedicatedGroupSwitches (POS: 可开关专用组注册表) ·
//         factory::generateProfile (POS: runtime 配置生成) · runtimeConfigSync::syncRuntimeConfigToCore (POS: 运行时配置对齐执行层) ·
//         sparkleGrokProbe/sparkleGeminiProbe/sparkleMailProbe/sparkleAgyProbe (POS: 各专用组探测，仅取 bootstrap) ·
//         utils/errorMessage::describeError · utils/log::appendAppLog (POS: 应用日志与内核日志)
// [OUTPUT] patchAppConfigAndReloadProfile: 应用配置补丁落盘 → 必要时重新生成并重载 runtime 配置
// [POS] 应用配置补丁到运行内核的接线：补丁含影响 runtime 配置的键时，在同一串行队列里完成「落盘 → 生成 → 整配置重载」，
//       重载成功后才为刚开启的专用组补一轮探测（内核没有采用新配置则不探测，下次内核就绪时自然启动）。

import { describeError } from '../utils/errorMessage'
import { appendAppLog } from '../utils/log'
import {
  profileReloadKeys,
  shouldReloadProfileForAppConfigPatch
} from './appConfigProfileReloadCore'
import { loadDedicatedGroupSwitches } from './dedicatedGroupSwitch'
import {
  newlyEnabledGroupIds,
  resolveDedicatedGroupSwitches,
  type DedicatedGroupId
} from './dedicatedGroups'

const BOOTSTRAP_PROBE_BY_GROUP: Record<DedicatedGroupId, () => Promise<void>> = {
  grok: async () => (await import('./sparkleGrokProbe')).bootstrapSparkleGrokProvider(),
  gemini: async () => (await import('./sparkleGeminiProbe')).bootstrapSparkleGeminiRegionAudit(),
  mail: async () => (await import('./sparkleMailProbe')).bootstrapSparkleMailProvider(),
  agy: async () => (await import('./sparkleAgyProbe')).bootstrapSparkleAgyProvider()
}

let reloadChain: Promise<void> = Promise.resolve()

/** 连续的开关切换排成一队：每次都基于上一次落盘后的状态计算「刚开启了谁」，重载与探测互不交叠。 */
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = reloadChain.then(task)
  reloadChain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

function kickProbes(previous: DedicatedGroupSwitches, next: DedicatedGroupSwitches): void {
  for (const id of newlyEnabledGroupIds(previous, next)) {
    // 探测可能持续数分钟（邮件全量），不阻塞 IPC 返回；失败只记日志。
    BOOTSTRAP_PROBE_BY_GROUP[id]().catch((error) =>
      appendAppLog(`[AppConfig]: ${id} probe kick failed, ${describeError(error)}\n`)
    )
  }
}

async function regenerateAndReload(
  patch: Partial<AppConfig>,
  previous: DedicatedGroupSwitches,
  next: DedicatedGroupSwitches
): Promise<void> {
  const keys = profileReloadKeys(patch).join(',')
  try {
    const { generateProfile } = await import('./factory')
    const { syncRuntimeConfigToCore } = await import('./runtimeConfigSync')
    await generateProfile()
    const reloaded = await syncRuntimeConfigToCore({ force: true })
    void appendAppLog(
      `[AppConfig]: profile regenerated keys=${keys} reloaded=${reloaded} dedicated=${JSON.stringify(next)}\n`
    )
    if (!reloaded) {
      // 强制重载下返回 false 只有一种含义：内核没有采用新配置（未运行或重载被拒），不能当作成功。
      throw new Error('runtime config was not reloaded by the core')
    }
    kickProbes(previous, next)
  } catch (error) {
    void appendAppLog(`[AppConfig]: profile reload failed keys=${keys}, ${describeError(error)}\n`)
    if ('dedicatedGroups' in patch) {
      // 开关已落盘，但运行配置没换成功：必须让用户知道，否则界面与内核会悄悄不一致。
      throw new Error('分组开关已保存，但应用到网络失败，将在下次更新配置时生效')
    }
  }
}

export function patchAppConfigAndReloadProfile(
  patch: Partial<AppConfig>,
  applyPatch: () => Promise<AppConfig>
): Promise<AppConfig> {
  if (!shouldReloadProfileForAppConfigPatch(patch)) {
    return applyPatch()
  }
  return serialized(async () => {
    const previous = await loadDedicatedGroupSwitches()
    const nextConfig = await applyPatch()
    await regenerateAndReload(
      patch,
      previous,
      resolveDedicatedGroupSwitches(nextConfig.dedicatedGroups)
    )
    return nextConfig
  })
}
