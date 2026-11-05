// [INPUT] mihomo proxy group snapshot (name, type, now, fixed, all, testUrl) · node health predicate
// [OUTPUT] isAutoSwitchGroup · reconcileStartupAutoSwitchGroups · detectDeadlockAutoSwitchGroups
// [POS] 自动切换组（URLTest / 地区自动组）零死锁核心决策层（纯函数）：
// 杜绝 cache.db 启动恢复将自动组默认锁死，并在固定节点失活（dead）或孤儿（orphan）时自动决策熔断解钉。

import { AUTO_SELECT_GROUP_NAME } from './defaultAutoSwitchProxy'

export type AutoSwitchGroupSnapshot = {
  name: string
  type: string
  now: string
  fixed?: string
  all: string[]
  testUrl?: string
}

export type AutoSwitchIntegrityAction =
  | { kind: 'none' }
  | {
      kind: 'unfix'
      group: string
      fixedNode: string
      reason: 'startup-default-unfix' | 'orphan-pin' | 'dead-pinned-node'
    }

/**
 * 判定一个策略组是否属于「自动选路/自动切换组」。
 * - URLTest 组原生契约是根据延迟自动选优，绝不允许被默认锁定；
 * - `自动选择` 组是 Fallback 且由专用的 `autoSelectStickyPin` 独立看管，此处不重复干预；
 * - 其余所有 URLTest 或 Sparkle 自动地区组均属于自动选路组。
 */
export function isAutoSwitchGroup(group: { name: string; type?: string }): boolean {
  if (group.name === AUTO_SELECT_GROUP_NAME) {
    return false
  }
  const normalizedType = (group.type ?? '').trim().toLowerCase()
  return normalizedType === 'urltest' || normalizedType === 'url-test'
}

/**
 * 启动或配置重载时的纯净对齐决策：
 * Mihomo 内核在 `store-selected: true` 下，会把历史选点写入 `cache.db`，并在每次启动读取缓存时
 * 对 URLTest 自动组调用 Set(selected)，将其错误地置为 `fixed`（死锁）。
 * 启动对齐保证所有自动选路组默认彻底清除来自 cache.db 的 `fixed` 污染，100% 保持自动切换。
 */
export function reconcileStartupAutoSwitchGroups(
  groups: AutoSwitchGroupSnapshot[],
  explicitlyPinnedGroups?: ReadonlySet<string>
): AutoSwitchIntegrityAction[] {
  const actions: AutoSwitchIntegrityAction[] = []

  for (const group of groups) {
    if (!isAutoSwitchGroup(group)) {
      continue
    }

    const fixed = (group.fixed ?? '').trim()
    if (!fixed) {
      continue
    }

    // 孤儿固定：固定的节点甚至不在当前组的成员列表内
    if (!group.all.includes(fixed)) {
      actions.push({
        kind: 'unfix',
        group: group.name,
        fixedNode: fixed,
        reason: 'orphan-pin'
      })
      continue
    }

    // 若不是用户当前显式锁定的组，启动时必须清除 cache.db 强加的默认死锁
    if (!explicitlyPinnedGroups?.has(group.name)) {
      actions.push({
        kind: 'unfix',
        group: group.name,
        fixedNode: fixed,
        reason: 'startup-default-unfix'
      })
    }
  }

  return actions
}

/**
 * 运行时死锁熔断决策（针对已处于 fixed 锁定的自动组）：
 * 当一个自动组被锁定时，如果当前锁定的节点在测速或请求中被确认为失效（dead）或不在组内，
 * 决策层立即发出 `unfix` 动作熔断死锁，使组立即恢复原生自动故障转移。
 */
export function detectDeadlockAutoSwitchGroups(
  groups: AutoSwitchGroupSnapshot[],
  isNodeAlive: (node: string, testUrl?: string) => boolean
): AutoSwitchIntegrityAction[] {
  const actions: AutoSwitchIntegrityAction[] = []

  for (const group of groups) {
    if (!isAutoSwitchGroup(group)) {
      continue
    }

    const fixed = (group.fixed ?? '').trim()
    if (!fixed) {
      continue
    }

    // 1. 孤儿节点死锁
    if (!group.all.includes(fixed)) {
      actions.push({
        kind: 'unfix',
        group: group.name,
        fixedNode: fixed,
        reason: 'orphan-pin'
      })
      continue
    }

    // 2. 锁定节点已死亡/超时（病态死锁熔断）
    const alive = isNodeAlive(fixed, group.testUrl)
    if (!alive) {
      actions.push({
        kind: 'unfix',
        group: group.name,
        fixedNode: fixed,
        reason: 'dead-pinned-node'
      })
    }
  }

  return actions
}
