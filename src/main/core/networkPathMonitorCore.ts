// [INPUT] os.networkInterfaces snapshot
// [OUTPUT] buildNetworkPathFingerprint · detectNetworkPathChange
// [POS] P25b — Mac network path change SSOT for network-stability-events.jsonl

import type { NetworkInterfaceInfo } from 'os'

export interface NetworkPathInterfaceRow {
  name: string
  family: string
  address: string
  internal: boolean
}

export interface NetworkPathChangeResult {
  changed: boolean
  beforeFingerprint: string
  afterFingerprint: string
  beforeSummary: string
  afterSummary: string
}

function normalizeInterfaces(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
): NetworkPathInterfaceRow[] {
  const rows: NetworkPathInterfaceRow[] = []
  for (const [name, entries] of Object.entries(interfaces)) {
    if (!entries) {
      continue
    }
    for (const entry of entries) {
      if (entry.internal) {
        continue
      }
      rows.push({
        name,
        family: entry.family,
        address: entry.address,
        internal: entry.internal,
      })
    }
  }
  rows.sort((a, b) => {
    const nameCmp = a.name.localeCompare(b.name)
    if (nameCmp !== 0) {
      return nameCmp
    }
    const familyCmp = a.family.localeCompare(b.family)
    if (familyCmp !== 0) {
      return familyCmp
    }
    return a.address.localeCompare(b.address)
  })
  return rows
}

export function summarizeNetworkPath(rows: readonly NetworkPathInterfaceRow[]): string {
  if (rows.length === 0) {
    return 'none'
  }
  return rows.map((row) => `${row.name}:${row.family}=${row.address}`).join('|')
}

export function buildNetworkPathFingerprint(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
): string {
  const rows = normalizeInterfaces(interfaces)
  return summarizeNetworkPath(rows)
}

export function detectNetworkPathChange(
  before: NodeJS.Dict<NetworkInterfaceInfo[]>,
  after: NodeJS.Dict<NetworkInterfaceInfo[]>,
): NetworkPathChangeResult {
  const beforeRows = normalizeInterfaces(before)
  const afterRows = normalizeInterfaces(after)
  const beforeFingerprint = summarizeNetworkPath(beforeRows)
  const afterFingerprint = summarizeNetworkPath(afterRows)
  return {
    changed: beforeFingerprint !== afterFingerprint,
    beforeFingerprint,
    afterFingerprint,
    beforeSummary: beforeFingerprint,
    afterSummary: afterFingerprint,
  }
}
