// [INPUT] 测试给出的 proxy-groups / rules ·
//         cursorProxyGroup::AGY_DEDICATED_GROUP_NAME/CURSOR_DEDICATED_GROUP_NAME/GROK_DEDICATED_GROUP_NAME/MAIL_DEDICATED_GROUP_NAME… (POS: Sparkle 分组名常量与判定谓词) ·
//         customProxyGroups::HONG_KONG_FILTER_GROUP_NAME (POS: Sparkle 自有分组注入)
// [OUTPUT] SPARKLE_GROUP_NAMES · profileOf · groupNames · groupProxies · subscriptionGroupNames
// [POS] customProxyGroups*.test.ts 共用夹具：把配置里的组读成名字 / 成员列表，并区分 Sparkle 生成的组与订阅带来的组。

import {
  AGY_DEDICATED_GROUP_NAME,
  CURSOR_DEDICATED_GROUP_NAME,
  GEMINI_DEDICATED_GROUP_NAME,
  GROK_DEDICATED_GROUP_NAME,
  MAIL_DEDICATED_GROUP_NAME,
  MAIL_PROBE_HIDDEN_GROUP_NAME
} from './cursorProxyGroup'
import { HONG_KONG_FILTER_GROUP_NAME } from './customProxyGroups'

/** Sparkle 自己生成的组；其余都是订阅里带来的组。 */
export const SPARKLE_GROUP_NAMES = new Set<string>([
  CURSOR_DEDICATED_GROUP_NAME,
  HONG_KONG_FILTER_GROUP_NAME,
  GROK_DEDICATED_GROUP_NAME,
  GEMINI_DEDICATED_GROUP_NAME,
  MAIL_DEDICATED_GROUP_NAME,
  MAIL_PROBE_HIDDEN_GROUP_NAME,
  AGY_DEDICATED_GROUP_NAME
])

export function profileOf(groups: object[], rules?: string[]): MihomoConfig {
  return { 'proxy-groups': groups, ...(rules ? { rules } : {}) } as unknown as MihomoConfig
}

export function groupNames(profile: MihomoConfig): string[] {
  return ((profile['proxy-groups'] as { name: string }[] | undefined) ?? []).map(
    (group) => group.name
  )
}

export function groupProxies(profile: MihomoConfig, name: string): string[] {
  const group = ((profile['proxy-groups'] as { name: string; proxies?: string[] }[]) ?? []).find(
    (item) => item.name === name
  )
  return group?.proxies ?? []
}

export function subscriptionGroupNames(profile: MihomoConfig): string[] {
  return groupNames(profile).filter((name) => !SPARKLE_GROUP_NAMES.has(name))
}
