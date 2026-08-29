/** Pure scheduling helpers for remote profile auto-update (GUI timer + LaunchAgent CLI). */

export const PROFILE_UPDATE_DUE_ARG = '--sparkle-profile-update-due'
export const PROFILE_UPDATE_WINDOW_MS = 5 * 60 * 1000

export function calculateDelayToTime(time: string, now = new Date()): number {
  const match = time.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) {
    return -1
  }

  const hours = parseInt(match[1], 10)
  const minutes = parseInt(match[2], 10)

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return -1
  }

  const target = new Date(now)
  target.setHours(hours, minutes, 0, 0)

  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1)
  }

  return target.getTime() - now.getTime()
}

export function getRepeatDelayMs(item: ProfileItem): number {
  if (item.updateTime) {
    return 24 * 60 * 60 * 1000
  }
  if (item.interval) {
    return item.interval * 60 * 1000
  }
  return -1
}

export function calculateUpdateDelay(item: ProfileItem, nowMs = Date.now()): number {
  if (item.updateTime) {
    const delay = calculateDelayToTime(item.updateTime, new Date(nowMs))
    if (delay !== -1) {
      return delay
    }
  }

  if (!item.interval) {
    return -1
  }

  const lastUpdated = item.updated || 0
  const intervalMs = item.interval * 60 * 1000
  const timeSinceLastUpdate = nowMs - lastUpdated

  if (timeSinceLastUpdate >= intervalMs) {
    return 0
  }

  return intervalMs - timeSinceLastUpdate
}

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

function startOfLocalDayMs(now: Date): number {
  const dayStart = new Date(now)
  dayStart.setHours(0, 0, 0, 0)
  return dayStart.getTime()
}

export function isProfileUpdateDueNow(
  item: ProfileItem,
  now = new Date(),
  windowMs = PROFILE_UPDATE_WINDOW_MS,
): boolean {
  if (item.type !== 'remote' || item.autoUpdate === false) {
    return false
  }

  if (!item.interval && !item.updateTime) {
    return false
  }

  const nowMs = now.getTime()
  const lastUpdated = item.updated || 0

  if (item.updateTime) {
    const parsed = parseUpdateTime(item.updateTime)
    if (!parsed) {
      return false
    }

    const scheduledAt = new Date(now)
    scheduledAt.setHours(parsed.hours, parsed.minutes, 0, 0)
    const scheduledMs = scheduledAt.getTime()

    if (nowMs < scheduledMs || nowMs >= scheduledMs + windowMs) {
      return false
    }

    return lastUpdated < scheduledMs
  }

  if (!item.interval) {
    return false
  }

  const intervalMs = item.interval * 60 * 1000
  return nowMs - lastUpdated >= intervalMs
}

export function shouldScheduleProfileUpdater(item: ProfileItem | undefined): item is ProfileItem {
  return (
    item?.type === 'remote' &&
    Boolean(item.interval || item.updateTime) &&
    item.autoUpdate !== false
  )
}

export function computeScheduleDelayMs(item: ProfileItem, offsetMs = 0, nowMs = Date.now()): number {
  const delay = calculateUpdateDelay(item, nowMs)
  if (delay === -1) {
    return -1
  }

  const repeatDelay = getRepeatDelayMs(item)
  if (repeatDelay === -1) {
    return -1
  }

  return (delay === 0 ? repeatDelay : delay) + offsetMs
}

export function wasProfileUpdatedRecently(item: ProfileItem, nowMs = Date.now()): boolean {
  if (!item.updated) {
    return false
  }

  return nowMs - item.updated < PROFILE_UPDATE_WINDOW_MS
}

export function nextScheduledUpdateTimeIso(item: ProfileItem, nowMs = Date.now()): string | null {
  const delayMs = computeScheduleDelayMs(item, 0, nowMs)
  if (delayMs === -1) {
    return null
  }

  return new Date(nowMs + delayMs).toISOString()
}

export function localDayKey(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function dailyUpdateSlotKey(item: ProfileItem, now = new Date()): string | null {
  if (!item.updateTime) {
    return null
  }

  return `${localDayKey(now)}@${item.updateTime}`
}
