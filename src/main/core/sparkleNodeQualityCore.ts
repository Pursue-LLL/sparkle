// [INPUT] (none — pure functions)
// [OUTPUT] ThroughputReading · IncumbentHealth · ReviewState · judgePrimaryForAdmission · controlVetoes · classifyIncumbent ·
//          startReview · isReviewDue · advanceReview · planCandidateWalk · DEGRADED_KBPS · ADMISSION_KBPS · SINK_TTL_MS ·
//          REVIEW_INTERVAL_MS · UNVERIFIED_PIN_REVIEW_MS · ADMISSION_MEMORY_MS · MAX_WALK_CANDIDATES · MAX_UNMEASURED_FAILURES
// [POS] `自动选择` 节点质量闸门的纯决策层：吞吐读数 → 准入裁决 / 在位节点健康度 → 两次读数确认的复查状态机 → 候选遍历规划。
// 不碰 IO、时钟与 mihomo，便于单测；探测在 sparkleThroughputProbe，编排在 autoSelectQualityGuard。
//
// 为什么要这道闸：mihomo 的存活判定只看握手/204 延迟，「能连通但下载只有几十 KB/s」的节点会一直被判存活并被粘性固定。
// 为什么只做闸门不做排名：单次读数能漂移数倍，足以区分「极慢」与「正常」，不足以给正常节点排名。
// 为什么沉底而非拉黑：判断只依据一次时点的读数，沉底节点仍留在候选池末尾，作为全池只剩它存活时的最后手段。

/**
 * 一次下载实测的结果。
 * - `measured`：测得吞吐；
 * - `failed`：隧道已建立但没能拿到有效数据（超时无数据、连接被重置、响应状态异常），是节点到目标这一段的证据；
 * - `unavailable`：本机探测设施不可用（监听器、控制器），与节点质量无关，不得当作证据。
 */
export type ThroughputReading =
  | { kind: 'measured'; kbps: number }
  | { kind: 'failed' }
  | { kind: 'unavailable' }

/** 判劣线（KB/s）：实测 Chrome 打开 google.com 要 16 s 以上的节点，128 KB 吞吐读数为 12–74 KB/s。 */
export const DEGRADED_KBPS = 100

/**
 * 准入线（KB/s）高于判劣线：100–150 的滞回带里，新节点不被钉住，已钉住的也不被判劣，避免来回换。
 * 读数 ≥150 KB/s 的节点实测打开 google.com 多在 4 s 内。
 */
export const ADMISSION_KBPS = 150

/** 沉底的有效期：质量会随时间和线路变化，过期即恢复原排序，让节点有机会被重新采用。 */
export const SINK_TTL_MS = 12 * 60 * 60 * 1000

/** 在位节点的复查间隔：节点质量以小时级的速度退化，更密只会白白消耗流量。 */
export const REVIEW_INTERVAL_MS = 2 * 60 * 60 * 1000

/** 没做过质量验证就钉住的节点（探测设施不可用时放行）尽快复查，设施恢复后及时补上这道闸。 */
export const UNVERIFIED_PIN_REVIEW_MS = 10 * 60 * 1000

/** 刚通过准入的节点在这段时间内不重复测：地区复核被拒、竞态重试等场景会让同一候选在几轮内反复出现。 */
export const ADMISSION_MEMORY_MS = 10 * 60 * 1000

/** 判劣需要两次读数确认：单次读数可漂移数倍，两次读数至少间隔 45 s，且第一次读数 5 分钟内有效。 */
const CONFIRM_MIN_GAP_MS = 45 * 1000
const CONFIRM_MAX_GAP_MS = 5 * 60 * 1000

/** 探测设施暂时不可用时的重试间隔。 */
const UNKNOWN_RETRY_MS = 5 * 60 * 1000

/** 一轮最多试几个候选：连续 8 个都不达标（健康池里概率低于 1%）更可能是本机网络问题，应放行。 */
export const MAX_WALK_CANDIDATES = 8

/** 从没测出过任何吞吐、却已连续失败这么多个候选：目标站点或探测链路本身有问题，应放行而不是继续消耗流量。 */
export const MAX_UNMEASURED_FAILURES = 3

export type PrimaryVerdict = 'pass' | 'reject' | 'unknown'

/** 第一道（Google 下载）：必须测得且不低于准入线；没数据则否决；设施不可用则无法判断。 */
export function judgePrimaryForAdmission(reading: ThroughputReading): PrimaryVerdict {
  if (reading.kind === 'unavailable') {
    return 'unknown'
  }
  if (reading.kind === 'failed') {
    return 'reject'
  }
  return reading.kbps >= ADMISSION_KBPS ? 'pass' : 'reject'
}

/**
 * 第二道（对照站点）只有「测得且不达标」才否决：它用来排除偶然通过第一道的差节点，
 * 单个对照站点自己打不开不能让好节点被拒。
 */
export function controlVetoes(reading: ThroughputReading): boolean {
  return reading.kind === 'measured' && reading.kbps < ADMISSION_KBPS
}

export type IncumbentHealth = 'healthy' | 'degraded' | 'unknown'

export function classifyIncumbent(reading: ThroughputReading): IncumbentHealth {
  if (reading.kind === 'unavailable') {
    return 'unknown'
  }
  if (reading.kind === 'failed') {
    return 'degraded'
  }
  return reading.kbps >= DEGRADED_KBPS ? 'healthy' : 'degraded'
}

export interface ReviewState {
  node: string
  /** 下次读数的时间。 */
  dueAtMs: number
  /** 尚待确认的首次劣化读数时间；0 表示没有。 */
  firstDegradedAtMs: number
}

export function startReview(
  node: string,
  nowMs: number,
  firstDelayMs: number = REVIEW_INTERVAL_MS
): ReviewState {
  return { node, dueAtMs: nowMs + firstDelayMs, firstDegradedAtMs: 0 }
}

export function isReviewDue(state: ReviewState, nowMs: number): boolean {
  return nowMs >= state.dueAtMs
}

export interface ReviewOutcome {
  state: ReviewState
  /** 两次读数已确认劣化：调用方应寻找替代节点，处理完后用 startReview 重新计时。 */
  degraded: boolean
}

/** 推进一次复查：健康则排下一个周期；首次劣化先安排确认读数；确认窗口内再次劣化才算数。 */
export function advanceReview(
  state: ReviewState,
  health: IncumbentHealth,
  nowMs: number
): ReviewOutcome {
  if (health === 'healthy') {
    return { state: startReview(state.node, nowMs), degraded: false }
  }
  if (health === 'unknown') {
    return { state: { ...state, dueAtMs: nowMs + UNKNOWN_RETRY_MS }, degraded: false }
  }
  const gap = nowMs - state.firstDegradedAtMs
  const confirmed =
    state.firstDegradedAtMs > 0 && gap >= CONFIRM_MIN_GAP_MS && gap <= CONFIRM_MAX_GAP_MS
  if (confirmed) {
    return { state, degraded: true }
  }
  return {
    state: { node: state.node, dueAtMs: nowMs + CONFIRM_MIN_GAP_MS, firstDegradedAtMs: nowMs },
    degraded: false
  }
}

export interface CandidateWalkInput {
  /** 已确认存活的当前候选，排在最前；已沉底则不参与。 */
  first?: string
  /** `自动选择` 的成员，按 provider 文件顺序。 */
  order: readonly string[]
  /** 已知存活的节点（有测速记录且存活）。无记录的节点不进入遍历，避免为凑候选做大量单点实测。 */
  alive: ReadonlySet<string>
  sunk: ReadonlySet<string>
  /** 复查时被替换的在位节点。 */
  exclude?: string
}

/** 依次要试的候选：当前候选优先，其后是按文件顺序排列的存活且未沉底的节点，总数不超过 {@link MAX_WALK_CANDIDATES}。 */
export function planCandidateWalk(input: CandidateWalkInput): string[] {
  const { first, order, alive, sunk, exclude } = input
  const walk: string[] = []
  const seen = new Set<string>(exclude ? [exclude] : [])
  const add = (node: string): void => {
    if (walk.length >= MAX_WALK_CANDIDATES || seen.has(node) || sunk.has(node)) {
      return
    }
    seen.add(node)
    walk.push(node)
  }
  if (first) {
    add(first)
  }
  for (const node of order) {
    if (alive.has(node)) {
      add(node)
    }
  }
  return walk
}
