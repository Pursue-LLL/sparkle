// [INPUT] @renderer/hooks/use-app-config（POS: 应用配置读写） · @renderer/hooks/use-latest（POS: 最新值 ref） ·
//         @sparkle-core/dedicatedGroups（POS: 可开关专用组注册表）
// [OUTPUT] useDedicatedGroupSwitches: 专用分组开关状态与切换动作
// [POS] 代理页专用分组开关：开关值取自应用配置；切换期间该组标记为「切换中」（防重复点击），
//       主进程重载完成并刷新分组列表后才解除，保证界面不会先于内核变化。失败提示由 `patchAppConfig` 统一弹出。

import { useCallback, useMemo, useRef, useState } from 'react'
import { resolveDedicatedGroupSwitches, type DedicatedGroupId } from '@sparkle-core/dedicatedGroups'
import { useAppConfig } from './use-app-config'
import { useLatest } from './use-latest'

interface DedicatedGroupSwitchState {
  switches: DedicatedGroupSwitches
  pendingIds: ReadonlySet<DedicatedGroupId>
  setEnabled: (id: DedicatedGroupId, enabled: boolean) => Promise<void>
}

const NO_PENDING: ReadonlySet<DedicatedGroupId> = new Set()

export function useDedicatedGroupSwitches(
  refreshGroups: () => Promise<unknown>
): DedicatedGroupSwitchState {
  const { appConfig, patchAppConfig } = useAppConfig()
  const [pendingIds, setPendingIds] = useState<ReadonlySet<DedicatedGroupId>>(NO_PENDING)
  // 用 ref 做防重入：连点两次时第二次拿到的 state 可能还是旧的。
  const pendingRef = useRef<ReadonlySet<DedicatedGroupId>>(NO_PENDING)
  const patchAppConfigRef = useLatest(patchAppConfig)
  const refreshGroupsRef = useLatest(refreshGroups)

  const switches = useMemo(
    () => resolveDedicatedGroupSwitches(appConfig?.dedicatedGroups),
    [appConfig?.dedicatedGroups]
  )

  const updatePending = useCallback((id: DedicatedGroupId, pending: boolean) => {
    const next = new Set(pendingRef.current)
    if (pending) {
      next.add(id)
    } else {
      next.delete(id)
    }
    pendingRef.current = next
    setPendingIds(next)
  }, [])

  const setEnabled = useCallback(
    async (id: DedicatedGroupId, enabled: boolean): Promise<void> => {
      if (pendingRef.current.has(id)) {
        return
      }
      updatePending(id, true)
      try {
        const applied = await patchAppConfigRef.current({ dedicatedGroups: { [id]: enabled } })
        if (applied) {
          await refreshGroupsRef.current()
        }
      } catch {
        // 分组刷新失败由 SWR 自行重试；保存失败已由 patchAppConfig 弹出提示。
      } finally {
        updatePending(id, false)
      }
    },
    [updatePending]
  )

  return { switches, pendingIds, setEnabled }
}
