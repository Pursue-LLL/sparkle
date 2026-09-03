// [INPUT] mihomoGetConnections callers
// [OUTPUT] cached active connection count for probe/load gates
// [POS] avoids async inside mihomoProbeCoordinator hot path

let cachedActiveConnectionCount = 0

export function updateCachedMihomoActiveConnectionCount(count: number): void {
  if (!Number.isFinite(count) || count < 0) {
    return
  }
  cachedActiveConnectionCount = Math.floor(count)
}

export function getCachedMihomoActiveConnectionCount(): number {
  return cachedActiveConnectionCount
}

export function resetCachedMihomoActiveConnectionCountForTests(): void {
  cachedActiveConnectionCount = 0
}
