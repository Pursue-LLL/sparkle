export function isBlankProfileConfigRaw(raw: string): boolean {
  // Lazy import avoided — parse minimal YAML shape without pulling electron deps in tests.
  if (!raw.trim()) {
    return true
  }
  const hasItemLine = /^\s*-\s+id:/m.test(raw)
  const emptyItems = /^\s*items:\s*\[\s*\]\s*$/m.test(raw) || /^\s*items:\s*$/m.test(raw)
  if (emptyItems && !hasItemLine) {
    return true
  }
  return !hasItemLine
}

export function isEmptyPersistableProfileConfig(config: ProfileConfig): boolean {
  return !Array.isArray(config.items) || config.items.length === 0
}

const AUX_PROFILE_SUFFIXES = ['-proxies.yaml', '-vps-proxies.yaml', '-raw-download.yaml'] as const

export function profileIdFromSubscriptionFile(fileName: string): string | null {
  if (!fileName.endsWith('.yaml')) {
    return null
  }
  if (fileName === 'default.yaml') {
    return null
  }
  if (AUX_PROFILE_SUFFIXES.some((suffix) => fileName.endsWith(suffix))) {
    return null
  }
  return fileName.slice(0, -'.yaml'.length)
}

export function mergeProfileConfigItems(
  primary: ProfileItem[],
  secondary: ProfileItem[]
): ProfileItem[] {
  const merged = [...primary]
  const seen = new Set(primary.map((item) => item.id))
  for (const item of secondary) {
    if (seen.has(item.id)) {
      continue
    }
    merged.push(item)
    seen.add(item.id)
  }
  return merged
}

export function buildRecoveredProfileItemFromDisk(id: string, updatedMs: number): ProfileItem {
  return {
    id,
    name: id.endsWith('sub001') ? (id.startsWith('77caf1') ? '移动订阅' : '主订阅') : id,
    type: 'remote',
    verify: false,
    autoUpdate: true,
    disableRemoteInterval: true,
    substore: false,
    interval: 240,
    updateTime: '07:00',
    override: ['c7sgvps01'],
    useProxy: false,
    updated: updatedMs,
    locked: false
  }
}
