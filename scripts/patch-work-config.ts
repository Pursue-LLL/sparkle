import { readFileSync, writeFileSync } from 'node:fs'
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

  const customProxyGroups = await import('../src/main/core/customProxyGroups.ts')
  const defaultAutoSwitchProxy = await import('../src/main/core/defaultAutoSwitchProxy.ts')
  const profileGroupNormalize = await import('../src/main/core/profileGroupNormalize.ts')

  const subscriptionGroupNames =
    profileGroupNormalize.collectSubscriptionGroupNames(subscriptionProfile)
  customProxyGroups.ensureCustomProxyGroups(profile, leafProxyNames, current)
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
