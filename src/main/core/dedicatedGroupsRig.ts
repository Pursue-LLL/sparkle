// [INPUT] 全局类型 DedicatedGroupSwitches
// [OUTPUT] ALL_GROUPS_ON · ALL_GROUPS_OFF · GATE_OPEN · GATE_CLOSED
// [POS] 测试夹具：四个可开关专用组「全开 / 全关」两组固定开关，以及始终放行 / 始终拒绝的探测门，供各条流水线的单测显式传入。

import type { DedicatedGroupGate } from './dedicatedGroups'

/** 四个可开关专用组全部开启（Sparkle 全量分组）。 */
export const ALL_GROUPS_ON: DedicatedGroupSwitches = {
  grok: true,
  gemini: true,
  mail: true,
  agy: true
}

/** 四个可开关专用组全部关闭。 */
export const ALL_GROUPS_OFF: DedicatedGroupSwitches = {
  grok: false,
  gemini: false,
  mail: false,
  agy: false
}

/** 始终放行 / 始终拒绝的探测门：循环每个 tick 都会向它询问该组是否开启。 */
export const GATE_OPEN: DedicatedGroupGate = async () => true
export const GATE_CLOSED: DedicatedGroupGate = async () => false
