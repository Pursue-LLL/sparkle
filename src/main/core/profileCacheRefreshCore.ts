// [INPUT] profilesDir disk yaml · runtimeConfigSync::regenerateAndSyncProfile (POS: 运行时配置对齐执行层) ·
//         utils/dirs::profilePath (POS: 应用目录与路径常量) ·
//         utils/log::appendAppLog (POS: 应用日志与内核日志)
// [OUTPUT] reloadCurrentProfileFromDiskCache · readProfileDiskUpdatedMs · formatMissingSubscriptionUrlError
// [POS] 无订阅 URL 时从磁盘缓存重新生成配置并让内核采用（BUG-2026-09-03-003 侧边栏刷新）

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
  const { regenerateAndSyncProfile } = await import('./runtimeConfigSync')
  const fullReload = await regenerateAndSyncProfile(profileId)
  await appendAppLog(
    `[ProfileCacheRefresh]: reloaded profile=${profileId} source=disk_cache mode=${fullReload ? 'config' : 'providers'}\n`
  )
}
