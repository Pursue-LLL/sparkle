// [INPUT] MergeProfileSpec · 来源订阅 yaml（由调用方注入读取函数，本模块不碰文件系统）
// [OUTPUT] findDependentMergeItems · buildMergedProfileStr · matchesRegions
// [POS] 合并订阅：按地区白名单取多个订阅节点的并集，策略组与规则沿用 base 订阅；
// 来源订阅的 proxy-server-nameserver 按来源节点域名合并为 proxy-server-nameserver-policy，避免 base DNS 覆盖来源入口；
// 专用地区（香港）的节点保留在节点池里，但被组级 exclude-filter 挡在普通组之外

import { parseYaml, stringifyYaml } from '../utils/yaml'

interface ProxyEntry {
  name: string
  [key: string]: unknown
}

interface GroupEntry {
  name: string
  proxies?: string[]
  [key: string]: unknown
}

interface ProfileDocument {
  dns?: unknown
  proxies?: ProxyEntry[]
  'proxy-groups'?: GroupEntry[]
  [key: string]: unknown
}

interface MergeSource {
  label: string
  document: ProfileDocument
}

export interface MergeSourceContent {
  /** 展示名；节点重名时用它区分来源。 */
  label: string
  yaml: string
  /** 来源本身是合并订阅时为 true：禁止嵌套，避免来源更新触发的重建形成环。 */
  derived: boolean
}

export type ReadMergeSource = (id: string) => Promise<MergeSourceContent>

/** 节点名包含任一地区关键词即命中；按中文国家名而非旗帜 emoji，因为中转线路的旗帜与出口国不一致。 */
export function matchesRegions(name: string, regions: readonly string[]): boolean {
  return regions.some((region) => name.includes(region))
}

function uniqueName(name: string, label: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) {
    return name
  }
  const labeled = `${name} · ${label}`
  let candidate = labeled
  for (let index = 2; taken.has(candidate); index += 1) {
    candidate = `${labeled} ${index}`
  }
  return candidate
}

function collectRegionNodes(
  sources: readonly MergeSource[],
  regions: readonly string[]
): ProxyEntry[] {
  const taken = new Set<string>()
  const nodes: ProxyEntry[] = []
  for (const source of sources) {
    for (const proxy of source.document.proxies ?? []) {
      if (typeof proxy?.name !== 'string' || !matchesRegions(proxy.name, regions)) {
        continue
      }
      const name = uniqueName(proxy.name, source.label, taken)
      taken.add(name)
      nodes.push(name === proxy.name ? proxy : { ...proxy, name })
    }
  }
  return nodes
}

function buildExcludeFilter(regions: readonly string[]): string | undefined {
  if (regions.length === 0) {
    return undefined
  }
  return regions.map((region) => region.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
}

/**
 * base 的节点引用整体替换为合并后的节点（插在第一个节点引用的位置），
 * 组引用与 DIRECT/REJECT 等保持原位；与 Sparkle 把节点组改写成 provider `use` 的语义一致。
 * Sparkle 改写后组会引用整个节点池，因此专用地区节点靠组级 `exclude-filter` 挡在普通组之外。
 */
function rewriteGroupNodeRefs(
  group: GroupEntry,
  baseNodeNames: ReadonlySet<string>,
  memberNames: readonly string[],
  excludeFilter: string | undefined
): GroupEntry {
  if (!group.proxies?.some((ref) => baseNodeNames.has(ref))) {
    return group
  }
  const proxies: string[] = []
  let inserted = false
  for (const ref of group.proxies) {
    if (!baseNodeNames.has(ref)) {
      proxies.push(ref)
    } else if (!inserted) {
      proxies.push(...memberNames)
      inserted = true
    }
  }
  const existingFilter =
    typeof group['exclude-filter'] === 'string' ? group['exclude-filter'] : undefined
  const mergedFilter = [existingFilter, excludeFilter].filter(Boolean).join('|')
  return { ...group, proxies, ...(mergedFilter ? { 'exclude-filter': mergedFilter } : {}) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(String)
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return typeof value === 'string' && value.trim() ? [value.trim()] : []
}

function isIpAddress(value: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) || value.includes(':')
}

/** 来源订阅自己的 proxy-server-nameserver 只对来源节点域名生效，不能污染 base 的其他节点。 */
function collectSourceProxyServerPolicy(source: MergeSource): Record<string, string[]> | undefined {
  const sourceDns = isRecord(source.document.dns) ? source.document.dns : undefined
  const nameservers = asStringList(sourceDns?.['proxy-server-nameserver'])
  if (nameservers.length === 0) {
    return undefined
  }
  const policy: Record<string, string[]> = {}
  for (const proxy of source.document.proxies ?? []) {
    const server = typeof proxy.server === 'string' ? proxy.server.trim() : ''
    if (!server || isIpAddress(server)) {
      continue
    }
    policy[server] = nameservers
  }
  return Object.keys(policy).length > 0 ? policy : undefined
}

/**
 * 合并订阅沿用 base 的策略组与规则，但 DNS 不能无条件沿用 base：
 * 来源订阅的节点域名可能依赖它自己的 proxy-server-nameserver（例如 YYSSR 的 carrier DoH）。
 * 这里按「来源节点域名 → 来源 nameserver」写入 proxy-server-nameserver-policy，
 * 只影响来源自己的 server 域名，不改变 base 与其他来源的解析路径。
 */
function mergeProxyServerNameserverPolicy(
  base: ProfileDocument,
  sources: readonly MergeSource[]
): Record<string, unknown> | undefined {
  const baseDns = isRecord(base.dns) ? base.dns : {}
  const existing = isRecord(baseDns['proxy-server-nameserver-policy'])
    ? baseDns['proxy-server-nameserver-policy']
    : {}
  const merged: Record<string, string[]> = {}
  for (const [domain, nameservers] of Object.entries(existing)) {
    const list = asStringList(nameservers)
    if (list.length > 0) {
      merged[domain] = list
    }
  }
  for (const source of sources) {
    if (source.document === base) {
      continue
    }
    const policy = collectSourceProxyServerPolicy(source)
    if (!policy) {
      continue
    }
    for (const [domain, nameservers] of Object.entries(policy)) {
      const current = merged[domain] ?? []
      merged[domain] = [...new Set([...current, ...nameservers])]
    }
  }
  if (Object.keys(merged).length === 0) {
    return undefined
  }
  return { ...baseDns, 'proxy-server-nameserver-policy': merged }
}

function buildMergedProfile(
  base: ProfileDocument,
  sources: readonly MergeSource[],
  spec: Pick<MergeProfileSpec, 'regions' | 'dedicatedRegions'>
): ProfileDocument {
  const { regions, dedicatedRegions } = spec
  const nodes = collectRegionNodes(sources, [...regions, ...dedicatedRegions])
  const memberNames = nodes
    .map((node) => node.name)
    .filter((name) => !matchesRegions(name, dedicatedRegions))
  if (memberNames.length === 0) {
    throw new Error(`合并订阅没有匹配地区的节点：${regions.join('、')}`)
  }
  const baseNodeNames = new Set((base.proxies ?? []).map((proxy) => proxy.name))
  const excludeFilter = buildExcludeFilter(dedicatedRegions)
  const dns = mergeProxyServerNameserverPolicy(base, sources)
  return {
    ...base,
    ...(dns ? { dns } : {}),
    proxies: nodes,
    'proxy-groups': (base['proxy-groups'] ?? []).map((group) =>
      rewriteGroupNodeRefs(group, baseNodeNames, memberNames, excludeFilter)
    )
  }
}

async function loadSources(
  ids: readonly string[],
  readSource: ReadMergeSource
): Promise<Map<string, MergeSource>> {
  const entries = await Promise.all(
    ids.map(async (id): Promise<[string, MergeSource]> => {
      const content = await readSource(id)
      if (content.derived) {
        throw new Error(`合并订阅不能以另一个合并订阅为来源：${content.label}`)
      }
      // 订阅下载到错误页或纯文本时 parse 结果不是对象，必须拒绝，否则会把垃圾内容展开进合并结果。
      const document = parseYaml<ProfileDocument>(content.yaml)
      if (typeof document !== 'object' || Array.isArray(document)) {
        throw new Error(`订阅内容不是有效的配置：${content.label}`)
      }
      return [id, { label: content.label, document }]
    })
  )
  return new Map(entries)
}

export async function buildMergedProfileStr(
  spec: MergeProfileSpec,
  readSource: ReadMergeSource
): Promise<string> {
  if (spec.regions.length === 0 || spec.sources.length === 0) {
    throw new Error('合并订阅至少需要一个节点来源和一个地区')
  }
  const loaded = await loadSources([...new Set([spec.base, ...spec.sources])], readSource)
  const base = loaded.get(spec.base)!
  const baseGroups = base.document['proxy-groups']
  if (!Array.isArray(baseGroups) || baseGroups.length === 0) {
    throw new Error(`策略组与规则来源订阅没有策略组：${base.label}`)
  }
  const merged = buildMergedProfile(
    base.document,
    spec.sources.map((id) => loaded.get(id)!),
    spec
  )
  return stringifyYaml(merged)
}

/** 变更的订阅是某个合并订阅的 base 或节点来源时，该合并订阅需要重建。 */
export function findDependentMergeItems(
  items: readonly ProfileItem[],
  changedId: string
): (ProfileItem & { merge: MergeProfileSpec })[] {
  return items.filter(
    (item): item is ProfileItem & { merge: MergeProfileSpec } =>
      item.id !== changedId &&
      item.merge !== undefined &&
      (item.merge.base === changedId || item.merge.sources.includes(changedId))
  )
}

export interface MergeRebuilderDeps {
  listItems: () => Promise<readonly ProfileItem[]>
  build: (spec: MergeProfileSpec) => Promise<string>
  apply: (id: string, content: string) => Promise<void>
  /** item 为空表示读取订阅列表本身失败。 */
  onError: (item: ProfileItem | undefined, error: unknown) => Promise<void>
}

/**
 * 来源订阅更新后重建依赖它的合并订阅。
 * - 重建失败（例如来源刷新后不含任何目标地区节点）时保留合并订阅上一份可用文件，只上报错误。
 * - 两个来源常在同一时刻定时刷新；重建串行执行，保证最后一次重建读到的是最新的来源文件。
 */
export function createMergeRebuilder(
  deps: MergeRebuilderDeps
): (changedId: string) => Promise<void> {
  const reportError = async (item: ProfileItem | undefined, error: unknown): Promise<void> => {
    try {
      await deps.onError(item, error)
    } catch {
      // 上报失败不能中断后续重建
    }
  }

  const rebuildDependents = async (changedId: string): Promise<void> => {
    let items: readonly ProfileItem[]
    try {
      items = await deps.listItems()
    } catch (error) {
      await reportError(undefined, error)
      return
    }
    for (const item of findDependentMergeItems(items, changedId)) {
      try {
        await deps.apply(item.id, await deps.build(item.merge))
      } catch (error) {
        await reportError(item, error)
      }
    }
  }

  let chain: Promise<void> = Promise.resolve()
  return (changedId) => {
    chain = chain.then(() => rebuildDependents(changedId))
    return chain
  }
}
