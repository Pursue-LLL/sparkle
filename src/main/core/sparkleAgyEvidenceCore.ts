// [INPUT] 官方 agy CLI 的运行日志文本（glog 格式）· agy 进程命令行文本 · 当前时间 · pin 上任时间
// [OUTPUT] AGY_EVIDENCE_* · extractAgyRejections · parseAgyLogFilePaths · judgeAgyPinByProduction · recentEvidenceRepairs · canRepairOnEvidence · AgyRejections · AgyProductionVerdict · AgyProductionJudgement
// [POS] agy 出口的生产证据（纯函数，无 I/O）：用户真实 agy 会话自己的日志逐条记着 Google 对出口地区的每一次拒绝，
// 这比任何探测都直接 —— 探测是对节点抽样，日志是用户流量本身。
// 判定是无状态的（只看最近一个窗口），不依赖进程内记忆：GUI 重启、无头调度进程每次从头判定，结论一致。
// 日志格式与文案是官方 CLI 的外部契约（在 1.5.11 / 1.5.12 上核对过）；契约变了只会读不到证据，退化为定时探测，不会误判。

/** 只看最近这段时间内的拒绝记录：更早的属于上一个出口或已经过去的状态。 */
export const AGY_EVIDENCE_WINDOW_MS = 10 * 60_000
/** pin 刚切换时，旧出口上已在途的请求还会陆续失败并落日志：上任后的这段时间内的记录不算新 pin 的。 */
export const AGY_EVIDENCE_GRACE_MS = 60_000
/** 窗口内至少这么多条拒绝记录才判定出口被拒：单条可能只是账号侧的瞬时 400，坏出口上会持续出现。 */
export const AGY_EVIDENCE_REJECTION_THRESHOLD = 3
/** 日志在这段时间内还有写入，才说明有 agy 会话在经过这个出口干活。 */
export const AGY_EVIDENCE_ACTIVITY_MS = 10 * 60_000
/** pin 至少在位这么久，「窗口内没有拒绝」才算它被生产流量验证过。 */
export const AGY_EVIDENCE_MIN_TENURE_MS = 10 * 60_000
/** 日志时间戳超前当前时间多少以内按时钟误差处理，更超前的不是这个窗口里的记录。 */
const CLOCK_SKEW_TOLERANCE_MS = 60_000
/** glog 时间戳没有年份：解析出来比现在晚超过一天，就是去年的记录（跨年）。 */
const YEAR_ROLLOVER_MS = 24 * 60 * 60_000

export interface AgyRejections {
  /** 生成请求被拒（`FAILED_PRECONDITION (code 400): User location is not supported`）的记录时间。 */
  generation: number[]
  /** aicode 拒绝出口地区（`LOCATION_NOT_ELIGIBLE`）的记录时间。 */
  aicode: number[]
}

/** glog 行头：`E1118 21:08:28.123456 tid file.go:NN] msg`；没有这个行头的行是上一条记录的续行。 */
const GLOG_HEADER = /^[DIWEF](\d{2})(\d{2}) (\d{2}):(\d{2}):(\d{2})\.\d+ /
/** 生成请求的拒绝一定带 gRPC 状态名，用户把报错贴进对话之类的文字不会同时带上它。 */
const GENERATION_REJECTION = /FAILED_PRECONDITION.*location is not supported/i
const AICODE_REJECTION = /LOCATION_NOT_ELIGIBLE/

function parseGlogTimestamp(header: RegExpExecArray, nowMs: number): number | null {
  const [month, day, hour, minute, second] = header.slice(1).map(Number)
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null
  }
  const year = new Date(nowMs).getFullYear()
  const at = new Date(year, month - 1, day, hour, minute, second).getTime()
  return at > nowMs + YEAR_ROLLOVER_MS
    ? new Date(year - 1, month - 1, day, hour, minute, second).getTime()
    : at
}

/**
 * 逐条记录（行头 + 续行）统计地区拒绝：aicode 的 JSON 报文会换行，拒绝文案落在续行上，
 * 但时间只有行头才有，所以续行归给上一条记录。同一条记录只计一次。
 */
export function extractAgyRejections(text: string, nowMs: number): AgyRejections {
  const rejections: AgyRejections = { generation: [], aicode: [] }
  let at: number | null = null
  let generationCounted = false
  let aicodeCounted = false

  for (const line of text.split('\n')) {
    const header = GLOG_HEADER.exec(line)
    if (header) {
      at = parseGlogTimestamp(header, nowMs)
      generationCounted = false
      aicodeCounted = false
    }
    if (at === null) {
      continue
    }
    if (!generationCounted && GENERATION_REJECTION.test(line)) {
      rejections.generation.push(at)
      generationCounted = true
    }
    if (!aicodeCounted && AICODE_REJECTION.test(line)) {
      rejections.aicode.push(at)
      aicodeCounted = true
    }
  }
  return rejections
}

/** agy 进程命令行：argv0 是 `agy` 或以 `/agy` 结尾，后面还有参数（`agy-core`、`Agy 管家.app` 之类不是）。 */
const AGY_PROCESS = /(?:^|[\s/])agy\s/
const LOG_FILE_ARGUMENT = /--log-file(?:=|\s+)(\S+)/

/** 从进程命令行列表（`pgrep -fl` / `ps -o args=`）里取出正在运行的 agy 进程指定的日志文件（这类会话的日志不在默认目录里）。 */
export function parseAgyLogFilePaths(psOutput: string): string[] {
  const files = new Set<string>()
  for (const line of psOutput.split('\n')) {
    if (!AGY_PROCESS.test(line)) {
      continue
    }
    const file = LOG_FILE_ARGUMENT.exec(line)?.[1]
    if (file) {
      files.add(file)
    }
  }
  return [...files]
}

/**
 * - `rejected`：新 pin 上任后的窗口内出现了足够多的拒绝记录 —— 生产流量自己证明了这个出口被拒；
 * - `healthy`：pin 在位够久、上任后有 agy 会话在写日志，且窗口内没有拒绝 —— 生产流量证明它没问题；
 * - `unobserved`：没有足够的生产流量能说明任何事，只能靠探测。
 */
export type AgyProductionVerdict = 'rejected' | 'healthy' | 'unobserved'

export interface AgyProductionJudgement {
  verdict: AgyProductionVerdict
  /** 窗口内计入判定的拒绝记录条数。 */
  records: number
}

export function judgeAgyPinByProduction(input: {
  rejections: AgyRejections
  /** 最近一次有 agy 会话写日志的时间；没有任何会话日志为 null。 */
  lastActivityMs: number | null
  nowMs: number
  /** 当前 pin 上任的时间。 */
  pinSinceMs: number
}): AgyProductionJudgement {
  const { rejections, lastActivityMs, nowMs, pinSinceMs } = input
  const earliest = Math.max(pinSinceMs + AGY_EVIDENCE_GRACE_MS, nowMs - AGY_EVIDENCE_WINDOW_MS)
  const latest = nowMs + CLOCK_SKEW_TOLERANCE_MS
  const inWindow = (at: number): boolean => at >= earliest && at <= latest
  const records =
    rejections.generation.filter(inWindow).length + rejections.aicode.filter(inWindow).length

  if (records >= AGY_EVIDENCE_REJECTION_THRESHOLD) {
    return { verdict: 'rejected', records }
  }
  const observedSincePin =
    lastActivityMs !== null &&
    lastActivityMs >= pinSinceMs + AGY_EVIDENCE_GRACE_MS &&
    nowMs - lastActivityMs <= AGY_EVIDENCE_ACTIVITY_MS
  const tenuredLongEnough = nowMs - pinSinceMs >= AGY_EVIDENCE_MIN_TENURE_MS
  return {
    verdict: observedSincePin && tenuredLongEnough && records === 0 ? 'healthy' : 'unobserved',
    records
  }
}

/**
 * 生产证据触发的修复，每小时最多这么多次。日志里的拒绝不一定属于这个出口（会话绕开了 Sparkle 的路由）、
 * 也可能是账号级问题，换节点救不了；不设上限，出口会因为同一批记录一个接一个地被换掉，连带切断正在进行的会话。
 */
export const AGY_EVIDENCE_REPAIR_LIMIT = 3
export const AGY_EVIDENCE_REPAIR_WINDOW_MS = 60 * 60_000

/** 仍在限速窗口内的证据修复时间。 */
export function recentEvidenceRepairs(history: readonly number[], nowMs: number): number[] {
  return history.filter((at) => nowMs - at < AGY_EVIDENCE_REPAIR_WINDOW_MS)
}

/** 窗口内已做的证据修复未达上限，才允许再做一次。 */
export function canRepairOnEvidence(history: readonly number[], nowMs: number): boolean {
  return recentEvidenceRepairs(history, nowMs).length < AGY_EVIDENCE_REPAIR_LIMIT
}
