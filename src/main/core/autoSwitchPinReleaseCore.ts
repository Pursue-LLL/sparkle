// [INPUT] cursorProxyGroup::AUTO_SELECT_GROUP_NAME (POS: 分组命名出处) · autoSwitchPolicy::isUrlTestGroupType (POS: 分组类型判定)
// [OUTPUT] isAutoSwitchGroup · planAutoSwitchPinRelease: 自动切换组固定（pin）释放的纯决策
// [POS] 自动切换组（URLTest / 自动选择）固定释放决策层。内核在 store-selected 下启动或整配置重载时会把 cache.db
// 里的历史选点恢复为 fixed；订阅刷新后固定节点也可能已不在组内。本层只决定释放哪些固定，不含任何 IO。

import { isUrlTestGroupType } from './autoSwitchPolicy'
import { AUTO_SELECT_GROUP_NAME } from './cursorProxyGroup'

export interface AutoSwitchGroupSnapshot {
  name: string
  type: string
  fixed?: string
  all: string[]
}

/**
 * all: 内核启动 / 整配置重载后，清除缓存恢复的全部固定；
 * orphans: 订阅刷新后，只清除节点已不在组内的固定，保留用户或粘性固定的有效选点。
 */
export type PinReleaseScope = 'all' | 'orphans'

export interface AutoSwitchPinRelease {
  group: string
  pinnedNode: string
  reason: 'cache-restored' | 'orphan'
}

/** 自动选路组：`自动选择`（Fallback）与所有 URLTest 组；Selector 等手动组不属于自动切换组。 */
export function isAutoSwitchGroup(group: { name: string; type?: string }): boolean {
  return (group.name ?? '').trim() === AUTO_SELECT_GROUP_NAME || isUrlTestGroupType(group.type)
}

export function planAutoSwitchPinRelease(
  groups: AutoSwitchGroupSnapshot[],
  scope: PinReleaseScope
): AutoSwitchPinRelease[] {
  return groups.flatMap((group): AutoSwitchPinRelease[] => {
    const pinnedNode = (group.fixed ?? '').trim()
    if (!pinnedNode || !isAutoSwitchGroup(group)) {
      return []
    }
    const orphan = !group.all.includes(pinnedNode)
    if (scope === 'orphans' && !orphan) {
      return []
    }
    return [{ group: group.name, pinnedNode, reason: orphan ? 'orphan' : 'cache-restored' }]
  })
}
