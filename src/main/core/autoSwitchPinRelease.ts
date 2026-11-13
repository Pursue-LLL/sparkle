// [INPUT] autoSwitchPinReleaseEngine::createAutoSwitchPinReleaser (POS: 固定释放编排层) ·
//         mihomoApi::mihomoGroups/mihomoUnfixedProxy/mihomoGroupDelay (POS: mihomo 控制器访问层) ·
//         utils/log::appendAppLog (POS: 应用程序运行日志追加写入) ·
//         autoSwitchPinReleaseCore::AutoSwitchGroupSnapshot (POS: 自动组固定释放决策)
// [OUTPUT] releaseAutoSwitchPins: 按生命周期时点释放自动切换组的固定
// [POS] 自动切换组固定释放接线层。内核启动 / 整配置重载后释放缓存恢复的固定（all）；订阅刷新后只释放孤儿固定（orphans）。
//       节点失活的处理由内核原生保证：URLTest 仅在固定节点存活时才遵循 fixed，Fallback 会清除失活的固定。

import { appendAppLog } from '../utils/log'
import type { AutoSwitchGroupSnapshot } from './autoSwitchPinReleaseCore'
import { createAutoSwitchPinReleaser } from './autoSwitchPinReleaseEngine'
import { mihomoGroupDelay, mihomoGroups, mihomoUnfixedProxy } from './mihomoApi'

function toSnapshot(group: ControllerMixedGroup): AutoSwitchGroupSnapshot {
  return {
    name: group.name,
    type: group.type,
    fixed: group.fixed,
    all: group.all.map((member) => member.name)
  }
}

export const releaseAutoSwitchPins = createAutoSwitchPinReleaser({
  loadGroups: async () => (await mihomoGroups()).map(toSnapshot),
  unpin: mihomoUnfixedProxy,
  probeGroup: (group) => mihomoGroupDelay(group),
  log: appendAppLog
})
