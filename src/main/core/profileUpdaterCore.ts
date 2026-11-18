// [INPUT] 订阅列表（type · updated · updateTime · interval · merge） ·
//         profileContentCore::InvalidProfileContentError (POS: 订阅内容写盘前校验)
// [OUTPUT] PROFILE_UPDATE_DUE_ARG · INVALID_CONTENT_RETRY_MS · FAILURE_NOTICE_AFTER_MS · FailureNotice · latestScheduledSlotMs · isRemoteProfileDue · isMergeProfileDue · createDueProfileUpdateRunner
// [POS] 订阅自动更新的唯一判定与编排：GUI 心跳与 LaunchAgent CLI 共用。
// 不依赖定时器恰好在计划时刻触发——只看「上次成功更新是否早于最近一个计划时刻」，
// 所以睡眠跨过计划时刻、断网导致失败后，下一次检查都会自动补上；
// 服务端返回「不是配置」的内容时旧文件保留、按递增间隔重试，不按心跳频率反复请求；
// 同一订阅持续失败超过一个心跳周期时提醒一次，否则失败只写日志，没人会发现订阅已经停在旧内容上。

import { InvalidProfileContentError } from './profileContentCore'

export const PROFILE_UPDATE_DUE_ARG = '--sparkle-profile-update-due'

function parseUpdateTime(time: string): { hours: number; minutes: number } | null {
  const match = time.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) {
    return null
  }

  const hours = parseInt(match[1], 10)
  const minutes = parseInt(match[2], 10)
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null
  }

  return { hours, minutes }
}

/**
 * 比此刻还晚的 updated 来自曾经错误的系统时钟：按有效值使用会让远程订阅直到时间追上才更新、
 * 让合并订阅永远「来源比它新」而每个心跳都重建，因此视为未知（0），到期后重新写入正确的时间。
 */
function trustedUpdated(item: ProfileItem | undefined, nowMs: number): number {
  const updated = item?.updated ?? 0
  return updated > nowMs ? 0 : updated
}

/** 最近一个已到的每日更新时刻（含此刻）；时间格式非法返回 null。 */
export function latestScheduledSlotMs(updateTime: string, nowMs: number): number | null {
  const parsed = parseUpdateTime(updateTime)
  if (!parsed) {
    return null
  }

  const slot = new Date(nowMs)
  slot.setHours(parsed.hours, parsed.minutes, 0, 0)
  if (slot.getTime() > nowMs) {
    slot.setDate(slot.getDate() - 1)
  }
  return slot.getTime()
}

/**
 * 远程订阅是否到期：每日定时看最近一个计划时刻之后是否更新过，间隔模式看距上次更新是否已满一个周期。
 * 没有 URL 的订阅无法远程更新（只会从本地缓存重载，updated 不会前进），不参与自动更新。
 */
export function isRemoteProfileDue(item: ProfileItem, nowMs: number): boolean {
  if (item.type !== 'remote' || item.autoUpdate === false || !item.url) {
    return false
  }

  const lastUpdated = trustedUpdated(item, nowMs)
  if (item.updateTime) {
    const slot = latestScheduledSlotMs(item.updateTime, nowMs)
    if (slot !== null) {
      return lastUpdated < slot
    }
  }

  const intervalMs = (item.interval ?? 0) * 60 * 1000
  return intervalMs > 0 && nowMs - lastUpdated >= intervalMs
}

/** 合并订阅内容完全由来源文件决定：任一来源比合并订阅更新，就说明合并订阅落后、需要重建。 */
export function isMergeProfileDue(
  item: ProfileItem,
  items: readonly ProfileItem[],
  nowMs: number
): boolean {
  if (!item.merge || item.autoUpdate === false) {
    return false
  }

  const lastBuilt = trustedUpdated(item, nowMs)
  const sourceIds = [item.merge.base, ...item.merge.sources]
  return sourceIds.some(
    (id) =>
      trustedUpdated(
        items.find((candidate) => candidate.id === id),
        nowMs
      ) > lastBuilt
  )
}

/** 订阅下载本身没有超时；单次更新卡住会让并发共享的这次执行永不结束，必须由编排器兜底。 */
const DEFAULT_UPDATE_TIMEOUT_MS = 2 * 60 * 1000

/**
 * 服务端返回「不是配置」的内容（错误页、限流提示）后的重试间隔，按连续失败次数递增，封顶在最后一档。
 * 每次重试都是一次真实请求；GUI 心跳与 LaunchAgent 各自每 5 分钟进来一次，
 * 持续出错时照单全收既消耗机场订阅接口的额度，也可能因请求过密被封。
 * 第一档与心跳同频，瞬时的坏响应下一次心跳就能恢复。
 * 网络错误不走这张表：连接失败不会请求到服务端，仍然每次心跳重试。
 */
export const INVALID_CONTENT_RETRY_MS: readonly number[] = [5, 15, 30, 60].map(
  (minutes) => minutes * 60 * 1000
)

/**
 * 同一订阅从第一次失败起持续这么久仍在失败，才提醒一次；每个失败序列只提醒一次，成功一次即清零。
 * 以时间而不是次数为准：GUI 心跳与 LaunchAgent 各自每 5 分钟进来一次、相位不同，
 * 连续两次失败可以只隔几秒（睡眠唤醒后网络还没恢复时就是这样），撑过一个心跳周期仍在失败才算真的出了问题。
 * 计数只存内存：LaunchAgent 在 GUI 没运行时是一次性进程，一个序列里只有一次失败、撑不到这么久，所以不会每 5 分钟弹一次。
 */
export const FAILURE_NOTICE_AFTER_MS = 5 * 60 * 1000

const NOTICE_REASON_MAX_CHARS = 100

/** 通知会停留在锁屏与通知中心：内容无效时不转述服务端返回的文字，细节只留在日志里。 */
const INVALID_CONTENT_NOTICE_REASON = '服务端返回的内容不是有效的配置'

export interface FailureNotice {
  id: string
  title: string
  body: string
}

/** 一个订阅当前的失败序列：第一次失败的时刻、失败次数、是否已经提醒过。 */
interface FailureStreak {
  sinceMs: number
  failures: number
  noticed: boolean
}

export interface DueProfileUpdateDeps {
  listItems: () => Promise<readonly ProfileItem[]>
  update: (item: ProfileItem) => Promise<void>
  log: (message: string) => Promise<void>
  /** 失败持续超过 {@link FAILURE_NOTICE_AFTER_MS} 时每个失败序列调用一次；它抛出的错误只记日志。 */
  notify?: (notice: FailureNotice) => Promise<void>
  now?: () => number
  updateTimeoutMs?: number
}

/** 同一订阅共用一个通知 id：系统通知模式下，下一个失败序列的提醒会顶替还留在屏幕上的上一条。 */
function buildFailureNotice(item: ProfileItem, failures: number, reason: string): FailureNotice {
  const brief =
    reason.length > NOTICE_REASON_MAX_CHARS
      ? `${reason.slice(0, NOTICE_REASON_MAX_CHARS)}…`
      : reason
  return {
    id: `profile-update-failed:${item.id}`,
    title: '订阅更新失败',
    body: `「${item.name}」已连续 ${failures} 次更新失败，仍在使用上一份内容：${brief}`
  }
}

function withTimeout(task: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`超过 ${Math.round(timeoutMs / 1000)} 秒未完成`)),
      timeoutMs
    )
  })
  return Promise.race([task, timedOut]).finally(() => clearTimeout(timer))
}

/**
 * 检查并更新所有到期订阅，返回成功更新的个数。
 * - 先更新来源订阅，再重新读取列表补齐落后的合并订阅（来源更新会改写来源的 updated）。
 * - 单个订阅失败或超时只记日志，不影响其它订阅；失败不会推进 updated，下一次检查仍然到期，即自动重试。
 * - 服务端返回的内容通不过校验（{@link InvalidProfileContentError}）时按 {@link INVALID_CONTENT_RETRY_MS} 递增退避，
 *   退避期内的订阅不参与检查；退避状态只存内存，重启后重新计。
 * - 任何原因的失败持续超过 {@link FAILURE_NOTICE_AFTER_MS} 时通过 `notify` 提醒一次（每个失败序列一次）。
 * - 并发调用共享同一次执行，避免 GUI 心跳与 LaunchAgent 同时更新同一个订阅。
 */
export function createDueProfileUpdateRunner(deps: DueProfileUpdateDeps): () => Promise<number> {
  const now = deps.now ?? Date.now
  const updateTimeoutMs = deps.updateTimeoutMs ?? DEFAULT_UPDATE_TIMEOUT_MS
  /** 订阅 id → 因内容无效连续失败的次数与下一次允许重试的时刻；成功一次即清除。 */
  const invalidContentRetries = new Map<string, { failures: number; retryAtMs: number }>()
  /** 订阅 id → 任何原因的失败序列；成功一次即清除。 */
  const failureStreaks = new Map<string, FailureStreak>()

  const isWaitingToRetry = (item: ProfileItem): boolean =>
    (invalidContentRetries.get(item.id)?.retryAtMs ?? 0) > now()

  /** 记一次内容无效的失败，返回写进日志的后续安排。 */
  const scheduleInvalidContentRetry = (item: ProfileItem): string => {
    const failures = (invalidContentRetries.get(item.id)?.failures ?? 0) + 1
    const delayMs =
      INVALID_CONTENT_RETRY_MS[Math.min(failures, INVALID_CONTENT_RETRY_MS.length) - 1]
    invalidContentRetries.set(item.id, { failures, retryAtMs: now() + delayMs })
    return `；旧内容原样保留，第 ${failures} 次失败，${Math.round(delayMs / 60_000)} 分钟后重试`
  }

  /** 记一次失败，序列持续够久时提醒一次；提醒失败只记日志，不影响本轮其它订阅。 */
  const recordFailure = async (item: ProfileItem, reason: string): Promise<void> => {
    const at = now()
    const previous = failureStreaks.get(item.id)
    const failures = (previous?.failures ?? 0) + 1
    const sinceMs = previous?.sinceMs ?? at
    const due = !previous?.noticed && at - sinceMs >= FAILURE_NOTICE_AFTER_MS
    failureStreaks.set(item.id, { sinceMs, failures, noticed: previous?.noticed === true || due })
    if (!due || !deps.notify) {
      return
    }

    try {
      await deps.notify(buildFailureNotice(item, failures, reason))
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error)
      await deps.log(
        `[ProfileUpdater]: failure notice failed id=${item.id} name=${item.name}: ${cause}\n`
      )
      return
    }
    await deps.log(
      `[ProfileUpdater]: failure notice sent id=${item.id} name=${item.name} failures=${failures}\n`
    )
  }

  const attempt = async (item: ProfileItem): Promise<boolean> => {
    try {
      await withTimeout(deps.update(item), updateTimeoutMs)
      invalidContentRetries.delete(item.id)
      failureStreaks.delete(item.id)
      await deps.log(`[ProfileUpdater]: update succeeded id=${item.id} name=${item.name}\n`)
      return true
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      const invalidContent = error instanceof InvalidProfileContentError
      const followUp = invalidContent ? scheduleInvalidContentRetry(item) : ''
      await deps.log(
        `[ProfileUpdater]: update failed id=${item.id} name=${item.name}: ${reason}${followUp}\n`
      )
      await recordFailure(item, invalidContent ? INVALID_CONTENT_NOTICE_REASON : reason)
      return false
    }
  }

  const runOnce = async (): Promise<number> => {
    let updatedCount = 0

    const first = await deps.listItems()
    for (const item of first.filter(
      (candidate) => isRemoteProfileDue(candidate, now()) && !isWaitingToRetry(candidate)
    )) {
      updatedCount += Number(await attempt(item))
    }

    const second = await deps.listItems()
    for (const item of second.filter(
      (candidate) => isMergeProfileDue(candidate, second, now()) && !isWaitingToRetry(candidate)
    )) {
      updatedCount += Number(await attempt(item))
    }

    return updatedCount
  }

  let inFlight: Promise<number> | undefined
  return () => {
    inFlight ??= runOnce().finally(() => {
      inFlight = undefined
    })
    return inFlight
  }
}
