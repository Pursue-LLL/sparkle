// [INPUT] ../core/switchTimingCore（POS: 切换耗时日志逻辑） · ./bestEffortLog（POS: 永不 reject 的日志） · ./log（POS: 应用日志落盘）
// [OUTPUT] timeSwitchOperation
// [POS] 切换类操作耗时日志的生产装配：真实单调时钟、`os.loadavg()` 1 分钟负载、`os.freemem()` 空闲内存、应用日志。
import os from 'os'
import { createSwitchTimer } from '../core/switchTimingCore'
import { bestEffortLog } from './bestEffortLog'
import { appendAppLog } from './log'

const BYTES_PER_MB = 1024 * 1024

export const timeSwitchOperation = createSwitchTimer({
  now: () => performance.now(),
  load1: () => os.loadavg()[0],
  freeMemMb: () => os.freemem() / BYTES_PER_MB,
  log: bestEffortLog(appendAppLog)
})
