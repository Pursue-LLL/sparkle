// [INPUT] dataDir()/sparkle-agy-state.json ·
//         sparkleAgyEvidenceCore::recentEvidenceRepairs (POS: agy 出口生产证据) ·
//         sparkleAgyReputation::AGY_FLAG_MEMORY_MS/AgyFlags (POS: agy 节点被拒记忆)
// [OUTPUT] openAgyState · clearAgyRepairBackoff · AgyState · AgyPin · AgyStateHandle · AgyPhase
// [POS] agy 巡检编排状态的唯一读写入口：pin 的上任时间、上次复测时间、退避、超时累计、修复扫描的「已试」记录、
// 生产证据修复的限速记录与节点被拒记忆都落盘。
// 为什么落盘：无头调度任务每次都是新进程，内存里的状态活不过一轮；状态一丢，退避失效、同一批坏节点被反复重试。
// 状态只是巡检的辅助记忆，不是真相：文件缺失、损坏或字段不合法都退回默认值，最坏结果是多做一轮探测，不会卡住巡检。

import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { dataDir } from '../utils/dirs'
import { recentEvidenceRepairs } from './sparkleAgyEvidenceCore'
import { AGY_FLAG_MEMORY_MS, type AgyFlags } from './sparkleAgyReputation'

const STATE_FILENAME = 'sparkle-agy-state.json'

/** 「已试」记录的保留时长：排序只看最近 15 分钟，更久的记录没有用处，不再带着它们。 */
const ATTEMPT_RETENTION_MS = 60 * 60 * 1000

export type AgyPhase = 'healthy' | 'repairing' | 'exhausted'

/** 当前钉住的节点与它上任的时间：生产证据只认上任之后的记录。 */
export interface AgyPin {
  name: string
  sinceMs: number
}

export interface AgyState {
  pin: AgyPin | null
  /** 上一次复测 pin 并处理完结论的时间：判定下一次复测何时到期。 */
  lastPinCheckMs: number
  /** 巡检所处阶段：只用来让「开始修复 / 恢复健康」这类日志每次状态变化只记一条。 */
  phase: AgyPhase
  /** 连续全灭的修复轮次：下一次修复间隔的倍数来源。 */
  emptyRounds: number
  /** 在此之前不做修复扫描；pin 就地复测不受它约束，否则节点坏了也发现不了。 */
  repairSkipUntilMs: number
  /** pin 复测连续超时的轮数。 */
  pinUnknownStreak: number
  /** 修复扫描的「本轮已试」记录（节点指纹 → 时间）：超时不会写探测缓存，必须单独记，否则下一轮重复同一批节点。 */
  attempts: Map<string, number>
  /** 节点被拒记忆：只有落盘，无头调度的每个新进程才记得住 24 小时前谁出过问题。 */
  flags: AgyFlags
  /** 最近由生产证据触发的修复时间（限速用，见 canRepairOnEvidence）。 */
  evidenceRepairs: number[]
}

export interface AgyStateHandle {
  readonly state: AgyState
  /** 与读出时相比有变化才写盘；写盘失败向上抛，由调用方决定怎么记。 */
  commit: () => Promise<void>
}

interface SerializedAgyState {
  pin: AgyPin | null
  lastPinCheckMs: number
  phase: AgyPhase
  emptyRounds: number
  repairSkipUntilMs: number
  pinUnknownStreak: number
  attempts: Record<string, number>
  flags: Record<string, number>
  evidenceRepairs: number[]
}

const PHASES: readonly AgyPhase[] = ['healthy', 'repairing', 'exhausted']

function statePath(): string {
  return path.join(dataDir(), STATE_FILENAME)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function nonNegativeNumber(value: unknown): number {
  return isFiniteNumber(value) && value >= 0 ? value : 0
}

function parsePin(value: unknown): AgyPin | null {
  if (!isRecord(value)) {
    return null
  }
  const { name, sinceMs } = value
  return typeof name === 'string' && name !== '' && isFiniteNumber(sinceMs)
    ? { name, sinceMs }
    : null
}

/** 节点指纹 → 时间戳的映射：只留年龄不到 `retentionMs` 的合法记录，过期的在读出时就丢掉。 */
function parseTimestamps(value: unknown, nowMs: number, retentionMs: number): Map<string, number> {
  const timestamps = new Map<string, number>()
  if (!isRecord(value)) {
    return timestamps
  }
  for (const [fingerprint, at] of Object.entries(value)) {
    if (isFiniteNumber(at) && nowMs - at < retentionMs) {
      timestamps.set(fingerprint, at)
    }
  }
  return timestamps
}

function parseState(raw: unknown, nowMs: number): AgyState {
  const source = isRecord(raw) ? raw : {}
  return {
    pin: parsePin(source.pin),
    lastPinCheckMs: nonNegativeNumber(source.lastPinCheckMs),
    phase: PHASES.find((phase) => phase === source.phase) ?? 'healthy',
    emptyRounds: nonNegativeNumber(source.emptyRounds),
    repairSkipUntilMs: nonNegativeNumber(source.repairSkipUntilMs),
    pinUnknownStreak: nonNegativeNumber(source.pinUnknownStreak),
    attempts: parseTimestamps(source.attempts, nowMs, ATTEMPT_RETENTION_MS),
    flags: parseTimestamps(source.flags, nowMs, AGY_FLAG_MEMORY_MS),
    evidenceRepairs: Array.isArray(source.evidenceRepairs)
      ? recentEvidenceRepairs(source.evidenceRepairs.filter(isFiniteNumber), nowMs)
      : []
  }
}

function serialize(state: AgyState): string {
  const document: SerializedAgyState = {
    pin: state.pin,
    lastPinCheckMs: state.lastPinCheckMs,
    phase: state.phase,
    emptyRounds: state.emptyRounds,
    repairSkipUntilMs: state.repairSkipUntilMs,
    pinUnknownStreak: state.pinUnknownStreak,
    attempts: Object.fromEntries(state.attempts),
    flags: Object.fromEntries(state.flags),
    evidenceRepairs: state.evidenceRepairs
  }
  return JSON.stringify(document)
}

/** pin 回到可用 / 修复成功：全灭退避与超时累计都属于旧 pin，作废后下一次出问题从第 1 轮重新计。 */
export function clearAgyRepairBackoff(state: AgyState): void {
  state.emptyRounds = 0
  state.repairSkipUntilMs = 0
  state.pinUnknownStreak = 0
}

async function readRaw(): Promise<unknown> {
  try {
    return JSON.parse(await readFile(statePath(), 'utf8'))
  } catch {
    return undefined
  }
}

export async function openAgyState(nowMs: number = Date.now()): Promise<AgyStateHandle> {
  const state = parseState(await readRaw(), nowMs)
  let persisted = serialize(state)
  return {
    state,
    commit: async () => {
      const current = serialize(state)
      if (current === persisted) {
        return
      }
      await writeFile(statePath(), current, 'utf8')
      persisted = current
    }
  }
}
