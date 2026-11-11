// [INPUT] mihomoApi::subscribeMihomoAlerts/mihomoGroups/mihomoChangeProxy/mihomoUnfixedProxy (POS: mihomo 控制器访问层) ·
//         groupFailoverEngine (POS: 故障转移编排) · utils/log::appendAppLog (POS: 应用程序运行日志追加写入)
// [OUTPUT] startGroupFailover: 订阅内核告警并启动故障转移
// [POS] 故障转移引擎的运行时接线：把真实的控制器、日志与定时器接到 groupFailoverEngine。
//       作用范围由 autoSwitchPolicy 决定；内核启停重连后告警流自动恢复，因此每次应用启动只需调用一次。

import { appendAppLog } from '../utils/log'
import type { FailoverGroupSnapshot } from './groupFailoverCore'
import { createGroupFailoverEngine } from './groupFailoverEngine'
import {
  mihomoChangeProxy,
  mihomoGroups,
  mihomoUnfixedProxy,
  subscribeMihomoAlerts
} from './mihomoApi'

function toSnapshot(group: ControllerMixedGroup): FailoverGroupSnapshot {
  return {
    name: group.name,
    type: group.type,
    now: group.now,
    fixed: group.fixed,
    testUrl: group.testUrl,
    members: group.all.map((member) => ({
      name: member.name,
      isGroup: 'all' in member,
      alive: member.alive,
      history: member.history,
      extra: member.extra
    }))
  }
}

const engine = createGroupFailoverEngine({
  subscribeAlerts: subscribeMihomoAlerts,
  loadGroup: async (name) => {
    const group = (await mihomoGroups()).find((item) => item.name === name)
    return group && toSnapshot(group)
  },
  pinNode: (group, node) => mihomoChangeProxy(group, node, { source: 'auto' }),
  unpinNode: async (group) => {
    await mihomoUnfixedProxy(group)
  },
  log: appendAppLog,
  now: Date.now,
  schedule: (task, delayMs) => {
    const timer = setTimeout(task, delayMs)
    timer.unref()
    return () => clearTimeout(timer)
  }
})

export const startGroupFailover = engine.start
