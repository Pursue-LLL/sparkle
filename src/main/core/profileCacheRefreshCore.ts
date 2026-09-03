// [INPUT] profilesDir disk yaml · factory generateProfile · provider reloadMihomoProfileProviders
// [OUTPUT] reloadCurrentProfileFromDiskCache · readProfileDiskUpdatedMs · formatMissingSubscriptionUrlError
// [POS] 无订阅 URL 时从磁盘缓存热重载 provider（BUG-2026-09-03-003 侧边栏刷新）

import { existsSync } from 'fs'
import { stat } from 'fs/promises'
import { profilePath } from '../utils/dirs'
import { appendAppLog } from '../utils/log'

export { formatMissingSubscriptionUrlError } from './profileCacheRefreshPureCore'

export async function readProfileDiskUpdatedMs(profileId: string): Promise<number | undefined> {
  const path = profilePath(profileId)
  if (!existsSync(path)) {
    return undefined
  }
  const fileStat = await stat(path)
  return fileStat.mtimeMs
}

export async function reloadCurrentProfileFromDiskCache(profileId: string): Promise<void> {
  const { generateProfile, getRuntimeConfig } = await import('./factory')
  const { reloadMihomoProfileProviders, resolveVpsProviderId } = await import('./provider')
  await generateProfile()
  const runtime = await getRuntimeConfig()
  const proxyProviders = runtime['proxy-providers'] as Record<string, unknown> | undefined
  const hasVpsProvider = Boolean(proxyProviders?.[resolveVpsProviderId(profileId)])
  await reloadMihomoProfileProviders(profileId, hasVpsProvider)
  await appendAppLog(
    `[ProfileCacheRefresh]: reloaded profile=${profileId} source=disk_cache providers=${hasVpsProvider ? 2 : 1}\n`
  )
}
