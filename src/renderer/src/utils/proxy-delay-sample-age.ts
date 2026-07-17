export interface ProxyDelayHistoryEntry {
  time: string
  delay: number
}

export function latestProxyDelayHistoryEntry(
  history: ProxyDelayHistoryEntry[] | undefined,
): ProxyDelayHistoryEntry | undefined {
  if (!history?.length) {
    return undefined
  }
  return history[history.length - 1]
}

/** Skip trailing health-check timeouts (delay=0) — matches mihomoApi provider delay fallback. */
export function latestSuccessfulProxyDelayHistoryEntry(
  history: ProxyDelayHistoryEntry[] | undefined,
): ProxyDelayHistoryEntry | undefined {
  if (!history?.length) {
    return undefined
  }
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index]
    if (entry && entry.delay > 0) {
      return entry
    }
  }
  const latest = history[history.length - 1]
  return latest?.delay === 0 ? latest : undefined
}

/** Compact relative age for proxy delay sample timestamp (UI beside delay button). */
export function formatProxyDelaySampleAge(
  sampledAtIso: string | undefined,
  nowMs: number = Date.now(),
  locale: 'zh' | 'en' = 'zh',
): string | undefined {
  if (!sampledAtIso?.trim()) {
    return undefined
  }
  const sampledMs = Date.parse(sampledAtIso)
  if (!Number.isFinite(sampledMs)) {
    return undefined
  }
  const ageSec = Math.max(0, Math.floor((nowMs - sampledMs) / 1000))
  if (ageSec < 60) {
    return locale === 'zh' ? `${ageSec}秒前` : `${ageSec}s ago`
  }
  const ageMin = Math.floor(ageSec / 60)
  if (ageMin < 60) {
    return locale === 'zh' ? `${ageMin}分前` : `${ageMin}m ago`
  }
  const ageHour = Math.floor(ageMin / 60)
  if (ageHour < 48) {
    return locale === 'zh' ? `${ageHour}时前` : `${ageHour}h ago`
  }
  const ageDay = Math.floor(ageHour / 24)
  return locale === 'zh' ? `${ageDay}天前` : `${ageDay}d ago`
}

export function formatProxyDelayTooltip(
  delay: number,
  sampledAtIso: string | undefined,
  nowMs: number = Date.now(),
  locale: 'zh' | 'en' = 'zh',
): string | undefined {
  if (delay === -1) {
    return undefined
  }
  const age = formatProxyDelaySampleAge(sampledAtIso, nowMs, locale)
  if (!age) {
    return delay === 0
      ? locale === 'zh'
        ? '延迟测试超时'
        : 'Delay test timed out'
      : locale === 'zh'
        ? `节点延迟 ${delay}ms`
        : `Node delay ${delay}ms`
  }
  const delayLabel =
    delay === 0
      ? locale === 'zh'
        ? '超时'
        : 'Timeout'
      : locale === 'zh'
        ? `${delay}ms`
        : `${delay} ms`
  return locale === 'zh'
    ? `测试于 ${age} · ${delayLabel}`
    : `Tested ${age} · ${delayLabel}`
}
