// [INPUT] profilesDir disk yaml · factory generateProfile · provider reloadMihomoProfileProviders
// [OUTPUT] recoverProfileConfigFromDisk · syncProfileItemUpdatedFromDisk · isBlankProfileConfigRaw
// [POS] profile.yaml 损坏/空文件时的订阅索引恢复 SSOT（BUG-2026-09-03-003）

import { existsSync } from 'fs'
import { readdir, readFile, stat } from 'fs/promises'
import path from 'path'
import { parseYaml } from '../utils/yaml'
import { profileConfigPath, profilesDir } from '../utils/dirs'
import {
  buildRecoveredProfileItemFromDisk,
  isEmptyPersistableProfileConfig,
  mergeProfileConfigItems,
  profileIdFromSubscriptionFile
} from './profileConfigRecoveryPureCore'

export {
  buildRecoveredProfileItemFromDisk,
  isEmptyPersistableProfileConfig,
  mergeProfileConfigItems,
  profileIdFromSubscriptionFile
} from './profileConfigRecoveryPureCore'

export function isBlankProfileConfigRaw(raw: string): boolean {
  if (!raw.trim()) {
    return true
  }
  const parsed = parseYaml(raw) as ProfileConfig | null
  return !parsed || !Array.isArray(parsed.items) || parsed.items.length === 0
}

export async function listRecoverableProfileIdsFromDisk(): Promise<string[]> {
  if (!existsSync(profilesDir())) {
    return []
  }
  const entries = await readdir(profilesDir())
  const ids: string[] = []
  for (const entry of entries) {
    const id = profileIdFromSubscriptionFile(entry)
    if (!id) {
      continue
    }
    const filePath = path.join(profilesDir(), entry)
    const fileStat = await stat(filePath)
    if (fileStat.size > 64) {
      ids.push(id)
    }
  }
  return ids.sort()
}

export async function buildProfileConfigFromDiskProfiles(): Promise<ProfileConfig | null> {
  const ids = await listRecoverableProfileIdsFromDisk()
  if (ids.length === 0) {
    return null
  }

  const items: ProfileItem[] = []
  let newestId = ids[0]
  let newestUpdatedMs = 0

  for (const id of ids) {
    const filePath = path.join(profilesDir(), `${id}.yaml`)
    const fileStat = await stat(filePath)
    items.push(buildRecoveredProfileItemFromDisk(id, fileStat.mtimeMs))
    if (fileStat.mtimeMs >= newestUpdatedMs) {
      newestUpdatedMs = fileStat.mtimeMs
      newestId = id
    }
  }

  return {
    current: newestId,
    items
  }
}

async function readProfileConfigBackupCandidates(): Promise<ProfileConfig[]> {
  const configPath = profileConfigPath()
  const dataDirPath = path.dirname(configPath)
  const baseName = path.basename(configPath)
  if (!existsSync(dataDirPath)) {
    return []
  }

  const entries = await readdir(dataDirPath)
  const backupFiles = entries
    .filter((entry) => entry.startsWith(`${baseName}.bak`))
    .map((entry) => path.join(dataDirPath, entry))

  const configs: { config: ProfileConfig; mtimeMs: number }[] = []
  for (const backupFile of backupFiles) {
    const raw = await readFile(backupFile, 'utf-8')
    if (isBlankProfileConfigRaw(raw)) {
      continue
    }
    const parsed = parseYaml(raw) as ProfileConfig
    if (!parsed?.items?.length) {
      continue
    }
    const fileStat = await stat(backupFile)
    configs.push({ config: parsed, mtimeMs: fileStat.mtimeMs })
  }

  configs.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return configs.map((entry) => entry.config)
}

export async function recoverProfileConfigFromDisk(): Promise<ProfileConfig | null> {
  const backups = await readProfileConfigBackupCandidates()
  const diskConfig = await buildProfileConfigFromDiskProfiles()

  if (backups.length === 0) {
    return diskConfig
  }

  const mergedItems = mergeProfileConfigItems(backups[0].items, diskConfig?.items ?? [])
  if (mergedItems.length === 0) {
    return null
  }

  const syncedItems = await syncProfileItemUpdatedFromDisk(mergedItems)

  const currentFromBackup =
    backups[0].current && syncedItems.some((item) => item.id === backups[0].current)
      ? backups[0].current
      : undefined
  const currentFromDisk =
    diskConfig?.current && syncedItems.some((item) => item.id === diskConfig.current)
      ? diskConfig.current
      : undefined

  return {
    current: currentFromDisk ?? currentFromBackup ?? syncedItems[0].id,
    items: syncedItems
  }
}

export async function syncProfileItemUpdatedFromDisk(items: ProfileItem[]): Promise<ProfileItem[]> {
  const synced: ProfileItem[] = []
  for (const item of items) {
    const filePath = path.join(profilesDir(), `${item.id}.yaml`)
    if (!existsSync(filePath)) {
      synced.push(item)
      continue
    }
    const fileStat = await stat(filePath)
    synced.push({ ...item, updated: fileStat.mtimeMs })
  }
  return synced
}
