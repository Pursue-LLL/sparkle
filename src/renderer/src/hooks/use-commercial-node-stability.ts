import { useEffect, useState } from 'react'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { getCommercialNodeStabilityMarkers } from '@renderer/utils/ipc'

export function useCommercialNodeStabilityMarkers(): CommercialNodeStabilitySnapshot | null {
  const { appConfig } = useAppConfig()
  const reportIntervalSec = appConfig?.commercialNodeBenchmarkReportIntervalSec ?? 3600
  const pollIntervalSec = Math.min(reportIntervalSec, 60)
  const [snapshot, setSnapshot] = useState<CommercialNodeStabilitySnapshot | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const data = await getCommercialNodeStabilityMarkers()
        if (!cancelled) {
          setSnapshot(data.enabled ? data : null)
        }
      } catch {
        // ignore — probe may still be warming up
      }
    }

    void load()
    const timer = setInterval(() => {
      void load()
    }, pollIntervalSec * 1000)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [pollIntervalSec])

  return snapshot
}

export function formatStabilityMarkerTooltip(entry: CommercialNodeStabilityEntry): string {
  const kindLabel = entry.kind === 'vps' ? '自建' : '商业'
  const rstPart =
    entry.transportFailures > 0 ? ` · Agent断连 ${entry.transportFailures}` : ''
  const sessionPart =
    entry.sessionScoreSource === '2h'
      ? ` · session ${entry.sessionScore >= 0 ? '+' : ''}${entry.sessionScore.toFixed(1)} (2h)`
      : entry.sessionScore !== 0
        ? ` · session ${entry.sessionScore >= 0 ? '+' : ''}${entry.sessionScore.toFixed(1)} (24h)`
        : ''
  return `${kindLabel} Cursor ${entry.cursorStabilityLabel} · combined ${entry.combinedScore.toFixed(1)} · jitter ${Math.round(entry.jitter)}ms · 成功率 ${(entry.successRate * 100).toFixed(1)}%${rstPart}${sessionPart}`
}
