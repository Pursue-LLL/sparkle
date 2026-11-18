// [INPUT] @renderer/utils/ipc::mihomoGroups (POS: 渲染进程 IPC 唯一入口)
// [OUTPUT] GroupsProvider: 代理组数据源 Provider · useGroups: 读取 `groups` 与返回 Promise 的 `mutate`
// [POS] 代理组数据源：SWR 拉取 `mihomoGroups`，主进程的 `groupsUpdated` / `core-started` 事件触发刷新；
//       `mutate` 返回刷新结果的 Promise，专用组开关据此等分组列表更新后再解除「切换中」。

import React, { createContext, useContext, ReactNode } from 'react'
import useSWR from 'swr'
import { mihomoGroups } from '@renderer/utils/ipc'

interface GroupsContextType {
  groups: ControllerMixedGroup[] | undefined
  mutate: () => Promise<unknown>
}

const GroupsContext = createContext<GroupsContextType | undefined>(undefined)

export const GroupsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { data: groups, mutate } = useSWR<ControllerMixedGroup[]>('mihomoGroups', mihomoGroups, {
    errorRetryInterval: 200,
    errorRetryCount: 10
  })

  React.useEffect(() => {
    window.electron.ipcRenderer.on('groupsUpdated', () => {
      mutate()
    })
    window.electron.ipcRenderer.on('core-started', () => {
      mutate()
    })
    return (): void => {
      window.electron.ipcRenderer.removeAllListeners('groupsUpdated')
      window.electron.ipcRenderer.removeAllListeners('core-started')
    }
  }, [])

  return <GroupsContext.Provider value={{ groups, mutate }}>{children}</GroupsContext.Provider>
}

export const useGroups = (): GroupsContextType => {
  const context = useContext(GroupsContext)
  if (context === undefined) {
    throw new Error('useGroups must be used within an GroupsProvider')
  }
  return context
}
