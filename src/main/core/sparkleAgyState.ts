// [INPUT] dataDir()/sparkle-agy-state.json
// [OUTPUT] openAgyState · clearAgyRepairBackoff · AgyState · AgyStateHandle · AgyPhase
// [POS] agy 巡检编排状态的唯一读写入口：退避、超时累计、修复扫描的「已试」记录都落盘。
// 为什么落盘：无头调度任务每次都是新进程，内存里的状态活不过一轮；状态一丢，退避失效、同一批坏节点被反复重试。
// 状态只是巡检的辅助记忆，不是真相：文件缺失、损坏或字段不合法都退回默认值，最坏结果是多做一轮探测，不会卡住巡检。

import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { dataDir } from '../utils/dirs'

const STATE_FILENAME = 'sparkle-agy-state.json'

/** 「已试」记录的保留时长：排序只看最近 15 分钟，更久的记录没有用处，不再带着它们。 */
const ATTEMPT_RETENTION_MS = 60 * 60 * 1000

export type AgyPhase = 'healthy' | 'repairing' | 'exhausted'

export interface AgyState {
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
}

export interface AgyStateHandle {
  readonly state: AgyState
  /** 与读出时相比有变化才写盘；写盘失败向上抛，由调用方决定怎么记。 */
  commit: () => Promise<void>
}

interface SerializedAgyState {
  phase: AgyPhase
  emptyRounds: number
  repairSkipUntilMs: number
  pinUnknownStreak: number
  attempts: Record<string, number>
}

const PHASES: readonly AgyPhase[] = ['healthy', 'repairing', 'exhausted']

function statePath(): string {
  return path.join(dataDir(), STATE_FILENAME)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function parseAttempts(value: unknown, nowMs: number): Map<string, number> {
  const attempts = new Map<string, number>()
  if (!isRecord(value)) {
    return attempts
  }
  for (const [fingerprint, attemptedAt] of Object.entries(value)) {
    if (typeof attemptedAt === 'number' && nowMs - attemptedAt <= ATTEMPT_RETENTION_MS) {
      attempts.set(fingerprint, attemptedAt)
    }
  }
  return attempts
}

function parseState(raw: unknown, nowMs: number): AgyState {
  const source = isRecord(raw) ? raw : {}
  return {
    phase: PHASES.find((phase) => phase === source.phase) ?? 'healthy',
    emptyRounds: nonNegativeNumber(source.emptyRounds),
    repairSkipUntilMs: nonNegativeNumber(source.repairSkipUntilMs),
    pinUnknownStreak: nonNegativeNumber(source.pinUnknownStreak),
    attempts: parseAttempts(source.attempts, nowMs)
  }
}

function serialize(state: AgyState): string {
  const document: SerializedAgyState = {
    phase: state.phase,
    emptyRounds: state.emptyRounds,
    repairSkipUntilMs: state.repairSkipUntilMs,
    pinUnknownStreak: state.pinUnknownStreak,
    attempts: Object.fromEntries(state.attempts)
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
