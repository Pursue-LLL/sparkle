// [INPUT] 无（纯函数：台账记录、时间戳与节点名都由调用方传入）
// [OUTPUT] STABLE_MIN_SAMPLES · STABLE_CLEAN_WINDOW_MS · PENALTY_BURST_LIMIT · PENALTY_BURST_WINDOW_MS ·
//          GeminiStabilityEntry · GeminiStabilityLedger · isNodeStable · recordSample · canRecordPenalty · parseStabilityLedger
// [POS] Gemini 节点稳定度台账的纯规则。Google 对出口的地区判定是概率事件（同一节点同一时刻 12 次里 8 次 ZZ），
// 单次「合格」不能当成节点的属性，所以每个节点累计明确判定的次数与最近一次被判封锁的时刻：
// 稳定 = 至少 STABLE_MIN_SAMPLES 次明确判定，且最近一次封锁已过 STABLE_CLEAN_WINDOW_MS。
// 封锁罚分限流：PENALTY_BURST_WINDOW_MS 内最多 PENALTY_BURST_LIMIT 条罚分入账，
// 超出的当作系统性事件（比如探测通道自己走了直连，所有节点同时返回 CN）不入账，免得一次故障抹掉全部历史。

export const STABLE_MIN_SAMPLES = 10
export const STABLE_CLEAN_WINDOW_MS = 14 * 24 * 60 * 60 * 1000
export const PENALTY_BURST_LIMIT = 2
export const PENALTY_BURST_WINDOW_MS = 30 * 60 * 1000

export interface GeminiStabilityEntry {
  /** 明确判定（合格或封锁）的累计次数 */
  samples: number
  /** 最近一次被判封锁的时刻（毫秒时间戳）；从未被判封锁则没有 */
  lastBadAt?: number
}

/** 节点名 → 稳定度记录；节点名是订阅里的展示名，改名即视为新节点（从零积累，安全方向）。 */
export type GeminiStabilityLedger = ReadonlyMap<string, GeminiStabilityEntry>

export function isNodeStable(entry: GeminiStabilityEntry | undefined, nowMs: number): boolean {
  if (!entry || entry.samples < STABLE_MIN_SAMPLES) {
    return false
  }
  return entry.lastBadAt === undefined || nowMs - entry.lastBadAt >= STABLE_CLEAN_WINDOW_MS
}

/** 记入一次明确判定：次数加一；被判封锁则刷新最近封锁时刻，合格则保留原有时刻。 */
export function recordSample(
  entry: GeminiStabilityEntry | undefined,
  bad: boolean,
  nowMs: number
): GeminiStabilityEntry {
  const samples = (entry?.samples ?? 0) + 1
  const lastBadAt = bad ? nowMs : entry?.lastBadAt
  return lastBadAt === undefined ? { samples } : { samples, lastBadAt }
}

export function canRecordPenalty(recentPenaltyAtMs: readonly number[], nowMs: number): boolean {
  const inWindow = recentPenaltyAtMs.filter((at) => nowMs - at < PENALTY_BURST_WINDOW_MS)
  return inWindow.length < PENALTY_BURST_LIMIT
}

function parseEntry(value: unknown, nowMs: number): GeminiStabilityEntry | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const { samples, lastBadAt } = value as { samples?: unknown; lastBadAt?: unknown }
  if (typeof samples !== 'number' || !Number.isInteger(samples) || samples < 0) {
    return undefined
  }
  if (lastBadAt === undefined) {
    return { samples }
  }
  if (typeof lastBadAt !== 'number' || !(lastBadAt > 0)) {
    return undefined
  }
  // 超前于当前时刻只可能来自曾经错误的系统时钟：改按当前时刻起算，惩罚期有限，不会被远未来的时间戳永久封死。
  return { samples, lastBadAt: Math.min(lastBadAt, nowMs) }
}

/** 从磁盘内容还原台账：整体不是对象按空台账，单条格式不对的记录丢弃（该节点回到「未证明」，安全方向）。 */
export function parseStabilityLedger(
  raw: unknown,
  nowMs: number
): Map<string, GeminiStabilityEntry> {
  const ledger = new Map<string, GeminiStabilityEntry>()
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return ledger
  }
  for (const [name, value] of Object.entries(raw)) {
    const entry = parseEntry(value, nowMs)
    if (entry) {
      ledger.set(name, entry)
    }
  }
  return ledger
}
