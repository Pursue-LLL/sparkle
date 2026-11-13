// [INPUT] cursorProxyGroup::分组名常量与判定谓词 (POS: Sparkle 分组命名的唯一出处)
// [OUTPUT] GroupRole · GroupPolicy · resolveGroupRole · resolveGroupPolicy · isUrlTestGroupType
// [POS] Sparkle 各类分组「谁来切节点」的单一策略表。故障转移引擎、订阅 select 组的自动选路引用都只读这张表；
//       新增一类分组 = 在 GroupRole 与 GROUP_POLICY 各补一行（源码扫描测试会拦住漏填），无需再新增轮询或跳过名单。

import {
  AUTO_SELECT_GROUP_NAME,
  isAgyDedicatedGroupName,
  isAutoSwitchingProxyName,
  isCursorDedicatedGroupName,
  isGeminiDedicatedGroupName,
  isGrokDedicatedGroupName,
  isHongKongFilterGroupName,
  isMailDedicatedGroupName,
  isMailProbeHiddenGroupName,
  isSparkleAutoSelectSubGroup
} from './cursorProxyGroup'

export type GroupRole =
  /** 自动选择（fallback）：节点固定由粘性固定逻辑管理。 */
  | 'auto-select'
  /** Sparkle-<地区> / Sparkle-自动-Cursor / Sparkle-香港：url-test 组，故障由转移引擎兜底。 */
  | 'regional-auto'
  /** Cursor 专用：只接受用户手动选点。 */
  | 'cursor-dedicated'
  /** 邮件 / grok / agy 专用、gemini专用及邮件探测隐藏组：节点由各自的应用层探测选定。 */
  | 'probe-dedicated'
  /** 订阅自带的手动选择组：把自动选路组追加为可选成员，节点由用户选。 */
  | 'subscription-select'
  /** 订阅自带的 url-test / fallback / load-balance 等自动组：保持内核原生行为。 */
  | 'subscription-managed'

export interface GroupPolicy {
  /** 连续拨号失败时，故障转移引擎是否为该组改选节点。 */
  failover: boolean
  /** 是否把自动选路组追加为该组的可选成员。 */
  acceptsAutoSwitchRefs: boolean
}

const GROUP_POLICY: Readonly<Record<GroupRole, GroupPolicy>> = {
  'auto-select': { failover: false, acceptsAutoSwitchRefs: false },
  'regional-auto': { failover: true, acceptsAutoSwitchRefs: false },
  'cursor-dedicated': { failover: false, acceptsAutoSwitchRefs: false },
  'probe-dedicated': { failover: false, acceptsAutoSwitchRefs: false },
  'subscription-select': { failover: false, acceptsAutoSwitchRefs: true },
  'subscription-managed': { failover: false, acceptsAutoSwitchRefs: false }
}

/** 兼容配置写法（url-test / select）与控制器写法（URLTest / Selector）。 */
function normalizeGroupType(type: string | undefined): string {
  return (type ?? 'select').trim().toLowerCase().replace(/-/g, '')
}

export function isUrlTestGroupType(type: string | undefined): boolean {
  return normalizeGroupType(type) === 'urltest'
}

function isSelectGroupType(type: string | undefined): boolean {
  const normalized = normalizeGroupType(type)
  return normalized === 'select' || normalized === 'selector'
}

/** 先按组名认出 Sparkle 自有分组，其余订阅分组按类型归类；type 缺省视为 select（配置写法的默认值）。 */
export function resolveGroupRole(group: { name: string; type?: string }): GroupRole {
  const { name } = group
  if (name === AUTO_SELECT_GROUP_NAME) {
    return 'auto-select'
  }
  if (isCursorDedicatedGroupName(name)) {
    return 'cursor-dedicated'
  }
  if (isSparkleAutoSelectSubGroup(name) || isHongKongFilterGroupName(name)) {
    return 'regional-auto'
  }
  if (
    isGrokDedicatedGroupName(name) ||
    isGeminiDedicatedGroupName(name) ||
    isMailDedicatedGroupName(name) ||
    isAgyDedicatedGroupName(name) ||
    isMailProbeHiddenGroupName(name)
  ) {
    return 'probe-dedicated'
  }
  if (isAutoSwitchingProxyName(name)) {
    return 'subscription-managed'
  }
  return isSelectGroupType(group.type) ? 'subscription-select' : 'subscription-managed'
}

export function resolveGroupPolicy(group: { name: string; type?: string }): GroupPolicy {
  return GROUP_POLICY[resolveGroupRole(group)]
}
