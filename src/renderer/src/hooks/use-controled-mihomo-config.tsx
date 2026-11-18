import React, { createContext, useContext, ReactNode } from 'react'
import useSWR from 'swr'
import { previewConfigPatch } from '@renderer/utils/config-patch-preview'
import { getControledMihomoConfig, patchControledMihomoConfig as patch } from '@renderer/utils/ipc'
import { notify } from '@renderer/utils/notification'

interface ControledMihomoConfigContextType {
  controledMihomoConfig: Partial<MihomoConfig> | undefined
  mutateControledMihomoConfig: () => void
  /** 返回补丁是否已被主进程接受：false 表示失败（已提示并回滚界面），调用方不应接着做依赖它的动作（如重启内核）。 */
  patchControledMihomoConfig: (value: Partial<MihomoConfig>) => Promise<boolean>
}

const ControledMihomoConfigContext = createContext<ControledMihomoConfigContextType | undefined>(
  undefined
)

export const ControledMihomoConfigProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { data: controledMihomoConfig, mutate: mutateControledMihomoConfig } = useSWR(
    'getControledMihomoConfig',
    () => getControledMihomoConfig()
  )

  const patchControledMihomoConfig = async (value: Partial<MihomoConfig>): Promise<boolean> => {
    try {
      // 先把预览结果写进界面缓存让开关立刻翻转；主进程处理完后 SWR 会重新读取真实配置（补丁重叠时由最后结束的
      // 那个触发），失败时先回滚到已提交的值。populateCache 关掉：补丁没有返回新配置，不能拿返回值覆盖缓存。
      await mutateControledMihomoConfig(
        patch(value).then(() => undefined),
        {
          optimisticData: (committed, displayed) =>
            previewConfigPatch(displayed ?? committed, value),
          populateCache: false
        }
      )
      return true
    } catch (e) {
      notify(e, { variant: 'danger' })
      return false
    }
  }

  React.useEffect(() => {
    window.electron.ipcRenderer.on('controledMihomoConfigUpdated', () => {
      mutateControledMihomoConfig()
    })
    return (): void => {
      window.electron.ipcRenderer.removeAllListeners('controledMihomoConfigUpdated')
    }
  }, [])

  return (
    <ControledMihomoConfigContext.Provider
      value={{ controledMihomoConfig, mutateControledMihomoConfig, patchControledMihomoConfig }}
    >
      {children}
    </ControledMihomoConfigContext.Provider>
  )
}

export const useControledMihomoConfig = (): ControledMihomoConfigContextType => {
  const context = useContext(ControledMihomoConfigContext)
  if (context === undefined) {
    throw new Error('useControledMihomoConfig must be used within a ControledMihomoConfigProvider')
  }
  return context
}
