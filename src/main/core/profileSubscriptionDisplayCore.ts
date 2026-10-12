// [INPUT] subscription-userinfo expire field (seconds or milliseconds)
// [OUTPUT] normalizeSubscriptionExpireTimestamp · subscriptionUpdateCardLabel · subscriptionScheduleHint · mergeProfileUpdateCardLabel · mergeProfileUpdateTooltipLabel
// [POS] Profile card must not show expire date without label; show daily schedule + relative update (BUG-2026-09-03-003)

const SUBSCRIPTION_EXPIRE_MS_THRESHOLD = 10_000_000_000

export function normalizeSubscriptionExpireTimestamp(raw: number | undefined): number | undefined {
  if (raw === undefined || !Number.isFinite(raw) || raw <= 0) {
    return undefined
  }
  const normalized = Math.floor(raw)
  if (normalized >= SUBSCRIPTION_EXPIRE_MS_THRESHOLD) {
    return Math.floor(normalized / 1000)
  }
  return normalized
}

export function formatSubscriptionExpireDate(
  expireUnixSec: number | undefined,
  locale: 'zh' | 'en' = 'zh',
): string {
  const normalized = normalizeSubscriptionExpireTimestamp(expireUnixSec)
  if (!normalized) {
    return locale === 'zh' ? '长期有效' : 'No expiry'
  }
  const date = new Date(normalized * 1000)
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function subscriptionExpireDisplayLabel(
  expireUnixSec: number | undefined,
  locale: 'zh' | 'en' = 'zh',
): string {
  const date = formatSubscriptionExpireDate(expireUnixSec, locale)
  if (locale === 'zh') {
    return date === '长期有效' ? date : `到期 ${date}`
  }
  return date === 'No expiry' ? date : `Exp ${date}`
}

export function subscriptionUpdateDisplayLabel(
  updatedMs: number | undefined,
  relativeLabel: string,
  locale: 'zh' | 'en' = 'zh',
): string {
  if (!updatedMs || !Number.isFinite(updatedMs)) {
    return locale === 'zh' ? '更新 —' : 'Updated —'
  }
  return locale === 'zh' ? `更新 ${relativeLabel}` : `Updated ${relativeLabel}`
}

export function subscriptionScheduleHint(
  updateTime: string | undefined,
  interval: number | undefined,
  locale: 'zh' | 'en' = 'zh',
): string | null {
  if (updateTime) {
    return locale === 'zh' ? `每日 ${updateTime}` : `Daily ${updateTime}`
  }
  if (interval && interval > 0) {
    const hours = Math.max(1, Math.round(interval / 60))
    return locale === 'zh' ? `每 ${hours} 小时` : `Every ${hours}h`
  }
  return null
}

export function subscriptionUpdateCardLabel(
  updatedMs: number | undefined,
  relativeLabel: string,
  updateTime: string | undefined,
  interval: number | undefined,
  locale: 'zh' | 'en' = 'zh',
): string {
  const schedule = subscriptionScheduleHint(updateTime, interval, locale)
  const updatePart = subscriptionUpdateDisplayLabel(updatedMs, relativeLabel, locale)
  if (schedule) {
    return `${schedule} · ${updatePart}`
  }
  return updatePart
}

export function subscriptionUpdateTooltipLabel(
  updatedMs: number | undefined,
  updateTime: string | undefined,
  interval: number | undefined,
  locale: 'zh' | 'en' = 'zh',
): string {
  const lastUpdate =
    updatedMs && Number.isFinite(updatedMs)
      ? locale === 'zh'
        ? `上次更新：${formatSubscriptionLocalDateTime(updatedMs, locale)}`
        : `Last update: ${formatSubscriptionLocalDateTime(updatedMs, locale)}`
      : locale === 'zh'
        ? '上次更新：—'
        : 'Last update: —'
  const schedule = subscriptionScheduleHint(updateTime, interval, locale)
  if (!schedule) {
    return lastUpdate
  }
  return locale === 'zh'
    ? `${lastUpdate} · 定时 ${schedule.replace('每日 ', '')}`
    : `${lastUpdate} · Scheduled ${schedule.replace('Daily ', '')}`
}

/** 合并订阅没有自己的定时，跟随来源订阅重建；卡片只展示最近一次重建的相对时间。 */
export function mergeProfileUpdateCardLabel(
  updatedMs: number | undefined,
  relativeLabel: string,
  locale: 'zh' | 'en' = 'zh',
): string {
  const updatePart = subscriptionUpdateDisplayLabel(updatedMs, relativeLabel, locale)
  return locale === 'zh' ? `跟随来源 · ${updatePart}` : `Follows sources · ${updatePart}`
}

export function mergeProfileUpdateTooltipLabel(
  updatedMs: number | undefined,
  locale: 'zh' | 'en' = 'zh',
): string {
  const lastUpdate = subscriptionUpdateTooltipLabel(updatedMs, undefined, undefined, locale)
  return locale === 'zh'
    ? `${lastUpdate} · 来源订阅更新后自动重建`
    : `${lastUpdate} · Rebuilt automatically after sources update`
}

function formatSubscriptionLocalDateTime(updatedMs: number, _locale: 'zh' | 'en'): string {
  const date = new Date(updatedMs)
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  const formatted = `${yyyy}-${mm}-${dd} ${hh}:${min}`
  return formatted
}
