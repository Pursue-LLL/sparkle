// [INPUT] sparkleAgyProbeDirs::writeState (POS: sparkleAgy 行为测试的临时文件系统) ·
//         sparkleAgyProbeWorld::MINUTE_MS/NOW/productionEvidence/world (POS: sparkleAgyProbe 行为测试的共享状态与夹具数据)
// [OUTPUT] seedTenuredPin · rejectPinInProduction · showPinWorkingInProduction
// [POS] 生产证据相关行为测试共用的场景铺设：在位已久的 pin、线上刚被拒、线上刚正常工作。仅供测试使用。

import { writeState } from './sparkleAgyProbeDirs'
import { MINUTE_MS, NOW, productionEvidence, world } from './sparkleAgyProbeWorld'

/** 已经在位 20 分钟的 pin，复测刚做过：只有生产证据能让这一拍动手。 */
export function seedTenuredPin(extra: Record<string, unknown> = {}): void {
  writeState({
    pin: { name: '台湾-1', sinceMs: NOW - 20 * MINUTE_MS },
    lastPinCheckMs: NOW,
    ...extra
  })
}

/** 在位 pin 上最近 3 条地区拒绝（刚好够判定被拒）。 */
export function rejectPinInProduction(): void {
  const now = Date.now()
  world.evidence = productionEvidence({
    rejections: [now - 3 * MINUTE_MS, now - 2 * MINUTE_MS, now - MINUTE_MS],
    lastActivityMs: now - MINUTE_MS
  })
}

/** agy 会话刚刚还在经过这个出口干活，且日志里没有任何拒绝。 */
export function showPinWorkingInProduction(): void {
  world.evidence = productionEvidence({ lastActivityMs: Date.now() - MINUTE_MS })
}
