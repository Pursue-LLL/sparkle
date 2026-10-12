import { addProfileItem, getProfileConfig } from '../config'
import { appendAppLog } from '../utils/log'
import { createDueProfileUpdateRunner } from './profileUpdaterCore'

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000
/** 启动后先让核心与探测预热走完：订阅更新会热重载 provider，过早触发会清掉刚测出的延迟记录。 */
const STARTUP_DELAY_MS = 60 * 1000

/** GUI 心跳与 LaunchAgent（`--sparkle-profile-update-due`）共用的入口。 */
export const runDueProfileUpdates = createDueProfileUpdateRunner({
  listItems: async () => (await getProfileConfig(true)).items,
  update: addProfileItem,
  log: appendAppLog
})

let heartbeat: NodeJS.Timeout | undefined

function scheduleNextCheck(delayMs: number): void {
  heartbeat = setTimeout(async () => {
    try {
      await runDueProfileUpdates()
    } catch (error) {
      await appendAppLog(
        `[ProfileUpdater]: heartbeat failed: ${error instanceof Error ? error.message : String(error)}\n`
      )
    }
    scheduleNextCheck(HEARTBEAT_INTERVAL_MS)
  }, delayMs)
}

export function initProfileUpdater(): void {
  if (heartbeat) {
    clearTimeout(heartbeat)
  }
  scheduleNextCheck(STARTUP_DELAY_MS)
}
