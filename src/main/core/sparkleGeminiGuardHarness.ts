// [INPUT] node:test 假时钟 ·
//         cursorProxyGroup::GEMINI_DEDICATED_GROUP_NAME (POS: Sparkle 分组名常量与判定谓词) ·
//         sparkleGeminiFilesHarness::readGeminiProviderOrder (POS: Gemini 行为测试夹具的临时目录与文件读写) ·
//         sparkleGeminiProbeRig::settle/world (POS: Gemini 探测行为测试夹具) ·
//         sparkleGeminiProviderCore::GEMINI_NODE_PROVIDER_ID (POS: gemini provider 与分组配置)
// [OUTPUT] MINUTE_MS · TICK_MS · advance · tick · headOn · inUse · logLine · restrictNodes · followProviderReloads
// [POS] 队首守护行为测试共用的小工具：推进假时钟、摆放组队首与活动连接、模拟内核日志与探测结论、
//       让测试里的 mihomo 状态跟着 provider 重载走。仅供测试使用。

import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { GEMINI_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import { readGeminiProviderOrder } from './sparkleGeminiFilesHarness'
import { settle, world } from './sparkleGeminiProbeRig'
import { GEMINI_NODE_PROVIDER_ID } from './sparkleGeminiProviderCore'

export const MINUTE_MS = 60 * 1000
/** 守护的巡检周期。 */
export const TICK_MS = 5 * MINUTE_MS

export async function advance(ms: number): Promise<void> {
  mock.timers.tick(ms)
  await settle()
}

export const tick = (): Promise<void> => advance(TICK_MS)

/** `gemini专用` 组此刻的队首与成员；成员缺省为只有队首自己。 */
export function headOn(now: string | undefined, all: string[] = now ? [now] : []): void {
  world.geminiGroup = { now, all }
}

/** mihomo 里有一条连接经过 `gemini专用`。 */
export function inUse(): void {
  world.connections = { connections: [{ chains: ['日本-1', GEMINI_DEDICATED_GROUP_NAME] }] }
}

/** 内核日志里出现一行；payload 缺失用 undefined 表示。 */
export function logLine(payload: string | undefined): void {
  assert.ok(world.logHandler, 'the guard has not subscribed to the core logs')
  world.logHandler({ type: 'info', payload } as ControllerLog)
}

/** 探测给出明确结论：列出的节点被判受限（ZZ），其余节点合格（TW）。 */
export function restrictNodes(...restricted: string[]): void {
  world.verdictOf = (node) =>
    restricted.includes(node)
      ? { definitive: true, eligible: false, countryCode: 'ZZ' }
      : { definitive: true, eligible: true, countryCode: 'TW' }
}

/** mihomo 重载 `gemini专用` provider 之后，组的成员与队首跟着新文件走。 */
export function followProviderReloads(): void {
  world.onProviderUpdate = (name) => {
    if (name !== GEMINI_NODE_PROVIDER_ID) {
      return
    }
    const order = readGeminiProviderOrder() ?? []
    world.geminiProvider = order
    world.geminiGroup = { now: order[0], all: order }
  }
}
