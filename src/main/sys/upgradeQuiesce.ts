// [INPUT] ~/.sparkle/upgrade-in-progress（升级安装器写入并在整个事务期间持续刷新的静默标记）
// [OUTPUT] UPGRADE_QUIESCE_MARKER_TTL_MS · upgradeQuiesceMarkerPath · isUpgradeQuiesceActive
// [POS] 升级安装器退出本进程时没有人去点退出确认框：SIGTERM 与 AppleEvent quit 一样走 before-quit，
//       确认框一直挂着，安装器只能干等到超时再 SIGKILL（白等 10~21 秒，还跳过退出清理）。
//       见到新鲜标记就不弹确认框、走正常退出。文件名与 TTL 和 `scripts/lib/install-transaction.sh` 一致，由 upgradeQuiesce.test.ts 锁住。

import { statSync } from 'fs'
import { homedir } from 'os'
import path from 'path'

/** 与 shell 侧 `find -mmin -15` 同口径：超过该时长视为安装进程已崩溃，陈旧标记不能让确认框永久失效。 */
export const UPGRADE_QUIESCE_MARKER_TTL_MS = 15 * 60_000

export function upgradeQuiesceMarkerPath(homeDir: string): string {
  return path.join(homeDir, '.sparkle', 'upgrade-in-progress')
}

export function isUpgradeQuiesceActive(
  markerPath: string = upgradeQuiesceMarkerPath(homedir()),
  nowMs: number = Date.now()
): boolean {
  try {
    return nowMs - statSync(markerPath).mtimeMs < UPGRADE_QUIESCE_MARKER_TTL_MS
  } catch {
    return false
  }
}
