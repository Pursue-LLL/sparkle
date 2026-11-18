// [INPUT] @renderer/hooks/use-app-config（POS: 应用配置读写） · @renderer/hooks/use-latest（POS: 最新值 ref） ·
//         @sparkle-core/dedicatedGroups（POS: 可开关专用组注册表）
// [OUTPUT] useDedicatedGroupSwitches: 专用分组开关状态与切换动作
// [POS] 代理页专用分组开关：已保存的开关取自应用配置；点击后该组立即进入「切换中」——展示值先翻到目标值（界面不能等
//       数秒才有反应）、同组重复点击被忽略；主进程重载完成并刷新分组列表后才解除，保证分组列表不会先于内核变化。
//       失败提示由 `patchAppConfig` 统一弹出，解除后展示值回到已保存的值。

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  resolveDedicatedGroupSwitches,
  withPendingTargets,
  type DedicatedGroupId
} from '@sparkle-core/dedicatedGroups'
import { useAppConfig } from './use-app-config'
import { useLatest } from './use-latest'

type PendingTargets = ReadonlyMap<DedicatedGroupId, boolean>

interface DedicatedGroupSwitchState {
  /** 已保存的开关：占位标题与主进程同口径。 */
  switches: DedicatedGroupSwitches
  /** 界面展示的开关：切换中的组已是目标值。 */
  displayedSwitches: DedicatedGroupSwitches
  pendingIds: ReadonlySet<DedicatedGroupId>
  setEnabled: (id: DedicatedGroupId, enabled: boolean) => Promise<void>
}

const NO_PENDING: PendingTargets = new Map()

export function useDedicatedGroupSwitches(
  refreshGroups: () => Promise<unknown>
): DedicatedGroupSwitchState {
  const { appConfig, patchAppConfig } = useAppConfig()
  const [pendingTargets, setPendingTargets] = useState<PendingTargets>(NO_PENDING)
  // 用 ref 做防重入：连点两次时第二次拿到的 state 可能还是旧的。
  const pendingRef = useRef<PendingTargets>(NO_PENDING)
  const patchAppConfigRef = useLatest(patchAppConfig)
  const refreshGroupsRef = useLatest(refreshGroups)

  const switches = useMemo(
    () => resolveDedicatedGroupSwitches(appConfig?.dedicatedGroups),
    [appConfig?.dedicatedGroups]
  )
  const displayedSwitches = useMemo(
    () => withPendingTargets(switches, pendingTargets),
    [switches, pendingTargets]
  )
  const pendingIds = useMemo(() => new Set(pendingTargets.keys()), [pendingTargets])

  const updatePending = useCallback((id: DedicatedGroupId, target: boolean | undefined) => {
    const next = new Map(pendingRef.current)
    if (target === undefined) {
      next.delete(id)
    } else {
      next.set(id, target)
    }
    pendingRef.current = next
    setPendingTargets(next)
  }, [])

  const setEnabled = useCallback(
    async (id: DedicatedGroupId, enabled: boolean): Promise<void> => {
      if (pendingRef.current.has(id)) {
        return
      }
      updatePending(id, enabled)
      try {
        const applied = await patchAppConfigRef.current({ dedicatedGroups: { [id]: enabled } })
        if (applied) {
          await refreshGroupsRef.current()
        }
      } catch {
        // 分组刷新失败由 SWR 自行重试；保存失败已由 patchAppConfig 弹出提示。
      } finally {
        updatePending(id, undefined)
      }
    },
    [updatePending]
  )

  return { switches, displayedSwitches, pendingIds, setEnabled }
}
