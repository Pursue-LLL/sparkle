import {
  getControledMihomoConfig,
  getProfileConfig,
  getProfile,
  getProfileStr,
  getAppConfig
} from '../config'
import { mihomoProfileWorkDir, mihomoWorkConfigPath, mihomoWorkDir } from '../utils/dirs'
import { parseYaml, stringifyYaml } from '../utils/yaml'
import { copyFile, mkdir, readdir, writeFile } from 'fs/promises'
import { deepMerge } from '../utils/merge'
import { logBuildDriftAtStartup } from './buildDriftCore'
import { existsSync } from 'fs'
import path from 'path'
import { extractProxies, setupProfileProviders, generateBaseConfigWithProvider } from './provider'
import {
  collectSubscriptionGroupNames,
  dropUnknownGroupMembers,
  ensureMatchFallbackRule,
  removeNonSubscriptionProxyGroups,
  rewriteMissingRuleProxyGroupTargets
} from './profileGroupNormalize'
import { ensureCustomProxyGroups } from './customProxyGroups'
import { ensureCnDirectBaseline } from './cnDirectBaseline'
import { cleanProfile, dedupeProxyGroupProviderUse } from './runtimeConfigSanitize'
import { overrideProfile } from './overrideProfile'
import { writeSparkleProviderFiles } from './sparkleProviderFiles'
import {
  formatAutoSelectAnyTlsExclusionLogLine,
  type ProxyCatalogEntry
} from './autoSelectAnyTlsExclusionCore'
import { injectDedicatedTrafficRules } from './dedicatedTrafficRuleInjection'
import { injectMailTrafficRules } from './mailTrafficRuleInjection'
import { injectAntigravityTrafficRules } from './antigravityRuleInjection'
import { injectQuicTrafficRules } from './quicTrafficRuleInjection'
import { ensureSelectGroupsDefaultToAutoSwitch } from './defaultAutoSwitchProxy'
import { orderProxyGroups } from './proxyGroupOrder'
import { resolveEffectiveRegionPriority } from './regionPriority'
import { ensureVpsDirectBypass } from './vpsDirectBypass'
import { injectCursorDomainRules } from './cursorRuleInjection'
import { ensureCorporateDirectRules, ensureCorporateDnsPolicy } from './corporateDirectRules'
import { ensureAiApiDirectRules } from './aiApiDirectRules'
import { ensureFakeIpRoutingIntegrity } from './fakeIpRoutingIntegrity'
import { ensureDnsFallbackIntegrity, ensureTunStrictRoute } from './dnsFallbackIntegrity'
import { applyVlessVisionMuxGuard, summarizeVlessVisionMuxGuard } from './vlessVisionMuxGuardCore'
import { showNotification } from '../utils/notification'
import { CURSOR_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
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
    let watchdog: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<never>((_, reject) => {
      watchdog = setTimeout(() => {
        reject(
          new Error(
            `generateProfile wall-clock timeout after ${GENERATE_PROFILE_WALL_CLOCK_MS}ms last_step=${generateProfileLastStep}`
          )
        )
      }, GENERATE_PROFILE_WALL_CLOCK_MS)
    })
    try {
      await Promise.race([generateProfileImpl(), timedOut])
    } finally {
      // 不清掉的话，每次生成都会留下一个 60s 的挂起定时器，拖住事件循环
      clearTimeout(watchdog)
    }
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
  await logBuildDriftAtStartup()
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
    // 必须先统计再归一化：归一化会剥掉 multiplex，之后再统计 stripped 恒为 0
    const muxSummary = summarizeVlessVisionMuxGuard(profile.proxies as unknown[])
    ;(profile as MihomoConfig).proxies = applyVlessVisionMuxGuard(
      profile.proxies as unknown[]
    ) as MihomoConfig['proxies']
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
  const leafProxyCatalog = (extractProxies(currentProfile) as { name?: string; type?: string }[])
    .map((proxy): ProxyCatalogEntry | null => {
      if (typeof proxy.name !== 'string' || proxy.name.trim().length === 0) {
        return null
      }
      return {
        name: proxy.name.trim(),
        type: typeof proxy.type === 'string' ? proxy.type.trim() : undefined
      }
    })
    .filter((entry): entry is ProxyCatalogEntry => entry !== null)
  const providerProfileId = current && current !== 'default' ? current : undefined
  const legacyCursorGroupMigrated = ensureCustomProxyGroups(
    profile,
    leafProxyNames,
    providerProfileId
  )
  injectDedicatedTrafficRules(profile)
  injectMailTrafficRules(profile)
  if (legacyCursorGroupMigrated && !cursorDedicatedGroupRenameNotified) {
    cursorDedicatedGroupRenameNotified = true
    const detail =
      `Cursor 代理组已统一为「${CURSOR_DEDICATED_GROUP_NAME}」，所有 Cursor 流量走专用组。` +
      '请在 Sparkle 代理页重新确认 VPS 节点（建议 KR-VPS-HY2）。'
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
  const anyTlsExclusion = ensureSelectGroupsDefaultToAutoSwitch(profile, providerProfileId, {
    leafProxyNames,
    leafProxyCatalog,
    regionPriority: resolveEffectiveRegionPriority(proxySwitchPriority)
  })
  if (anyTlsExclusion.groupsMutated > 0) {
    await appendAppLog(formatAutoSelectAnyTlsExclusionLogLine(anyTlsExclusion))
  }
  await logGenerateProfileStep('auto_switch_groups', stepStartedAtMs)
  orderProxyGroups(profile)
  const droppedGroupMembers = dropUnknownGroupMembers(profile, leafProxyNames)
  if (droppedGroupMembers.length > 0) {
    const summary = droppedGroupMembers
      .map(({ group, dropped }) => `${group}->[${dropped.join(',')}]`)
      .join('; ')
    await appendAppLog(`[Factory]: dropped unknown group members: ${summary}\n`)
  }
  await writeSparkleProviderFiles(currentProfile, proxySwitchPriority)
  await ensureVpsDirectBypass(profile, extractProxies(currentProfile))
  await logGenerateProfileStep('vps_direct_bypass', stepStartedAtMs)
  const { cursorBidiOptimize = true, cursorProxyAppPathPrefixes } = await getAppConfig()
  if (cursorBidiOptimize !== false) {
    injectCursorDomainRules(profile, cursorProxyAppPathPrefixes ?? [])
  }
  await logGenerateProfileStep('cursor_rules', stepStartedAtMs)
  ensureCorporateDirectRules(profile)
  ensureAiApiDirectRules(profile)
  await ensureCorporateDnsPolicy(profile)
  await logGenerateProfileStep('corporate_dns', stepStartedAtMs)
  ensureFakeIpRoutingIntegrity(profile)
  ensureDnsFallbackIntegrity(profile)
  ensureTunStrictRoute(profile)
  await logGenerateProfileStep('integrity_patches', stepStartedAtMs)
  // Antigravity/Code-Assist 规则注入放在所有组构建完成之后：
  // guard 检查的目标组（自动选择）由 auto_switch_groups 及后续步骤确保存在，
  // 早于此处注入会被 guard 误拦（时序 bug 已实测）。
  injectAntigravityTrafficRules(profile)
  await logGenerateProfileStep('antigravity_geo_rules', stepStartedAtMs)
  if (ensureCnDirectBaseline(profile)) {
    await appendAppLog('[Factory]: subscription has no CN rules, appended CN direct baseline\n')
  }
  await logGenerateProfileStep('cn_direct_baseline', stepStartedAtMs)
  const matchFallback = ensureMatchFallbackRule(profile)
  if (matchFallback) {
    await appendAppLog(`[Factory]: appended MATCH fallback -> ${matchFallback}\n`)
  }
  await logGenerateProfileStep('match_fallback', stepStartedAtMs)
  injectQuicTrafficRules(profile)
  await logGenerateProfileStep('quic_traffic_rules', stepStartedAtMs)

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
