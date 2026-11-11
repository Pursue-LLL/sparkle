// [INPUT] renderer ipc::getSparkleGrokProbeSnapshot（POS: 主进程 grok 探针内存快照）
// [OUTPUT] useGrokProbeSnapshot
// [POS] 代理页 `grok 专用` 的数据源：30s 轮询主进程快照，不触发任何网络/磁盘探测。

import { useEffect, useState } from 'react'
import { getSparkleGrokProbeSnapshot } from '@renderer/utils/ipc'

const REFRESH_INTERVAL_MS = 30_000

export function useGrokProbeSnapshot(): GrokProbeSnapshot {
  const [snapshot, setSnapshot] = useState<GrokProbeSnapshot>({})

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const next = await getSparkleGrokProbeSnapshot()
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
