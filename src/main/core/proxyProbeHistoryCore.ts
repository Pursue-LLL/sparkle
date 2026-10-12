// [INPUT] mihomo 节点 / provider 叶子（alive · history · extra[url]）与组实际使用的探测地址
// [OUTPUT] resolveProbeRecord · resolveProbeHistory · isSameProbeUrl · poolProxyInstances
// [POS] 「节点在某个探测地址上的表现」的唯一取数口径（渲染进程经 @sparkle-core 引用）。
// mihomo 顶层 history 把各探测地址的样本按时间混在一起，直接读会把「通用网址通、Gemini 不通」的节点
// 读成时好时坏；这里改读组实际使用的探测地址对应的 extra[url]。
// 同一节点可同时存在于多个 provider（各自独立探测、结论会互相矛盾），按同一节点合并其样本；
// 同一探测目标可能以 http / https 两种写法各存一份记录，同样按时间合并，不能只取其一。

export const POOLED_HISTORY_LIMIT = 10

interface ProbeRecordLike {
  alive: boolean
  history?: ControllerProxiesHistory[]
}

export interface ProbeSource {
  alive?: boolean
  history?: ControllerProxiesHistory[]
  extra?: Record<string, ProbeRecordLike | undefined>
}

export interface ProbeRecord {
  /** 该探测地址上的存活标记；未知时为 undefined。 */
  alive: boolean | undefined
  /** 按时间升序，空数组表示该地址上还没有样本。 */
  history: ControllerProxiesHistory[]
}

/** provider 体检用 http、界面默认探测地址是 https，二者指向同一探测目标，匹配时忽略协议。 */
function probeUrlIdentity(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.host}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`.toLowerCase()
  } catch {
    return url.trim().toLowerCase()
  }
}

export function isSameProbeUrl(left: string, right: string): boolean {
  return probeUrlIdentity(left) === probeUrlIdentity(right)
}

function latestSampleAt(record: ProbeRecordLike): number {
  const last = record.history?.at(-1)
  return last ? Date.parse(last.time) : Number.NEGATIVE_INFINITY
}

/**
 * 取节点在 `probeUrl` 上的探测记录。
 * - 节点没有按地址分开的记录（或未指定地址）：只有一份历史，直接使用。
 * - 有分地址记录但没有该地址：该地址尚未测过，返回空历史，不拿其它地址的样本冒充。
 * - 同一目标有多份记录（http / https 两种写法）：样本按时间合并，存活标记取最新样本所在记录的。
 */
export function resolveProbeRecord(
  source: ProbeSource,
  probeUrl: string | undefined
): ProbeRecord {
  const entries = Object.entries(source.extra ?? {})
  if (!probeUrl || entries.length === 0) {
    return { alive: source.alive, history: source.history ?? [] }
  }
  const wanted = probeUrlIdentity(probeUrl)
  const records = entries
    .filter(([url]) => probeUrlIdentity(url) === wanted)
    .flatMap(([, record]) => (record ? [record] : []))
  if (records.length === 0) {
    return { alive: undefined, history: [] }
  }
  const latest = records.reduce((best, record) =>
    latestSampleAt(record) > latestSampleAt(best) ? record : best
  )
  return {
    alive: latest.alive,
    history: records.reduce<ControllerProxiesHistory[]>(
      (merged, record) => mergeHistories(merged, record.history),
      []
    )
  }
}

export function resolveProbeHistory(
  source: ProbeSource,
  probeUrl: string | undefined
): ControllerProxiesHistory[] {
  return resolveProbeRecord(source, probeUrl).history
}

function mergeHistories(
  left: readonly ControllerProxiesHistory[] | undefined,
  right: readonly ControllerProxiesHistory[] | undefined
): ControllerProxiesHistory[] {
  const byTime = new Map<string, ControllerProxiesHistory>()
  for (const entry of [...(left ?? []), ...(right ?? [])]) {
    byTime.set(entry.time, entry)
  }
  return [...byTime.values()]
    .map((entry) => ({ entry, at: Date.parse(entry.time) }))
    .sort((a, b) => a.at - b.at)
    .slice(-POOLED_HISTORY_LIMIT)
    .map(({ entry }) => entry)
}

/** 把同一节点在两个 provider 里的探测样本合并：样本更密，单个实例的偶发失败不再左右结论。 */
export function poolProxyInstances(
  first: ControllerProxiesDetail,
  second: ControllerProxiesDetail
): ControllerProxiesDetail {
  const extra: ControllerProxiesDetail['extra'] = {}
  for (const url of new Set([...Object.keys(first.extra ?? {}), ...Object.keys(second.extra ?? {})])) {
    const left = first.extra?.[url]
    const right = second.extra?.[url]
    extra[url] = {
      alive: Boolean(left?.alive || right?.alive),
      history: mergeHistories(left?.history, right?.history)
    }
  }
  return {
    ...first,
    alive: first.alive || second.alive,
    history: mergeHistories(first.history, second.history),
    extra
  }
}
