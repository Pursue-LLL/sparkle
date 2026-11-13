// [INPUT] config::addProfileItem/getProfileConfig (POS: 应用 / 内核 / 订阅 / 覆写配置读写) ·
//         profileUpdaterCore::createDueProfileUpdateRunner (POS: 订阅到期判定与更新执行) ·
//         utils/log::appendAppLog (POS: 应用日志与内核日志)
// [OUTPUT] runDueProfileUpdates · initProfileUpdater: 订阅到期检查与 GUI 心跳
// [POS] 订阅自动更新的运行时接线：GUI 每 5 分钟心跳（启动后 60 秒首次）与 LaunchAgent 共用同一个到期检查；每次 init 换新一代，旧一代在途检查结束后不再续排。

import { addProfileItem, getProfileConfig } from '../config'
import { appendAppLog } from '../utils/log'
import { createDueProfileUpdateRunner } from './profileUpdaterCore'

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000
/** 启动后先让核心与探测预热走完：订阅更新会热重载 provider，过早触发会清掉刚测出的延迟记录。 */
const STARTUP_DELAY_MS = 60 * 1000

/**
 * GUI 心跳与 LaunchAgent（`--sparkle-profile-update-due`）共用的入口。
 * 读缓存而不强制重读磁盘：profile.yaml 只由本进程写入，缓存即最新；
 * 每 5 分钟强制重读会撞上非原子写入的半截文件，并触发「读到空文件 → 从备份恢复并写盘」。
 */
export const runDueProfileUpdates = createDueProfileUpdateRunner({
  listItems: async () => (await getProfileConfig()).items,
  update: addProfileItem,
  log: appendAppLog
})

let heartbeat: NodeJS.Timeout | undefined
/** 每次 init 换新一代：上一代正在执行的检查结束后不再续排，核心重启不会叠出多条心跳链。 */
let generation = 0

function scheduleNextCheck(delayMs: number, owner: number): void {
  heartbeat = setTimeout(async () => {
    try {
      await runDueProfileUpdates()
    } catch (error) {
      await appendAppLog(
        `[ProfileUpdater]: heartbeat failed: ${error instanceof Error ? error.message : String(error)}\n`
      )
    }
    if (owner === generation) {
      scheduleNextCheck(HEARTBEAT_INTERVAL_MS, owner)
    }
  }, delayMs)
}

export function initProfileUpdater(): void {
  clearTimeout(heartbeat)
  generation += 1
  scheduleNextCheck(STARTUP_DELAY_MS, generation)
}
