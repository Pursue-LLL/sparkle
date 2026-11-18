// [INPUT] src/main/core/customProxyGroups::ensureCustomProxyGroups (POS: Sparkle 自有分组注入) ·
//         src/main/core/dedicatedGroups::resolveDedicatedGroupSwitches (POS: 可开关专用组注册表与开关解析) ·
//         src/main/core/profileGroupNormalize (POS: 订阅分组归一与规则目标修复) ·
//         src/main/core/defaultAutoSwitchProxy::ensureSelectGroupsDefaultToAutoSwitch (POS: 自动选择与地区组默认配置) ·
//         ~/Library/Application Support/sparkle 下的 profile.yaml / profiles / work/config.yaml / config.yaml
// [OUTPUT] 就地改写 work/config.yaml 并输出 `PATCH_OK`（失败输出 `PATCH_FAIL` 并以非零退出）
// [POS] 不启动 App 的运行配置补丁：对现有 work/config.yaml 补跑分组注入、规则目标修复、分组归一与自动选路组；
//       专用分组按应用配置里的开关注入，与 App 生成配置同口径。

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import yaml from 'yaml'

async function main() {
  const userData = path.join(os.homedir(), 'Library/Application Support/sparkle')
  const profileMeta = parseYaml<{ current?: string }>(
    readFileSync(path.join(userData, 'profile.yaml'), 'utf8')
  )
  const current = profileMeta.current
  if (!current) {
    throw new Error('No current profile id in profile.yaml')
  }

  const subscriptionProfile = parseYaml<MihomoConfig>(
    readFileSync(path.join(userData, 'profiles', `${current}.yaml`), 'utf8')
  )
  const workConfigPath = path.join(userData, 'work/config.yaml')
  const profile = parseYaml<MihomoConfig>(readFileSync(workConfigPath, 'utf8'))

  const leafProxyNames = ((subscriptionProfile.proxies as { name?: string }[] | undefined) ?? [])
    .map((proxy) => proxy.name)
    .filter((name): name is string => typeof name === 'string' && name.length > 0)

  // 与 App 同源：专用分组按应用配置里的开关注入，缺省走各组默认值。
  const appConfigPath = path.join(userData, 'config.yaml')
  const appConfig = existsSync(appConfigPath)
    ? parseYaml<Pick<AppConfig, 'dedicatedGroups'>>(readFileSync(appConfigPath, 'utf8'))
    : {}
  const { resolveDedicatedGroupSwitches } = await import('../src/main/core/dedicatedGroups')

  const customProxyGroups = await import('../src/main/core/customProxyGroups')
  const defaultAutoSwitchProxy = await import('../src/main/core/defaultAutoSwitchProxy')
  const profileGroupNormalize = await import('../src/main/core/profileGroupNormalize')

  const subscriptionGroupNames =
    profileGroupNormalize.collectSubscriptionGroupNames(subscriptionProfile)
  customProxyGroups.ensureCustomProxyGroups(
    profile,
    leafProxyNames,
    resolveDedicatedGroupSwitches(appConfig.dedicatedGroups),
    current
  )
  profileGroupNormalize.rewriteMissingRuleProxyGroupTargets(profile)
  profileGroupNormalize.removeNonSubscriptionProxyGroups(profile, subscriptionGroupNames)
  defaultAutoSwitchProxy.ensureSelectGroupsDefaultToAutoSwitch(profile, current)

  writeFileSync(workConfigPath, stringifyYaml(profile), 'utf8')
  console.log('PATCH_OK', workConfigPath)
}

function parseYaml<T>(content: string): T {
  return (yaml.parse(content, { merge: true }) || {}) as T
}

function stringifyYaml(data: unknown): string {
  return yaml.stringify(data)
}

main().catch((error) => {
  console.error('PATCH_FAIL', error)
  process.exit(1)
})
