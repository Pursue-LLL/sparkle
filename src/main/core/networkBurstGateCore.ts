/** Pure helpers — gate commercial benchmark while network stability burst recovery is active. */

export function isNetworkBurstWindowActive(
  burstUntilMs: number,
  nowMs: number = Date.now(),
): boolean {
  return burstUntilMs > nowMs
}

export function shouldSkipCommercialBenchmarkDuringBurst(
  burstUntilMs: number,
  nowMs: number = Date.now(),
): boolean {
  return isNetworkBurstWindowActive(burstUntilMs, nowMs)
}

export function formatCommercialBenchmarkBurstSkipReason(
  burstUntilMs: number,
  nowMs: number = Date.now(),
): string {
  const remainSec = Math.max(0, Math.ceil((burstUntilMs - nowMs) / 1000))
  return `network stability burst window (~${remainSec}s remaining)`
}
