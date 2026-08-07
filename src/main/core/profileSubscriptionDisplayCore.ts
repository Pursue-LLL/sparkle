// [INPUT] subscription-userinfo expire field (seconds or milliseconds)
// [OUTPUT] normalizeSubscriptionExpireTimestamp · formatSubscriptionExpireDate
// [POS] Profile card must not show expire date without label (users misread as update time).

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
