// [INPUT] 无
// [OUTPUT] CORE_RESTART_MAX_BUSY_MS · CoalescingGate · createCoalescingGate · coreRestartGate
// [POS] 内核重启闸门：同一时刻只有一次重启在跑，运行中到达的请求合并成唯一的「随后重启」，所以重启既不会并发、
//       连续触发也最多多一次；执行超过上限视为卡死，放开闸门并让调用方收到错误；订阅接口供界面显示「重启中」。

/** 内核就绪没有总超时：卡死时调用方与界面不能无限等，超过这个时长就放开闸门并报错。 */
export const CORE_RESTART_MAX_BUSY_MS = 120_000

export interface CoalescingGate {
  /**
   * 空闲时立即执行；执行中则合并为唯一的随后执行，随后那次覆盖此前到达的全部请求，
   * 所以只适用于幂等任务（合并后到达的请求自带的 task 不会运行）。
   */
  run: (task: () => Promise<void>) => Promise<void>
  isBusy: () => boolean
  subscribe: (listener: () => void) => () => void
}

export function createCoalescingGate(maxBusyMs: number): CoalescingGate {
  // 当前这次执行占用闸门的期间，空闲时为 null。
  let slot: Promise<void> | null = null
  let queued: Promise<void> | null = null
  const listeners = new Set<() => void>()

  const emit = (): void => {
    for (const listener of listeners) {
      listener()
    }
  }

  const execute = (task: () => Promise<void>): Promise<void> => {
    let freeSlot!: () => void
    const thisSlot = new Promise<void>((resolve) => {
      freeSlot = resolve
    })
    slot = thisSlot
    emit()
    // 有排队的执行时闸门直接交接，界面不会闪回「空闲」。
    void thisSlot.then(() => {
      if (slot === thisSlot && queued === null) {
        slot = null
        emit()
      }
    })

    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`内核重启超过 ${Math.round(maxBusyMs / 1000)} 秒仍未完成`)),
        maxBusyMs
      )
    })
    // 包一层 Promise 让 task 的同步异常也变成拒绝，闸门不会因此卡在「忙」。
    const started = new Promise<void>((resolve) => {
      resolve(task())
    })
    const result = Promise.race([started, timeout])
    const finish = (): void => {
      clearTimeout(timer)
      freeSlot()
    }
    void result.then(finish, finish)
    return result
  }

  const run = (task: () => Promise<void>): Promise<void> => {
    if (slot === null) {
      return execute(task)
    }
    if (queued === null) {
      queued = slot.then(() => {
        queued = null
        return execute(task)
      })
    }
    return queued
  }

  return {
    run,
    isBusy: () => slot !== null,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}

export const coreRestartGate = createCoalescingGate(CORE_RESTART_MAX_BUSY_MS)
