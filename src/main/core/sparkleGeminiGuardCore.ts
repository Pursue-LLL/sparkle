// [INPUT] cursorProxyGroup::GEMINI_DEDICATED_GROUP_NAME (POS: Sparkle 分组名常量与判定谓词)
// [OUTPUT] HEAD_GUARD_TICK_MS · GEMINI_SESSION_GAP_MS · SESSION_START_CHECK_DELAY_MS · ACTIVE_HEAD_MAX_AGE_MS · IDLE_HEAD_MAX_AGE_MS · headVerdictMaxAgeMs · isGeminiActivityLog
// [POS] `gemini专用` 队首守护的纯规则：巡检节奏、队首判定可以多旧（使用中 / 闲置两档）、哪些内核日志算 Gemini 正在被使用。

import { GEMINI_DEDICATED_GROUP_NAME } from './cursorProxyGroup'

/** 巡检周期：队首是每个新连接实际使用的节点，而 Google 的地区判定会随机翻转，30 分钟一轮的审计留的窗口太大。 */
export const HEAD_GUARD_TICK_MS = 5 * 60 * 1000

/** 距上一次 Gemini 活动超过这么久，下一次活动就算一次新会话的开始。 */
export const GEMINI_SESSION_GAP_MS = 10 * 60 * 1000

/** 新会话的第一条日志之后等这么久再复验队首：合并浏览器一次性发出的一批连接。 */
export const SESSION_START_CHECK_DELAY_MS = 15 * 1000

/** 使用中队首的判定最多可以多旧：小于巡检周期，使用期间每一轮都会复验。 */
export const ACTIVE_HEAD_MAX_AGE_MS = 3 * 60 * 1000

/** 闲置时队首的判定最多可以多旧：下一次会话开始之前就能发现翻转，代价是约每 25 分钟一次探测。 */
export const IDLE_HEAD_MAX_AGE_MS = 25 * 60 * 1000

export function headVerdictMaxAgeMs(sessionActive: boolean): number {
  return sessionActive ? ACTIVE_HEAD_MAX_AGE_MS : IDLE_HEAD_MAX_AGE_MS
}

/**
 * 内核每条经过本组的连接都会留一行 `using gemini专用[节点]`，拨号失败留 `dial gemini专用 (`。
 * 只认这两种：provider 生命周期日志（`Start initial provider gemini专用`）同样带组名，却不是使用。
 */
const ACTIVITY_MARKERS = [
  `using ${GEMINI_DEDICATED_GROUP_NAME}[`,
  `dial ${GEMINI_DEDICATED_GROUP_NAME} (`
] as const

export function isGeminiActivityLog(payload: string | undefined): boolean {
  return payload !== undefined && ACTIVITY_MARKERS.some((marker) => payload.includes(marker))
}
