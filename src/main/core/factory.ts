import {
  getControledMihomoConfig,
  getProfileConfig,
  getProfile,
  getProfileStr,
  getProfileItem,
  getOverride,
  getOverrideItem,
  getOverrideConfig,
  getAppConfig
} from '../config'
import {
  mihomoProfileWorkDir,
  mihomoWorkConfigPath,
  mihomoWorkDir,
  overridePath
} from '../utils/dirs'
import { parseYaml, stringifyYaml } from '../utils/yaml'
import { copyFile, mkdir, readdir, writeFile } from 'fs/promises'
import { deepMerge } from '../utils/merge'
import vm from 'vm'
import { existsSync, writeFileSync } from 'fs'
import path from 'path'
import {
  extractProxies,
  setupProfileProviders,
  generateBaseConfigWithProvider
} from './provider'
import {
  collectSubscriptionGroupNames,
  removeNonSubscriptionProxyGroups,
  rewriteMissingRuleProxyGroupTargets
} from './profileGroupNormalize'
import { ensureCustomProxyGroups } from './customProxyGroups'
import { ensureSelectGroupsDefaultToAutoSwitch } from './defaultAutoSwitchProxy'
import { resolveEffectiveRegionPriority } from './regionPriority'
import { ensureVpsDirectBypass } from './vpsDirectBypass'
import { injectCursorDomainRules } from './cursorRuleInjection'
import { ensureCorporateDirectRules, ensureCorporateDnsPolicy } from './corporateDirectRules'
import { ensureFakeIpRoutingIntegrity } from './fakeIpRoutingIntegrity'
import { ensureDnsFallbackIntegrity, ensureTunStrictRoute } from './dnsFallbackIntegrity'
import { applyHysteria2ProxiesQuicStability } from './hysteria2QuicStability'
import { applyVlessVisionMuxGuard, summarizeVlessVisionMuxGuard } from './vlessVisionMuxGuardCore'
import { showNotification } from '../utils/notification'
import {
  CURSOR_DEDICATED_GROUP_NAME
} from './cursorProxyGroup'
import { appendAppLog } from '../utils/log'
import { performance } from 'node:perf_hooks'
import { readFile } from 'fs/promises'

let cursorDedicatedGroupRenameNotified = false

let runtimeConfigStr: string,
  rawProfileStr: string,
  currentProfileStr: string,
  overrideProfileStr: string,
  runtimeConfig: MihomoConfig

let generateProfileChain: Promise<void> = Promise.resolve()
let generateProfileLastStep = 'idle'

const GENERATE_PROFILE_WALL_CLOCK_MS = 60_000

async function logGenerateProfileStep(step: string, startedAtMs: number): Promise<void> {
  generateProfileLastStep = step
  const elapsedMs = Math.round(performance.now() - startedAtMs)
  await appendAppLog(`[Factory]: generateProfile step=${step} elapsed_ms=${elapsedMs}\n`)
}

/** Read merged work/config.yaml when in-memory runtimeConfig is empty (post-install / hung regen). */
export async function loadRuntimeConfigFromDisk(): Promise<MihomoConfig | null> {
  try {
    const { diffWorkDir = false } = await getAppConfig()
    const { current } = await getProfileConfig()
    const configPath = mihomoWorkConfigPath(diffWorkDir ? current : 'work')
    const raw = await readFile(configPath, 'utf-8')
    const parsed = parseYaml<MihomoConfig>(raw)
    return typeof parsed === 'object' && parsed ? parsed : null
  } catch {
    return null
  }
}

/** Populate in-memory runtime from disk when regen failed or was skipped. */
export async function hydrateRuntimeConfigFromDiskIfEmpty(): Promise<boolean> {
  const groupCount = (runtimeConfig?.['proxy-groups'] as unknown[] | undefined)?.length ?? 0
  if (groupCount > 0) {
    return false
  }
  const disk = await loadRuntimeConfigFromDisk()
  if (!disk) {
    return false
  }
  runtimeConfig = disk
  runtimeConfigStr = stringifyYaml(disk)
  await appendAppLog(
    `[Factory]: hydrate_runtime_from_disk groups=${(disk['proxy-groups'] as unknown[] | undefined)?.length ?? 0}\n`
  )
  return true
}

export async function generateProfile(): Promise<void> {
  const run = async (): Promise<void> => {
    generateProfileLastStep = 'queued'
    await Promise.race([
      generateProfileImpl(),
      new Promise<void>((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              `generateProfile wall-clock timeout after ${GENERATE_PROFILE_WALL_CLOCK_MS}ms last_step=${generateProfileLastStep}`
            )
          )
        }, GENERATE_PROFILE_WALL_CLOCK_MS)
      })
    ])
  }
  const next = generateProfileChain.then(run, run)
  generateProfileChain = next.catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error)
    await appendAppLog(
      `[Factory]: generateProfile failed err=${message} last_step=${generateProfileLastStep}\n`
    )
    await hydrateRuntimeConfigFromDiskIfEmpty()
  })
  await next
}

async function generateProfileImpl(): Promise<void> {
  const stepStartedAtMs = performance.now()
  await logGenerateProfileStep('begin', stepStartedAtMs)
  const { current } = await getProfileConfig()
  const { diffWorkDir = false, controlDns = true, controlSniff = true } = await getAppConfig()
  const currentProfileConfig = await getProfile(current)
  rawProfileStr = await getProfileStr(current)
  currentProfileStr = stringifyYaml(currentProfileConfig)
  const currentProfile = await overrideProfile(current, currentProfileConfig)
  overrideProfileStr = stringifyYaml(currentProfile)
  await logGenerateProfileStep('override_profile', stepStartedAtMs)
  const controledMihomoConfig = await getControledMihomoConfig()

  const configToMerge = JSON.parse(JSON.stringify(controledMihomoConfig))
  if (!controlDns) {
    delete configToMerge.dns
    delete configToMerge.hosts
  }
  if (!controlSniff) {
    delete configToMerge.sniffer
  }

  const useProvider = current && current !== 'default'
  let profile: MihomoConfig

  if (useProvider) {
    const proxies = extractProxies(currentProfile)

    if (proxies.length > 0) {
      await setupProfileProviders(current, proxies)
      await logGenerateProfileStep('setup_profile_providers', stepStartedAtMs)
      const baseConfig = generateBaseConfigWithProvider(currentProfile, current)
      profile = deepMerge(JSON.parse(JSON.stringify(baseConfig)), configToMerge)
      await logGenerateProfileStep('merge_provider_base', stepStartedAtMs)
    } else {
      profile = deepMerge(JSON.parse(JSON.stringify(currentProfile)), configToMerge)
    }
  } else {
    profile = deepMerge(JSON.parse(JSON.stringify(currentProfile)), configToMerge)
  }

  if (profile.proxies && Array.isArray(profile.proxies)) {
    const guarded = applyVlessVisionMuxGuard(
      applyHysteria2ProxiesQuicStability(profile.proxies as unknown[])
    )
    ;(profile as MihomoConfig).proxies = guarded as MihomoConfig['proxies']
    const muxSummary = summarizeVlessVisionMuxGuard(guarded)
    if (muxSummary.visionNodeCount > 0) {
      const nodeList = muxSummary.visionNodeNames.join(',')
      await appendAppLog(
        `[Factory]: vless_vision_mux_guard vision=${muxSummary.visionNodeCount} stripped_multiplex=${muxSummary.strippedMultiplexCount} ensured_smux_off=${muxSummary.ensuredSmuxOffCount} nodes=[${nodeList}]\n`
      )
    }
  }

  await cleanProfile(profile, controlDns, controlSniff)
  await logGenerateProfileStep('clean_profile', stepStartedAtMs)
  dedupeProxyGroupProviderUse(profile)
  const subscriptionGroupNames = collectSubscriptionGroupNames(currentProfile)
  const leafProxyNames = (extractProxies(currentProfile) as { name?: string }[])
    .map((proxy) => proxy.name)
    .filter((name): name is string => typeof name === 'string' && name.length > 0)
  const providerProfileId = current && current !== 'default' ? current : undefined
  const legacyCursorGroupMigrated = ensureCustomProxyGroups(profile, leafProxyNames, providerProfileId)
  if (legacyCursorGroupMigrated && !cursorDedicatedGroupRenameNotified) {
    cursorDedicatedGroupRenameNotified = true
    const detail =
      `Cursor 代理组已统一为「${CURSOR_DEDICATED_GROUP_NAME}」，所有 Cursor 流量走专用组。` +
      '请在 Sparkle 代理页重新确认 VPS 节点（建议 JP-VPS-HY2）。'
    await appendAppLog(`[Factory]: ${detail}\n`)
    void showNotification({
      title: 'Cursor 代理组已更新',
      body: detail,
      variant: 'warning'
    })
  }
  rewriteMissingRuleProxyGroupTargets(profile)
  removeNonSubscriptionProxyGroups(profile, subscriptionGroupNames)
  const { proxySwitchPriority = [] } = await getAppConfig()
  ensureSelectGroupsDefaultToAutoSwitch(profile, providerProfileId, {
    leafProxyNames,
    regionPriority: resolveEffectiveRegionPriority(proxySwitchPriority)
  })
  await logGenerateProfileStep('auto_switch_groups', stepStartedAtMs)
  await ensureVpsDirectBypass(profile, extractProxies(currentProfile))
  await logGenerateProfileStep('vps_direct_bypass', stepStartedAtMs)
  const { cursorBidiOptimize = true, cursorProxyAppPathPrefixes } = await getAppConfig()
  if (cursorBidiOptimize !== false) {
    injectCursorDomainRules(profile, cursorProxyAppPathPrefixes ?? [])
  }
  await logGenerateProfileStep('cursor_rules', stepStartedAtMs)
  ensureCorporateDirectRules(profile)
  await ensureCorporateDnsPolicy(profile)
  await logGenerateProfileStep('corporate_dns', stepStartedAtMs)
  ensureFakeIpRoutingIntegrity(profile)
  ensureDnsFallbackIntegrity(profile)
  ensureTunStrictRoute(profile)
  await logGenerateProfileStep('integrity_patches', stepStartedAtMs)

  runtimeConfig = profile
  runtimeConfigStr = stringifyYaml(profile)
  await logGenerateProfileStep('stringify_runtime', stepStartedAtMs)
  if (diffWorkDir) {
    await prepareProfileWorkDir(current)
    await logGenerateProfileStep('prepare_work_dir', stepStartedAtMs)
  }
  await writeFile(
    diffWorkDir ? mihomoWorkConfigPath(current) : mihomoWorkConfigPath('work'),
    runtimeConfigStr
  )
  await logGenerateProfileStep(
    `done groups=${(profile['proxy-groups'] as unknown[] | undefined)?.length ?? 0}`,
    stepStartedAtMs
  )
}

async function cleanProfile(
  profile: MihomoConfig,
  controlDns: boolean,
  controlSniff: boolean
): Promise<void> {
  if (!['info', 'debug'].includes(profile['log-level'])) {
    profile['log-level'] = 'info'
  }

  configureLanSettings(profile)
  cleanBooleanConfigs(profile)
  cleanNumberConfigs(profile)
  cleanStringConfigs(profile)
  cleanAuthenticationConfig(profile)
  cleanTunConfig(profile)
  cleanDnsConfig(profile, controlDns)
  cleanSnifferConfig(profile, controlSniff)
  cleanProxyConfigs(profile)
}

interface ProxyGroupConfig {
  name: string
  type: string
  proxies?: string[]
  use?: string[]
}

function dedupeProxyGroupProviderUse(profile: MihomoConfig): void {
  const groups = profile['proxy-groups'] as ProxyGroupConfig[] | undefined
  if (!groups) return
  for (const group of groups) {
    if (group.use && Array.isArray(group.use)) {
      group.use = [...new Set(group.use)]
    }
  }
}

function cleanBooleanConfigs(profile: MihomoConfig): void {
  if (profile.ipv6 !== false) {
    delete (profile as Partial<MihomoConfig>).ipv6
  }

  const booleanConfigs = [
    'unified-delay',
    'tcp-concurrent',
    'geodata-mode',
    'geo-auto-update',
    'disable-keep-alive'
  ]

  booleanConfigs.forEach((key) => {
    if (!profile[key]) delete (profile as Partial<MihomoConfig>)[key]
  })

  if (!profile.profile) return

  const { 'store-selected': hasStoreSelected, 'store-fake-ip': hasStoreFakeIp } = profile.profile

  if (!hasStoreSelected && !hasStoreFakeIp) {
    delete (profile as Partial<MihomoConfig>).profile
  } else {
    const profileConfig = profile.profile as MihomoProfileConfig
    if (!hasStoreSelected) delete profileConfig['store-selected']
    if (!hasStoreFakeIp) delete profileConfig['store-fake-ip']
  }
}

function cleanNumberConfigs(profile: MihomoConfig): void {
  if (!profile['disable-keep-alive']) {
    if (profile['keep-alive-idle'] == null || profile['keep-alive-idle'] === 0) {
      profile['keep-alive-idle'] = 3600
    }
    if (profile['keep-alive-interval'] == null || profile['keep-alive-interval'] === 0) {
      profile['keep-alive-interval'] = 60
    }
  }

  ;[
    'port',
    'socks-port',
    'redir-port',
    'tproxy-port',
    'mixed-port'
  ].forEach((key) => {
    if (profile[key] === 0) delete (profile as Partial<MihomoConfig>)[key]
  })
}

function cleanStringConfigs(profile: MihomoConfig): void {
  const partialProfile = profile as Partial<MihomoConfig>

  if (profile.mode === 'rule') delete partialProfile.mode

  const emptyStringConfigs = ['interface-name', 'secret', 'global-client-fingerprint']
  emptyStringConfigs.forEach((key) => {
    if (profile[key] === '') delete partialProfile[key]
  })

  if (profile['external-controller'] === '') {
    delete partialProfile['external-controller']
    delete partialProfile['external-ui']
    delete partialProfile['external-ui-url']
    delete partialProfile['external-controller-cors']
  } else if (profile['external-ui'] === '') {
    delete partialProfile['external-ui']
    delete partialProfile['external-ui-url']
  }
}

function configureLanSettings(profile: MihomoConfig): void {
  const partialProfile = profile as Partial<MihomoConfig>

  if (profile['allow-lan'] === false) {
    delete partialProfile['lan-allowed-ips']
    delete partialProfile['lan-disallowed-ips']
    return
  }

  if (!profile['allow-lan']) {
    delete partialProfile['allow-lan']
    delete partialProfile['lan-allowed-ips']
    delete partialProfile['lan-disallowed-ips']
    return
  }

  const allowedIps = profile['lan-allowed-ips']
  if (allowedIps?.length === 0) {
    delete partialProfile['lan-allowed-ips']
  } else if (allowedIps && !allowedIps.some((ip: string) => ip.startsWith('127.0.0.1/'))) {
    allowedIps.push('127.0.0.1/8')
  }

  if (profile['lan-disallowed-ips']?.length === 0) {
    delete partialProfile['lan-disallowed-ips']
  }
}

function cleanAuthenticationConfig(profile: MihomoConfig): void {
  if (profile.authentication?.length === 0) {
    const partialProfile = profile as Partial<MihomoConfig>
    delete partialProfile.authentication
    delete partialProfile['skip-auth-prefixes']
  }
}

function cleanTunConfig(profile: MihomoConfig): void {
  if (!profile.tun?.enable) {
    delete (profile as Partial<MihomoConfig>).tun
    return
  }

  const tunConfig = profile.tun as MihomoTunConfig

  if (tunConfig['auto-route'] !== false) {
    delete tunConfig['auto-route']
  }
  if (tunConfig['auto-detect-interface'] !== false) {
    delete tunConfig['auto-detect-interface']
  }

  const tunBooleanConfigs = ['auto-redirect', 'strict-route', 'disable-icmp-forwarding']
  tunBooleanConfigs.forEach((key) => {
    if (!tunConfig[key]) delete tunConfig[key]
  })

  if (tunConfig.device === '') {
    delete tunConfig.device
  } else if (
    process.platform === 'darwin' &&
    tunConfig.device &&
    !tunConfig.device.startsWith('utun')
  ) {
    delete tunConfig.device
  }

  if (tunConfig['dns-hijack']?.length === 0) delete tunConfig['dns-hijack']
  if (tunConfig['route-exclude-address']?.length === 0) delete tunConfig['route-exclude-address']
}

function cleanDnsConfig(profile: MihomoConfig, controlDns: boolean): void {
  if (!controlDns) return
  if (!profile.dns?.enable) {
    delete (profile as Partial<MihomoConfig>).dns
    return
  }

  const dnsConfig = profile.dns as MihomoDNSConfig
  const dnsArrayConfigs = [
    'fake-ip-range',
    'fake-ip-range6',
    'fake-ip-filter',
    'proxy-server-nameserver',
    'direct-nameserver',
    'nameserver'
  ]

  dnsArrayConfigs.forEach((key) => {
    if (dnsConfig[key]?.length === 0) delete dnsConfig[key]
  })

  if (dnsConfig['respect-rules'] === false || dnsConfig['proxy-server-nameserver']?.length === 0) {
    delete dnsConfig['respect-rules']
  }

  if (dnsConfig['nameserver-policy'] && Object.keys(dnsConfig['nameserver-policy']).length === 0) {
    delete dnsConfig['nameserver-policy']
  }
  if (
    dnsConfig['proxy-server-nameserver-policy'] &&
    Object.keys(dnsConfig['proxy-server-nameserver-policy']).length === 0
  ) {
    delete dnsConfig['proxy-server-nameserver-policy']
  }

}

function cleanSnifferConfig(profile: MihomoConfig, controlSniff: boolean): void {
  if (!controlSniff) return
  if (!profile.sniffer?.enable) {
    delete (profile as Partial<MihomoConfig>).sniffer
  }
}

function cleanProxyConfigs(profile: MihomoConfig): void {
  const partialProfile = profile as Partial<MihomoConfig>
  const arrayConfigs = ['proxies', 'proxy-groups', 'rules']
  const objectConfigs = ['proxy-providers', 'rule-providers']

  arrayConfigs.forEach((key) => {
    if (Array.isArray(profile[key]) && profile[key]?.length === 0) {
      delete partialProfile[key]
    }
  })

  objectConfigs.forEach((key) => {
    const value = profile[key]
    if (
      value === null ||
      value === undefined ||
      (value && typeof value === 'object' && Object.keys(value).length === 0)
    ) {
      delete partialProfile[key]
    }
  })
}

async function prepareProfileWorkDir(current: string | undefined): Promise<void> {
  const targetDir = mihomoProfileWorkDir(current)
  const sourceDir = mihomoWorkDir()
  if (!existsSync(targetDir)) {
    await mkdir(targetDir, { recursive: true })
  }
  const copy = async (file: string): Promise<void> => {
    const targetPath = path.join(targetDir, file)
    const sourcePath = path.join(sourceDir, file)
    if (!existsSync(targetPath) && existsSync(sourcePath)) {
      await copyFile(sourcePath, targetPath)
    }
  }
  const files = await readdir(sourceDir, { withFileTypes: true })
  await Promise.all(
    files
      .filter((file) => file.isFile() && /(?:db|dat)$/i.test(file.name))
      .map((file) => copy(file.name))
  )
}

async function overrideProfile(
  current: string | undefined,
  profile: MihomoConfig
): Promise<MihomoConfig> {
  const { items = [] } = (await getOverrideConfig()) || {}
  const globalOverride = items.filter((item) => item.global).map((item) => item.id)
  const { override = [] } = (await getProfileItem(current)) || {}
  for (const ov of new Set(globalOverride.concat(override))) {
    const item = await getOverrideItem(ov)
    const content = await getOverride(ov, item?.ext || 'js')
    switch (item?.ext) {
      case 'js':
        profile = await runOverrideScript(profile, content, item)
        break
      case 'yaml': {
        let patch = parseYaml<Partial<MihomoConfig>>(content)
        if (typeof patch !== 'object') patch = {}
        profile = deepMerge(profile, patch, true)
        break
      }
    }
  }
  return profile
}

async function runOverrideScript(
  profile: MihomoConfig,
  script: string,
  item: OverrideItem
): Promise<MihomoConfig> {
  const log = (type: string, data: string, flag = 'a'): void => {
    writeFileSync(overridePath(item.id, 'log'), `[${type}] ${data}\n`, {
      encoding: 'utf-8',
      flag
    })
  }
  try {
    const b64d = (str: string): string => Buffer.from(str, 'base64').toString('utf-8')
    const b64e = (data: Buffer | string): string =>
      (Buffer.isBuffer(data) ? data : Buffer.from(String(data))).toString('base64')
    const ctx = {
      console: Object.freeze({
        log: (...args: unknown[]) => log('log', args.map(format).join(' ')),
        info: (...args: unknown[]) => log('info', args.map(format).join(' ')),
        error: (...args: unknown[]) => log('error', args.map(format).join(' ')),
        debug: (...args: unknown[]) => log('debug', args.map(format).join(' '))
      }),
      fetch,
      yaml: { parse: parseYaml, stringify: stringifyYaml },
      b64d,
      b64e,
      Buffer
    }
    vm.createContext(ctx)
    log('info', '开始执行脚本', 'w')
    vm.runInContext(script, ctx)
    const promise = vm.runInContext(
      `(async () => {
        const result = main(${JSON.stringify(profile)})
        if (result instanceof Promise) return await result
        return result
      })()`,
      ctx
    )
    const newProfile = await promise
    if (typeof newProfile !== 'object') {
      throw new Error('脚本返回值必须是对象')
    }
    log('info', '脚本执行成功')
    return newProfile
  } catch (e) {
    log('exception', `脚本执行失败：${e}`)
    return profile
  }
}

function format(data: unknown): string {
  if (data instanceof Error) {
    return `${data.name}: ${data.message}\n${data.stack}`
  }
  try {
    return JSON.stringify(data)
  } catch {
    return String(data)
  }
}

export async function getRuntimeConfigStr(): Promise<string> {
  return runtimeConfigStr
}

export async function getRawProfileStr(): Promise<string> {
  return rawProfileStr
}

export async function getCurrentProfileStr(): Promise<string> {
  return currentProfileStr
}

export async function getOverrideProfileStr(): Promise<string> {
  return overrideProfileStr
}

export async function getRuntimeConfig(): Promise<MihomoConfig> {
  return runtimeConfig
}

interface ProxyProviderHealthCheckConfig {
  enable?: boolean
  url?: string
  interval?: number
  lazy?: boolean
}

/** Hot-patch proxy-provider health-check.enable in runtime yaml (Marathon quiesce). */
export async function patchRuntimeProxyProviderHealthCheckEnable(
  profileId: string,
  enable: boolean,
  diffWorkDir: boolean,
): Promise<boolean> {
  if (!runtimeConfig?.['proxy-providers']) {
    return false
  }

  const { resolveVpsProviderId } = await import('./provider')
  const providerIds = [profileId, resolveVpsProviderId(profileId)]
  const providers = runtimeConfig['proxy-providers'] as Record<
    string,
    { 'health-check'?: ProxyProviderHealthCheckConfig }
  >

  let changed = false
  for (const providerId of providerIds) {
    const provider = providers[providerId]
    const healthCheck = provider?.['health-check']
    if (!healthCheck || healthCheck.enable === enable) {
      continue
    }
    healthCheck.enable = enable
    changed = true
  }

  if (!changed) {
    return false
  }

  runtimeConfigStr = stringifyYaml(runtimeConfig)
  await writeFile(
    diffWorkDir ? mihomoWorkConfigPath(profileId) : mihomoWorkConfigPath('work'),
    runtimeConfigStr,
  )
  return true
}
