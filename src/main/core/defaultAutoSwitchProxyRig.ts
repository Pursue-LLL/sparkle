// [INPUT] 测试给出的 proxy-groups / rules
// [OUTPUT] REGIONAL_GROUPS_WITHOUT_HONG_KONG · ProxyGroupView · profileOf · groupsOf · groupNamed
// [POS] defaultAutoSwitchProxy*.test.ts 共用夹具：把配置里的 proxy-groups 读成带类型的视图，免去每个用例重复强转。

/** 默认地区优先级生成的 5 个地区组；香港由专用组单独管理，不进入 Cursor 专用。 */
export const REGIONAL_GROUPS_WITHOUT_HONG_KONG = [
  'Sparkle-台湾',
  'Sparkle-日本',
  'Sparkle-韩国',
  'Sparkle-新加坡',
  'Sparkle-美国'
]

export interface ProxyGroupView {
  name: string
  type?: string
  proxies?: string[]
  use?: string[]
  filter?: string
  url?: string
  interval?: number
  tolerance?: number
  timeout?: number
  lazy?: boolean
  'exclude-type'?: string
}

export function profileOf(groups: ProxyGroupView[], rules?: string[]): MihomoConfig {
  return { 'proxy-groups': groups, ...(rules ? { rules } : {}) } as unknown as MihomoConfig
}

export function groupsOf(profile: MihomoConfig): ProxyGroupView[] {
  return profile['proxy-groups'] as unknown as ProxyGroupView[]
}

export function groupNamed(profile: MihomoConfig, name: string): ProxyGroupView | undefined {
  return groupsOf(profile).find((group) => group.name === name)
}
