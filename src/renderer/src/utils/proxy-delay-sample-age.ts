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

export const PROXY_DELAY_AGE_TICK_MS = 30_000

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
  return locale === 'zh' ? `测试于 ${age} · ${delayLabel}` : `Tested ${age} · ${delayLabel}`
}

/** 「不稳定」状态的延迟小字：显示的是上次成功的延迟，明确告诉用户它是多久前测的。 */
export function formatFlakyDelayCaption(
  lastSuccessAtIso: string | undefined,
  nowMs: number = Date.now()
): string {
  const age = formatProxyDelaySampleAge(lastSuccessAtIso, nowMs, 'zh')
  return age ? `${age}成功` : '上次成功'
}

/** 「不稳定」状态的提示：近期时好时坏，最近一次失败，不能据此判定节点已死。 */
export function formatFlakyDelayTooltip(
  lastSuccessDelay: number,
  lastSuccessAtIso: string | undefined,
  nowMs: number = Date.now()
): string {
  const age = formatProxyDelaySampleAge(lastSuccessAtIso, nowMs, 'zh')
  const lastSuccess = age ? `${age}成功 ${lastSuccessDelay}ms` : `上次成功 ${lastSuccessDelay}ms`
  return `近期时好时坏：最近一次测速失败，${lastSuccess}`
}
