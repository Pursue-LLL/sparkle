import { BADGE_MAX_JITTER_MS, MIN_RANK_SAMPLES } from './nodeQualityScore'

export type CursorStabilityLevel = 'excellent' | 'good' | 'watch' | 'risk' | 'unknown'

export interface CursorStabilityInput {
  samples: number
  successRate: number
  jitter: number
  slow500Rate: number
  eligibleForBadge: boolean
  transportFailures: number
  minSamples?: number
}

export interface CursorStabilityView {
  level: CursorStabilityLevel
  label: string
  hint: string
}

const LEVEL_LABELS: Record<CursorStabilityLevel, string> = {
  excellent: '极佳',
  good: '稳定',
  watch: '观察',
  risk: '风险',
  unknown: '待观测'
}

export function deriveCursorStability(input: CursorStabilityInput): CursorStabilityView {
  const minSamples = input.minSamples ?? MIN_RANK_SAMPLES

  if (input.samples < minSamples) {
    return {
      level: 'unknown',
      label: LEVEL_LABELS.unknown,
      hint: `样本不足（需 ≥${minSamples} 次 api2 探测）`
    }
  }

  if (input.transportFailures >= 2 || input.successRate < 0.9) {
    const parts: string[] = []
    if (input.transportFailures > 0) {
      parts.push(`Agent 断连 ${input.transportFailures} 次`)
    }
    if (input.successRate < 0.9) {
      parts.push(`api2 成功率 ${(input.successRate * 100).toFixed(1)}%`)
    }
    return {
      level: 'risk',
      label: LEVEL_LABELS.risk,
      hint: parts.join(' · ')
    }
  }

  if (input.eligibleForBadge && input.transportFailures === 0) {
    return {
      level: 'excellent',
      label: LEVEL_LABELS.excellent,
      hint: '短探测 + 会话观测均达标，适合 Cursor Agent'
    }
  }

  if (input.eligibleForBadge && input.transportFailures <= 1) {
    return {
      level: 'good',
      label: LEVEL_LABELS.good,
      hint: '探测指标达标，Agent 断连较少'
    }
  }

  const watchParts: string[] = []
  if (!input.eligibleForBadge) {
    if (input.jitter > BADGE_MAX_JITTER_MS) {
      watchParts.push(`jitter ${Math.round(input.jitter)}ms`)
    }
    if (input.slow500Rate > 0.15) {
      watchParts.push(`>500ms ${(input.slow500Rate * 100).toFixed(1)}%`)
    }
    if (input.successRate < 0.95) {
      watchParts.push(`成功率 ${(input.successRate * 100).toFixed(1)}%`)
    }
  }
  if (input.transportFailures === 1) {
    watchParts.push('Agent 断连 1 次')
  }

  return {
    level: 'watch',
    label: LEVEL_LABELS.watch,
    hint: watchParts.length > 0 ? watchParts.join(' · ') : '指标边缘，建议对比其他节点'
  }
}

export function cursorStabilityChipColor(
  level: CursorStabilityLevel
): 'success' | 'warning' | 'danger' | 'default' {
  switch (level) {
    case 'excellent':
    case 'good':
      return 'success'
    case 'watch':
      return 'warning'
    case 'risk':
      return 'danger'
    default:
      return 'default'
  }
}
