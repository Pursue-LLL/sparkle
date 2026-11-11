// [INPUT] renderer ipc::getSparkleAgyProbeSnapshot（POS: 主进程内存快照）
// [OUTPUT] useAgyProbeSnapshot
// [POS] 代理页 agy 组的数据源：30s 轮询主进程内存快照，不触发任何网络/磁盘探测。

import { useEffect, useState } from 'react'
import { getSparkleAgyProbeSnapshot } from '@renderer/utils/ipc'

const REFRESH_INTERVAL_MS = 30_000

export function useAgyProbeSnapshot(): AgyProbeSnapshot {
  const [snapshot, setSnapshot] = useState<AgyProbeSnapshot>({})

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const next = await getSparkleAgyProbeSnapshot()
        if (!cancelled) {
          setSnapshot(next)
        }
      } catch {
        // 展示层：读取失败保留上一次快照，不打断代理页其它功能。
      }
    }
    void load()
    const timer = setInterval(() => void load(), REFRESH_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return snapshot
}
