// [INPUT] 全局类型 ProfileItem
// [OUTPUT] at · remote · merged
// [POS] profileUpdaterCore*.test.ts 共用夹具：按本机时区构造时间点，并给出远程订阅 / 合并订阅条目。

/** 2026-10-<day> <hour>:<minute>，按本机时区构造，与被测代码的本地时间口径一致。 */
export const at = (day: number, hour: number, minute = 0): number =>
  new Date(2026, 9, day, hour, minute).getTime()

export function remote(overrides: Partial<ProfileItem> = {}): ProfileItem {
  return {
    id: 'main',
    name: '主订阅',
    type: 'remote',
    url: 'https://example.com/sub',
    autoUpdate: true,
    updateTime: '07:00',
    updated: at(10, 7, 0),
    ...overrides
  }
}

export function merged(overrides: Partial<ProfileItem> = {}): ProfileItem {
  return {
    id: 'merged',
    name: '合并版',
    type: 'local',
    autoUpdate: true,
    merge: { base: 'main', sources: ['main', 'mobile'], regions: [], dedicatedRegions: [] },
    updated: at(12, 11, 7),
    ...overrides
  }
}
