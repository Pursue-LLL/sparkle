/** Pre-install hygiene — journal size cap + disk pressure gate before upgrade. */

export const PRE_INSTALL_JOURNAL_TRUNCATE_BYTES = 8_388_608
export const PRE_INSTALL_JOURNAL_TRUNCATE_THRESHOLD_BYTES = 16_777_216
export const PRE_INSTALL_DISK_BLOCK_USED_PCT = 95

export interface PreInstallHygieneInput {
  journalBytes: number
  dataVolumeUsedPct: number
}

export interface PreInstallHygienePlan {
  truncateJournal: boolean
  blockUpgrade: boolean
  reason: string
}

export function evaluatePreInstallHygiene(input: PreInstallHygieneInput): PreInstallHygienePlan {
  if (input.dataVolumeUsedPct >= PRE_INSTALL_DISK_BLOCK_USED_PCT) {
    return {
      truncateJournal: input.journalBytes > PRE_INSTALL_JOURNAL_TRUNCATE_THRESHOLD_BYTES,
      blockUpgrade: true,
      reason: `data_volume_used_pct=${input.dataVolumeUsedPct}>=${PRE_INSTALL_DISK_BLOCK_USED_PCT}`,
    }
  }

  if (input.journalBytes > PRE_INSTALL_JOURNAL_TRUNCATE_THRESHOLD_BYTES) {
    return {
      truncateJournal: true,
      blockUpgrade: false,
      reason: `journal_bytes=${input.journalBytes}>${PRE_INSTALL_JOURNAL_TRUNCATE_THRESHOLD_BYTES}`,
    }
  }

  return {
    truncateJournal: false,
    blockUpgrade: false,
    reason: 'ok',
  }
}

export function formatPreInstallHygieneLog(input: PreInstallHygieneInput, plan: PreInstallHygienePlan): string {
  const journalMb = (input.journalBytes / (1024 * 1024)).toFixed(1)
  return (
    `[PreInstallHygiene]: journal_mb=${journalMb} disk_used_pct=${input.dataVolumeUsedPct} ` +
    `truncate=${plan.truncateJournal ? 1 : 0} block=${plan.blockUpgrade ? 1 : 0} reason=${plan.reason}`
  )
}
