import { addProfileItem, getCurrentProfileItem, getProfileConfig } from '../config'
import { appendAppLog } from '../utils/log'
import {
  calculateUpdateDelay,
  computeScheduleDelayMs,
  isProfileUpdateDueNow,
  shouldScheduleProfileUpdater,
  wasProfileUpdatedRecently,
} from './profileUpdaterCore'

const intervalPool: Record<string, NodeJS.Timeout> = {}

const CURRENT_PROFILE_SCHEDULE_OFFSET_MS = 10_000

function formatProfileUpdaterError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function getFreshProfileItem(id: string): Promise<ProfileItem | undefined> {
  const { items } = await getProfileConfig(true)
  return items.find((item) => item.id === id)
}

async function enqueueProfileUpdateTimer(
  item: ProfileItem,
  scheduleDelayMs: number,
): Promise<void> {
  if (intervalPool[item.id]) {
    clearTimeout(intervalPool[item.id])
  }

  const nextRunAt = new Date(Date.now() + scheduleDelayMs)
  intervalPool[item.id] = setTimeout(() => {
    void runScheduledProfileUpdate(item.id)
  }, scheduleDelayMs)

  const scheduleLabel = item.updateTime
    ? `daily@${item.updateTime}`
    : `interval=${item.interval}m`
  await appendAppLog(
    `[ProfileUpdater]: scheduled id=${item.id} mode=${scheduleLabel} next=${nextRunAt.toISOString()}\n`,
  )
}

async function runScheduledProfileUpdate(profileId: string): Promise<void> {
  try {
    const item = await getFreshProfileItem(profileId)
    if (!shouldScheduleProfileUpdater(item)) {
      return
    }

    if (wasProfileUpdatedRecently(item)) {
      await appendAppLog(
        `[ProfileUpdater]: skipped id=${profileId} reason=recently_updated updated=${item.updated}\n`,
      )
      await scheduleProfileUpdater(item)
      return
    }

    await addProfileItem(item)
    await appendAppLog(
      `[ProfileUpdater]: scheduled update succeeded id=${profileId} name=${item.name}\n`,
    )
  } catch (error) {
    await appendAppLog(
      `[ProfileUpdater]: scheduled update failed id=${profileId}: ${formatProfileUpdaterError(error)}\n`,
    )

    try {
      const item = await getFreshProfileItem(profileId)
      if (!shouldScheduleProfileUpdater(item)) {
        return
      }

      const scheduleDelayMs = computeScheduleDelayMs(item)
      if (scheduleDelayMs === -1) {
        return
      }

      await enqueueProfileUpdateTimer(item, scheduleDelayMs)
    } catch (rescheduleError) {
      await appendAppLog(
        `[ProfileUpdater]: failed to reschedule id=${profileId}: ${formatProfileUpdaterError(rescheduleError)}\n`,
      )
    }
  }
}

async function scheduleProfileUpdater(
  item: ProfileItem,
  offsetMs = 0,
): Promise<void> {
  if (!shouldScheduleProfileUpdater(item)) {
    return
  }

  if (intervalPool[item.id]) {
    clearTimeout(intervalPool[item.id])
  }

  const delay = calculateUpdateDelay(item)
  if (delay === -1) {
    return
  }

  if (delay === 0) {
    await runScheduledProfileUpdate(item.id)
    return
  }

  const scheduleDelayMs = computeScheduleDelayMs(item, offsetMs)
  if (scheduleDelayMs === -1) {
    return
  }

  await enqueueProfileUpdateTimer(item, scheduleDelayMs)
}

export async function runDueProfileUpdates(source: 'timer' | 'cli' = 'cli'): Promise<number> {
  const { items } = await getProfileConfig(true)
  let updatedCount = 0

  for (const item of items) {
    if (!shouldScheduleProfileUpdater(item)) {
      continue
    }

    if (!isProfileUpdateDueNow(item)) {
      continue
    }

    if (wasProfileUpdatedRecently(item)) {
      await appendAppLog(
        `[ProfileUpdater]: cli skipped id=${item.id} reason=recently_updated source=${source}\n`,
      )
      continue
    }

    try {
      await addProfileItem(item)
      updatedCount += 1
      await appendAppLog(
        `[ProfileUpdater]: cli update succeeded id=${item.id} name=${item.name} source=${source}\n`,
      )
    } catch (error) {
      await appendAppLog(
        `[ProfileUpdater]: cli update failed id=${item.id} source=${source}: ${formatProfileUpdaterError(error)}\n`,
      )
    }
  }

  return updatedCount
}

export async function initProfileUpdater(): Promise<void> {
  const { items, current } = await getProfileConfig(true)
  const currentItem = (await getFreshProfileItem(current)) ?? (await getCurrentProfileItem())
  for (const item of items.filter((i) => i.id !== current)) {
    if (shouldScheduleProfileUpdater(item)) {
      await scheduleProfileUpdater(item)
    }
  }

  if (shouldScheduleProfileUpdater(currentItem)) {
    await scheduleProfileUpdater(currentItem, CURRENT_PROFILE_SCHEDULE_OFFSET_MS)
  }
}

export async function addProfileUpdater(item: ProfileItem): Promise<void> {
  await scheduleProfileUpdater(item)
}

export async function delProfileUpdater(id: string): Promise<void> {
  if (intervalPool[id]) {
    clearTimeout(intervalPool[id])
    delete intervalPool[id]
  }
}

export async function resetProfileUpdaterForTests(): Promise<void> {
  for (const id of Object.keys(intervalPool)) {
    clearTimeout(intervalPool[id])
    delete intervalPool[id]
  }
}
