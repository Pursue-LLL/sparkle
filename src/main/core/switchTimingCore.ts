// [INPUT] 无
// [OUTPUT] SwitchOperation · SwitchTimingSample · SwitchTimingDeps · formatSwitchTimingLine · createSwitchTimer
// [POS] 切换类操作（配置补丁 / 内核重启 / 系统代理）的耗时日志：每次一行 `[SwitchTiming]`，附整机 1 分钟负载与空闲内存，
//       「点了开关卡住」时第一眼就能分辨是 Sparkle 自己慢还是整机过载。纯逻辑，时钟 / 负载 / 内存 / 写日志全部注入；
//       日志只是旁路，取样或写日志失败都不得改变被计时操作的返回值与异常。

export type SwitchOperation = 'patchControledMihomoConfig' | 'restartCore' | 'triggerSysProxy'

export interface SwitchTimingSample {
  operation: SwitchOperation
  /** 被计时的函数是否抛出：`restartCore` 内部自己吞掉并通知的失败不算抛出。 */
  threw: boolean
  elapsedMs: number
  load1: number
  freeMemMb: number
}

export interface SwitchTimingDeps {
  /** 单调毫秒时钟，只用于求差。 */
  now: () => number
  load1: () => number
  freeMemMb: () => number
  log: (line: string) => Promise<void>
}

export function formatSwitchTimingLine(sample: SwitchTimingSample): string {
  const fields = [
    `op=${sample.operation}`,
    `threw=${sample.threw ? 1 : 0}`,
    `ms=${Math.round(sample.elapsedMs)}`,
    `load1=${sample.load1.toFixed(2)}`,
    `free_mem_mb=${Math.round(sample.freeMemMb)}`
  ]
  return `[SwitchTiming]: ${fields.join(' ')}\n`
}

export type SwitchTimer = <T>(operation: SwitchOperation, run: () => Promise<T>) => Promise<T>

export function createSwitchTimer(deps: SwitchTimingDeps): SwitchTimer {
  const record = (operation: SwitchOperation, threw: boolean, startedAt: number): void => {
    try {
      const line = formatSwitchTimingLine({
        operation,
        threw,
        elapsedMs: deps.now() - startedAt,
        load1: deps.load1(),
        freeMemMb: deps.freeMemMb()
      })
      void deps.log(line).catch(() => undefined)
    } catch {
      // 取样或写日志失败只丢这一行，不影响被计时的操作
    }
  }

  return async (operation, run) => {
    const startedAt = deps.now()
    let threw = true
    try {
      const result = await run()
      threw = false
      return result
    } finally {
      record(operation, threw, startedAt)
    }
  }
}
