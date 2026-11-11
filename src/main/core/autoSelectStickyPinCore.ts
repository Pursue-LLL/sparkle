// [INPUT] `自动选择` 组在 mihomo 的状态（type / now / fixed / all）· 上一轮观察记忆 · 当前时间戳
// [OUTPUT] decideStickyPin · recordRestoredStickyPin · shouldRecheckFixedNodeRegion · recordFixedNodeRegionCheck · INITIAL_STICKY_PIN_MEMORY · INITIAL_FIXED_NODE_REGION_CHECK_MEMORY · STICKY_PIN_STABLE_POLLS · STICKY_PIN_RESTORE_COOLDOWN_MS · FIXED_NODE_REGION_RECHECK_MS
// [POS] `自动选择` 粘性决策 + 固定节点地区复核节流：fallback 选出的存活节点连续稳定后固定下来，之后只有该节点真挂掉才会换；
// 地区复核只在节点变化或 5 分钟窗口到期时触发。纯函数模块，便于单测。
//
// 为什么要固定：原生 fallback 无迟滞，排在前面的节点一次探测失败即被放弃、恢复后立刻回切，
// 同一个存活节点会被反复换掉。固定后 mihomo 在该节点存活时一直使用它。
//
// 为什么丢固定要先单点复测：mihomo 全组并发体检极易让健康节点偶发超时（单次失败即清 fixed）。
// 若不复测直接固定新节点，单次误报就会造成不可逆的单向降级（台湾→日本→…→末尾）。
// 因此原固定节点仍在组内但 fixed 变空时，先触发单点独立复测；若同一节点在冷却窗口内再次丢固定，
// 说明节点确实不稳，不再恢复，交由 fallback 切换到下一个存活节点。
//
// 孤儿固定：固定的节点已不在组内（订阅刷新后节点集合变了，或 cache.db 恢复了旧固定）时，
// mihomo 的 fallback 找不到该节点，会一直返回首个成员而不再判断存活，必须解除。

/** `now` 需连续稳定的轮询次数：跳过节点挂掉后 mihomo 首次求值时返回的过渡节点。 */
export const STICKY_PIN_STABLE_POLLS = 2

/** 同一节点因单点复测恢复固定后的冷却窗口：窗口内再次丢固定视为节点不稳，不再救回。 */
export const STICKY_PIN_RESTORE_COOLDOWN_MS = 10 * 60 * 1000

/** 固定节点的 Gemini 地区复核间隔：无需每 3 秒读订阅文件，节点变化时立即复核。 */
export const FIXED_NODE_REGION_RECHECK_MS = 5 * 60 * 1000

const FALLBACK_GROUP_TYPE = 'Fallback'

export interface AutoSelectGroupSnapshot {
  type: string
  now: string
  fixed?: string
  all: readonly string[]
}

export interface StickyPinMemory {
  pinned: string
  lastRestoredNode: string
  lastRestoredAtMs: number
  candidate: string
  stablePolls: number
}

export interface FixedNodeRegionCheckMemory {
  node: string
  checkedAtMs: number
}

export type StickyPinAction =
  | { kind: 'none' }
  | { kind: 'pin'; node: string }
  | { kind: 'verify-lost-pin'; node: string }
  | { kind: 'unfix'; orphan: string }

export interface StickyPinDecision {
  action: StickyPinAction
  memory: StickyPinMemory
}

export const INITIAL_STICKY_PIN_MEMORY: StickyPinMemory = {
  pinned: '',
  lastRestoredNode: '',
  lastRestoredAtMs: 0,
  candidate: '',
  stablePolls: 0
}

export const INITIAL_FIXED_NODE_REGION_CHECK_MEMORY: FixedNodeRegionCheckMemory = {
  node: '',
  checkedAtMs: 0
}

function withCooldownPreserved(
  memory: StickyPinMemory,
  overrides: Partial<StickyPinMemory> = {}
): StickyPinMemory {
  return {
    ...INITIAL_STICKY_PIN_MEMORY,
    lastRestoredNode: memory.lastRestoredNode,
    lastRestoredAtMs: memory.lastRestoredAtMs,
    ...overrides
  }
}

export function recordRestoredStickyPin(node: string, nowMs: number): StickyPinMemory {
  return {
    pinned: node,
    lastRestoredNode: node,
    lastRestoredAtMs: nowMs,
    candidate: '',
    stablePolls: 0
  }
}

export function decideStickyPin(
  group: AutoSelectGroupSnapshot,
  memory: StickyPinMemory,
  nowMs: number = Date.now()
): StickyPinDecision {
  if (group.type !== FALLBACK_GROUP_TYPE) {
    return { action: { kind: 'none' }, memory: INITIAL_STICKY_PIN_MEMORY }
  }

  const fixed = group.fixed ?? ''
  if (fixed !== '') {
    if (!group.all.includes(fixed)) {
      return {
        action: { kind: 'unfix', orphan: fixed },
        memory: withCooldownPreserved(memory)
      }
    }
    return {
      action: { kind: 'none' },
      memory: withCooldownPreserved(memory, { pinned: fixed })
    }
  }

  if (memory.pinned !== '' && group.all.includes(memory.pinned)) {
    const inRestoreCooldown =
      memory.lastRestoredNode === memory.pinned &&
      memory.lastRestoredAtMs > 0 &&
      nowMs - memory.lastRestoredAtMs < STICKY_PIN_RESTORE_COOLDOWN_MS
    if (!inRestoreCooldown) {
      const validNow = group.now !== '' && group.all.includes(group.now)
      return {
        action: { kind: 'verify-lost-pin', node: memory.pinned },
        memory: withCooldownPreserved(memory, {
          candidate: validNow ? group.now : '',
          stablePolls: validNow ? 1 : 0
        })
      }
    }
  }

  if (group.now === '' || !group.all.includes(group.now)) {
    return { action: { kind: 'none' }, memory: withCooldownPreserved(memory) }
  }

  const stablePolls = group.now === memory.candidate ? memory.stablePolls + 1 : 1
  if (stablePolls >= STICKY_PIN_STABLE_POLLS) {
    return {
      action: { kind: 'pin', node: group.now },
      memory: withCooldownPreserved(memory)
    }
  }
  return {
    action: { kind: 'none' },
    memory: withCooldownPreserved(memory, { candidate: group.now, stablePolls })
  }
}

export function shouldRecheckFixedNodeRegion(
  fixed: string,
  memory: FixedNodeRegionCheckMemory,
  nowMs: number = Date.now()
): boolean {
  if (fixed === '') {
    return false
  }
  if (fixed !== memory.node || memory.checkedAtMs <= 0) {
    return true
  }
  return nowMs - memory.checkedAtMs >= FIXED_NODE_REGION_RECHECK_MS
}

export function recordFixedNodeRegionCheck(
  fixed: string,
  nowMs: number = Date.now()
): FixedNodeRegionCheckMemory {
  return { node: fixed, checkedAtMs: nowMs }
}
