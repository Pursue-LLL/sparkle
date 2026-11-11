// [INPUT] AgyProbeSample.rttMs（来源：主进程 sparkleAgyProbe 的 agyProbeSnapshot，经 IPC 传到代理页）
// [OUTPUT] formatAgyProbeDelay · agyProbeTone
// [POS] 代理页 agy 组延迟的唯一格式口径：把 1-token 实测毫秒转成秒级文案与色调，
//       与 mihomo 的 gstatic 网络延迟彻底分开，避免用网络 RTT 冒充 agy 响应时间。

export type AgyProbeTone = 'default' | 'success' | 'warning' | 'danger'

/** agy 实测是「真实请求到出字」的耗时，3~50s 都出现过；10s 内正常、25s 以上明显偏慢。 */
export function formatAgyProbeDelay(rttMs: number): string {
  if (!Number.isFinite(rttMs) || rttMs <= 0) {
    return '未测'
  }
  const seconds = rttMs / 1000
  return seconds < 9.95 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`
}

export function agyProbeTone(rttMs: number): AgyProbeTone {
  if (!Number.isFinite(rttMs) || rttMs <= 0) {
    return 'default'
  }
  if (rttMs < 10_000) {
    return 'success'
  }
  if (rttMs < 25_000) {
    return 'warning'
  }
  return 'danger'
}
