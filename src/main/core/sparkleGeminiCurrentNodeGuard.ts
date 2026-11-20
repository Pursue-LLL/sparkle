// [INPUT] groupActivityCore::connectionChainsIncludeGroup/nextGroupActivityAtMs/isGroupRecentlyActive (POS: 专用组活动判定) ·
//         cursorProxyGroup::GEMINI_DEDICATED_GROUP_NAME (POS: Sparkle 分组名常量与判定谓词) ·
//         dedicatedGroups::runWhenEnabled/DedicatedGroupGate (POS: 可开关专用组注册表与开关解析) ·
//         mihomoApi::mihomoGetConnections/mihomoGroupDetail/subscribeMihomoLogs (POS: mihomo 控制器访问层) ·
//         mihomoProxyDelayCore::isMihomoApiResourceNotFoundError (POS: 节点延迟探测判定) ·
//         sparkleGeminiGuardCore::HEAD_GUARD_TICK_MS/GEMINI_SESSION_GAP_MS/SESSION_START_CHECK_DELAY_MS/headVerdictMaxAgeMs/isGeminiActivityLog (POS: Gemini 队首守护的纯规则) ·
//         sparkleGeminiProbe::verifyNodeGeminiRegion (POS: Gemini 地区探测与缓存) ·
//         sparkleGeminiProviderSync::rebuildAndReloadGeminiProvider (POS: gemini专用 provider 与判定的对账) ·
//         utils/errorMessage::describeError (POS: 失败路径上的异常文本化) ·
//         utils/log::appendAppLog (POS: 应用日志与内核日志)
// [OUTPUT] startSparkleGeminiCurrentNodeGuardLoop
// [POS] `gemini专用` 队首守护：队首是每个新连接实际使用的节点，而 Google 的地区判定会随机翻转，30 分钟一轮的审计盖不住。
//       每 5 分钟复验一次队首（使用中判定不超过 3 分钟、闲置时不超过 25 分钟），新会话的第一条连接日志之后 15 秒提前复验一次；
//       一旦确认队首受限，就重建 provider 把它换下去，再验换上来的新队首。网络超时与探测失败从不当作受限。
//       定时与日志触发共用一道开关门控，`gemini专用` 关闭则不探测。

import { describeError } from '../utils/errorMessage'
import { appendAppLog } from '../utils/log'
import { GEMINI_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import { runWhenEnabled, type DedicatedGroupGate } from './dedicatedGroups'
import {
  connectionChainsIncludeGroup,
  isGroupRecentlyActive,
  nextGroupActivityAtMs
} from './groupActivityCore'
import { mihomoGetConnections, mihomoGroupDetail, subscribeMihomoLogs } from './mihomoApi'
import { isMihomoApiResourceNotFoundError } from './mihomoProxyDelayCore'
import {
  GEMINI_SESSION_GAP_MS,
  HEAD_GUARD_TICK_MS,
  headVerdictMaxAgeMs,
  isGeminiActivityLog,
  SESSION_START_CHECK_DELAY_MS
} from './sparkleGeminiGuardCore'
import { verifyNodeGeminiRegion } from './sparkleGeminiProbe'
import { rebuildAndReloadGeminiProvider } from './sparkleGeminiProviderSync'

/** 一次检查最多连验几个队首：换上来的新队首同样可能不合格，但不能让一次检查无休止地追下去。 */
const MAX_HEAD_CHECKS_PER_RUN = 3

let lastActivityAtMs = 0
let checkQueued = false
let guardTimer: NodeJS.Timeout | undefined
let sessionStartTimer: NodeJS.Timeout | undefined
/** 循环启动前不检查；启动时由编排层注入真实开关。 */
let isGuardEnabled: DedicatedGroupGate = async () => false

/** 新会话（距上一次活动已超过间隔）的第一条日志排一次提前复验；会话中的后续日志只刷新活动时间。 */
function noteGeminiLogActivity(log: ControllerLog): void {
  if (!isGeminiActivityLog(log.payload)) {
    return
  }
  const nowMs = Date.now()
  const startsSession = !isGroupRecentlyActive(lastActivityAtMs, nowMs, GEMINI_SESSION_GAP_MS)
  lastActivityAtMs = nowMs
  if (startsSession) {
    scheduleSessionStartCheck()
  }
}

function scheduleSessionStartCheck(): void {
  if (sessionStartTimer) {
    return
  }
  sessionStartTimer = setTimeout(() => {
    sessionStartTimer = undefined
    scheduleCheck()
  }, SESSION_START_CHECK_DELAY_MS)
  sessionStartTimer.unref()
}

/** 组当前的队首；没有选中节点、或选中的不是本组成员时为 undefined。 */
async function currentHead(): Promise<string | undefined> {
  const group = await mihomoGroupDetail(GEMINI_DEDICATED_GROUP_NAME)
  const head = group.now?.trim()
  return head && group.all.includes(head) ? head : undefined
}

/** 复验队首；确认受限就重建 provider，直到队首合格、换不掉或连验次数用完。 */
async function guardHead(maxAgeMs: number): Promise<void> {
  let evictedHead: string | undefined
  for (let round = 0; round < MAX_HEAD_CHECKS_PER_RUN; round++) {
    const head = await currentHead()
    if (!head || head === evictedHead) {
      return
    }
    const verdict = await verifyNodeGeminiRegion(head, { maxAgeMs })
    if (!verdict.definitive || verdict.eligible) {
      return
    }
    await rebuildAndReloadGeminiProvider()
    evictedHead = head
  }
}

async function checkGeminiHead(): Promise<void> {
  try {
    const connections = await mihomoGetConnections().catch(() => undefined)
    const nowMs = Date.now()
    const activeNow = connectionChainsIncludeGroup(connections, GEMINI_DEDICATED_GROUP_NAME)
    lastActivityAtMs = nextGroupActivityAtMs(lastActivityAtMs, activeNow, nowMs)
    const sessionActive = isGroupRecentlyActive(lastActivityAtMs, nowMs, GEMINI_SESSION_GAP_MS)
    await guardHead(headVerdictMaxAgeMs(sessionActive))
  } catch (error) {
    if (isMihomoApiResourceNotFoundError(error)) {
      return
    }
    await appendAppLog(`[SparkleGeminiGuard]: head check error=${describeError(error)}\n`)
  }
}

function scheduleCheck(): void {
  if (checkQueued) {
    return
  }
  checkQueued = true
  // 定时巡检与新会话提前复验共用这一入口，开关只需在此把关一次。
  void runWhenEnabled(isGuardEnabled, checkGeminiHead)
    .catch(() => undefined)
    .finally(() => {
      checkQueued = false
    })
}

/** 幂等：每 5 分钟复验一次队首，并盯着内核日志等新会话；`gemini专用` 关闭时两条路径都不探测。 */
export function startSparkleGeminiCurrentNodeGuardLoop(isEnabled: DedicatedGroupGate): void {
  if (guardTimer) {
    return
  }
  isGuardEnabled = isEnabled
  subscribeMihomoLogs(noteGeminiLogActivity)
  guardTimer = setInterval(scheduleCheck, HEAD_GUARD_TICK_MS)
  guardTimer.unref()
}
