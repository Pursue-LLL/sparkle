// [INPUT] 订阅列表（type · updated · updateTime · interval · merge）
// [OUTPUT] PROFILE_UPDATE_DUE_ARG · latestScheduledSlotMs · isRemoteProfileDue · isMergeProfileDue · createDueProfileUpdateRunner
// [POS] 订阅自动更新的唯一判定与编排：GUI 心跳与 LaunchAgent CLI 共用。
// 不依赖定时器恰好在计划时刻触发——只看「上次成功更新是否早于最近一个计划时刻」，
// 所以睡眠跨过计划时刻、断网导致失败后，下一次检查都会自动补上。

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

  const lastUpdated = item.updated || 0
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
export function isMergeProfileDue(item: ProfileItem, items: readonly ProfileItem[]): boolean {
  if (!item.merge || item.autoUpdate === false) {
    return false
  }

  const lastBuilt = item.updated || 0
  const sourceIds = [item.merge.base, ...item.merge.sources]
  return sourceIds.some((id) => (items.find((candidate) => candidate.id === id)?.updated ?? 0) > lastBuilt)
}

/** 订阅下载本身没有超时；单次更新卡住会让并发共享的这次执行永不结束，必须由编排器兜底。 */
const DEFAULT_UPDATE_TIMEOUT_MS = 2 * 60 * 1000

export interface DueProfileUpdateDeps {
  listItems: () => Promise<readonly ProfileItem[]>
  update: (item: ProfileItem) => Promise<void>
  log: (message: string) => Promise<void>
  now?: () => number
  updateTimeoutMs?: number
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
 * - 并发调用共享同一次执行，避免 GUI 心跳与 LaunchAgent 同时更新同一个订阅。
 */
export function createDueProfileUpdateRunner(deps: DueProfileUpdateDeps): () => Promise<number> {
  const now = deps.now ?? Date.now
  const updateTimeoutMs = deps.updateTimeoutMs ?? DEFAULT_UPDATE_TIMEOUT_MS

  const attempt = async (item: ProfileItem): Promise<boolean> => {
    try {
      await withTimeout(deps.update(item), updateTimeoutMs)
      await deps.log(`[ProfileUpdater]: update succeeded id=${item.id} name=${item.name}\n`)
      return true
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      await deps.log(`[ProfileUpdater]: update failed id=${item.id} name=${item.name}: ${reason}\n`)
      return false
    }
  }

  const runOnce = async (): Promise<number> => {
    let updatedCount = 0

    const first = await deps.listItems()
    for (const item of first.filter((candidate) => isRemoteProfileDue(candidate, now()))) {
      updatedCount += Number(await attempt(item))
    }

    const second = await deps.listItems()
    for (const item of second.filter((candidate) => isMergeProfileDue(candidate, second))) {
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
