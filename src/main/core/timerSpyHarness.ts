// [INPUT] node:test mock · 全局 setInterval / setTimeout
// [OUTPUT] spyOnTimer · TimerSpy
// [POS] 行为测试共用：记录定时器的登记次数、间隔与 unref 次数；计时本身仍由调用方的假时钟负责。
// 仅供测试使用。

import { mock } from 'node:test'

type TimerApi = 'setInterval' | 'setTimeout'
type TimerFunction = (...args: unknown[]) => NodeJS.Timeout

export interface TimerSpy {
  /** 每次登记的间隔（毫秒），按登记顺序。 */
  delays: number[]
  /** 被 unref 的定时器个数。 */
  unrefs: () => number
  restore: () => void
}

export function spyOnTimer(api: TimerApi): TimerSpy {
  const timers = globalThis as unknown as Record<TimerApi, TimerFunction>
  const real = timers[api]
  const delays: number[] = []
  let unrefs = 0
  const spy = mock.method(timers, api, (...args: unknown[]) => {
    delays.push(args[1] as number)
    const timer = real(...args)
    mock.method(timer, 'unref', () => {
      unrefs += 1
      return timer
    })
    return timer
  })
  return { delays, unrefs: () => unrefs, restore: () => spy.mock.restore() }
}
