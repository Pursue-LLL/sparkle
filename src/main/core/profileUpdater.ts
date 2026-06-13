import { addProfileItem, getCurrentProfileItem, getProfileConfig } from '../config'

const intervalPool: Record<string, NodeJS.Timeout> = {}

/**
 * 计算到指定时间点的延迟（毫秒）
 * @param time 时间点，格式为 "HH:mm"（如 "04:00"）
 * @returns 延迟毫秒数，如果时间点无效返回 -1
 */
function calculateDelayToTime(time: string): number {
  const match = time.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) {
    return -1
  }

  const hours = parseInt(match[1], 10)
  const minutes = parseInt(match[2], 10)

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return -1
  }

  const now = new Date()
  const target = new Date()
  target.setHours(hours, minutes, 0, 0)

  if (target <= now) {
    target.setDate(target.getDate() + 1)
  }

  return target.getTime() - now.getTime()
}

function getRepeatDelayMs(item: ProfileItem): number {
  if (item.updateTime) {
    return 24 * 60 * 60 * 1000
  }
  if (item.interval) {
    return item.interval * 60 * 1000
  }
  return -1
}

function calculateUpdateDelay(item: ProfileItem): number {
  if (item.updateTime) {
    const delay = calculateDelayToTime(item.updateTime)
    if (delay !== -1) {
      return delay
    }
  }

  if (!item.interval) {
    return -1
  }

  const now = Date.now()
  const lastUpdated = item.updated || 0
  const intervalMs = item.interval * 60 * 1000
  const timeSinceLastUpdate = now - lastUpdated

  if (timeSinceLastUpdate >= intervalMs) {
    return 0
  }

  return intervalMs - timeSinceLastUpdate
}

export async function initProfileUpdater(): Promise<void> {
  const { items, current } = await getProfileConfig()
  const currentItem = await getCurrentProfileItem()
  for (const item of items.filter((i) => i.id !== current)) {
    if (item.type === 'remote' && (item.interval || item.updateTime) && item.autoUpdate !== false) {
      const delay = calculateUpdateDelay(item)

      if (delay === -1) {
        continue
      }

      if (delay === 0) {
        try {
          await addProfileItem(item)
        } catch (e) {
          // ignore
        }
      }

      const repeatDelay = getRepeatDelayMs(item)
      if (repeatDelay === -1) {
        continue
      }

      intervalPool[item.id] = setTimeout(
        async () => {
          try {
            await addProfileItem(item)
          } catch (e) {
            // ignore
          }
        },
        delay === 0 ? repeatDelay : delay
      )
    }
  }

  if (
    currentItem?.type === 'remote' &&
    (currentItem.interval || currentItem.updateTime) &&
    currentItem.autoUpdate !== false
  ) {
    const delay = calculateUpdateDelay(currentItem)

    if (delay === 0) {
      try {
        await addProfileItem(currentItem)
      } catch (e) {
        // ignore
      }
    }

    const repeatDelay = getRepeatDelayMs(currentItem)
    if (repeatDelay !== -1) {
      intervalPool[currentItem.id] = setTimeout(
        async () => {
          try {
            await addProfileItem(currentItem)
          } catch (e) {
            // ignore
          }
        },
        (delay === 0 ? repeatDelay : delay) + 10000
      )
    }
  }
}

export async function addProfileUpdater(item: ProfileItem): Promise<void> {
  if (item.type === 'remote' && (item.interval || item.updateTime) && item.autoUpdate !== false) {
    if (intervalPool[item.id]) {
      clearTimeout(intervalPool[item.id])
    }

    const delay = calculateUpdateDelay(item)

    if (delay === -1) {
      return
    }

    if (delay === 0) {
      try {
        await addProfileItem(item)
      } catch (e) {
        // ignore
      }
    }

    const repeatDelay = getRepeatDelayMs(item)
    if (repeatDelay === -1) {
      return
    }

    intervalPool[item.id] = setTimeout(
      async () => {
        try {
          await addProfileItem(item)
        } catch (e) {
          // ignore
        }
      },
      delay === 0 ? repeatDelay : delay
    )
  }
}

export async function delProfileUpdater(id: string): Promise<void> {
  if (intervalPool[id]) {
    clearTimeout(intervalPool[id])
    delete intervalPool[id]
  }
}
