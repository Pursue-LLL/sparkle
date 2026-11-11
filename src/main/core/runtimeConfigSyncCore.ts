// [INPUT] MihomoConfig（rules / sub-rules / rule-providers / proxy-groups / proxy-providers）
// [OUTPUT] fingerprintRuntimeConfig · decideRuntimeConfigReload: 磁盘配置与运行内核对齐的纯决策
// [POS] 运行时配置对齐决策层。内核只有整配置重载才会采用新的规则、分组与 provider 定义，provider 热刷新只替换节点文件；
//       本层判断「磁盘上刚生成的配置」是否已被运行内核采用，不含任何 IO。

import { createHash } from 'node:crypto'

/** provider 热刷新无法让内核采用的配置段；其余字段（端口 / DNS / TUN 等）各有自己的热更新或重启路径。 */
const RELOAD_SENSITIVE_KEYS = [
  'rules',
  'sub-rules',
  'rule-providers',
  'proxy-groups',
  'proxy-providers'
] as const

type ReloadSensitiveSections = Partial<Record<(typeof RELOAD_SENSITIVE_KEYS)[number], unknown>>

export type RuntimeConfigReloadReason = 'config-changed' | 'live-rule-count-mismatch'

export interface RuntimeConfigSyncFacts {
  diskFingerprint: string
  diskRuleCount: number
  /** 本进程最近一次确认内核已采用的指纹；本进程尚未确认过为 undefined。 */
  appliedFingerprint: string | undefined
  /** 内核当前规则数；读取失败为 undefined。 */
  liveRuleCount: number | undefined
}

export function fingerprintRuntimeConfig(config: ReloadSensitiveSections): string {
  const sections = RELOAD_SENSITIVE_KEYS.map((key) => config[key] ?? null)
  return createHash('sha1').update(JSON.stringify(sections)).digest('hex')
}

/**
 * 需要整配置重载时返回原因，否则返回 null。
 * - 本进程已确认过的配置与磁盘不同：配置在本进程内变化过，内核还停留在旧配置；
 * - 内核规则数与磁盘不符：内核由其他进程 / 更早的会话启动并被保留（服务模式 GUI 重启不重启内核），
 *   跨进程无法比较指纹，规则数是唯一无需解析内核规则文法即可得到、且不会误报的对账量。
 */
export function decideRuntimeConfigReload(
  facts: RuntimeConfigSyncFacts
): RuntimeConfigReloadReason | null {
  if (facts.appliedFingerprint !== undefined && facts.appliedFingerprint !== facts.diskFingerprint) {
    return 'config-changed'
  }
  if (facts.liveRuleCount !== undefined && facts.liveRuleCount !== facts.diskRuleCount) {
    return 'live-rule-count-mismatch'
  }
  return null
}
