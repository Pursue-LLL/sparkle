// [INPUT] 无（叶子模块，禁止 import manager）
// [OUTPUT] markCoreReadyAtMs · getLastCoreReadyAtMs · safeGetLastCoreReadyAtMs
// [POS] core ready 时间戳 SSOT；CTHC / mihomo watchdog startup grace 读此模块，避免 manager 循环依赖。

let lastCoreReadyAtMs = 0

export function getLastCoreReadyAtMs(): number {
  return lastCoreReadyAtMs
}

export function safeGetLastCoreReadyAtMs(): number {
  if (typeof getLastCoreReadyAtMs === 'function') {
    return getLastCoreReadyAtMs()
  }
  return lastCoreReadyAtMs || 0
}

export function markCoreReadyAtMs(atMs: number = Date.now()): void {
  lastCoreReadyAtMs = atMs
}

export function resetCoreReadyTimestampForTests(): void {
  lastCoreReadyAtMs = 0
}
