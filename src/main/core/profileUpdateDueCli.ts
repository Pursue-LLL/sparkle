import { quitWithoutCore } from './manager'
import { runDueProfileUpdates } from './profileUpdater'
import { dedicatedGroupGate } from './dedicatedGroupSwitch'
import { runWhenEnabled } from './dedicatedGroups'
import { AGY_HEADLESS_DEADLINE_MS } from './sparkleAgyProbeCore'
import { runSparkleAgyDueDuty } from './sparkleAgyProbe'
import { appendAppLog } from '../utils/log'
import { describeError } from '../utils/errorMessage'
import { markGracefulGuiQuit } from '../sys/guiGracefulQuitMarker'

const CORE_INIT_RACE_MS = 8_000
/** agy 巡检有自己的截止时间；万一某个环节卡住，这个硬性兜底保证一次性进程不会拖过下一次调度。 */
const AGY_DUTY_HARD_STOP_GRACE_MS = 15_000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * 没有常驻 GUI 时 agy 出口的维护靠这里：订阅刷新之外顺带做一次到期巡检（读生产证据，复测到期才发探测）。
 * 截止时间从本进程启动算起，保证在下一次被唤起之前退出；任何失败只记日志，不影响订阅刷新与退出。
 */
async function runAgyDuty(startedAtMs: number): Promise<void> {
  const deadlineAtMs = startedAtMs + AGY_HEADLESS_DEADLINE_MS
  let hardStop: NodeJS.Timeout | undefined
  const expired = new Promise<'expired'>((resolve) => {
    hardStop = setTimeout(
      () => resolve('expired'),
      Math.max(deadlineAtMs - Date.now(), 0) + AGY_DUTY_HARD_STOP_GRACE_MS
    )
  })
  try {
    const finished = runWhenEnabled(dedicatedGroupGate('agy'), () =>
      runSparkleAgyDueDuty({ deadlineAtMs })
    ).then(() => 'finished' as const)
    if ((await Promise.race([finished, expired])) === 'expired') {
      await appendAppLog(
        '[ProfileUpdaterCli]: WARN agy duty overran its deadline, exiting anyway\n'
      )
    }
  } catch (error) {
    await appendAppLog(`[ProfileUpdaterCli]: agy duty failed: ${describeError(error)}\n`)
  } finally {
    clearTimeout(hardStop)
  }
}

/** Headless one-shot: refresh due remote subscriptions, maintain the agy exit, then exit (LaunchAgent). */
export async function runProfileUpdateDueCli(): Promise<number> {
  const startedAtMs = Date.now()
  await appendAppLog('[ProfileUpdaterCli]: bootstrap start\n')

  let updatedCount: number
  try {
    const { runCoreReadinessPipeline } = await import('./coreReadinessGate')
    const { startPromise } = await runCoreReadinessPipeline('profile-update-cli')
    await Promise.race([startPromise, delay(CORE_INIT_RACE_MS)])

    updatedCount = await runDueProfileUpdates()
    await appendAppLog(`[ProfileUpdaterCli]: complete updated_count=${updatedCount}\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await appendAppLog(`[ProfileUpdaterCli]: failed: ${message}\n`)
    throw error
  } finally {
    await runAgyDuty(startedAtMs)
    markGracefulGuiQuit()
    await quitWithoutCore()
  }

  return updatedCount
}
