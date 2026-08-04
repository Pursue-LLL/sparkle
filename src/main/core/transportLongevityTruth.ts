// [INPUT] transportLongevityTruthCore
// [OUTPUT] writeTransportLongevityTruthSnapshot
// [POS] R-34a atom writer — ~/.sparkle/transport-longevity-truth.json

import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { homedir } from 'os'
import { join } from 'path'
import {
  TRANSPORT_LONGEVITY_TRUTH_FILENAME,
  TRANSPORT_LONGEVITY_TRUTH_SCHEMA_VERSION,
  type TransportLongevityTruthSnapshot,
} from './transportLongevityTruthCore'

export function transportLongevityTruthPath(): string {
  return join(homedir(), '.sparkle', TRANSPORT_LONGEVITY_TRUTH_FILENAME)
}

export async function writeTransportLongevityTruthSnapshot(
  snapshot: TransportLongevityTruthSnapshot,
): Promise<void> {
  const targetPath = transportLongevityTruthPath()
  const dir = dirname(targetPath)
  await mkdir(dir, { recursive: true })
  const tmpPath = `${targetPath}.tmp`
  await writeFile(tmpPath, `${JSON.stringify(snapshot)}\n`, 'utf8')
  await rename(tmpPath, targetPath)
}

export async function readTransportLongevityTruthSnapshot(): Promise<
  TransportLongevityTruthSnapshot | undefined
> {
  try {
    const text = await readFile(transportLongevityTruthPath(), 'utf8')
    const row = JSON.parse(text) as Partial<TransportLongevityTruthSnapshot>
    if (typeof row.updatedAtMs !== 'number' || row.updatedAtMs <= 0) {
      return undefined
    }
    return row as TransportLongevityTruthSnapshot
  } catch {
    return undefined
  }
}

export async function resetTransportLongevityHy2ParentChainBirth(
  activeHy2Leaf: string,
  nowMs: number = Date.now(),
): Promise<void> {
  const previous = await readTransportLongevityTruthSnapshot()
  await writeTransportLongevityTruthSnapshot({
    schemaVersion: previous?.schemaVersion ?? TRANSPORT_LONGEVITY_TRUTH_SCHEMA_VERSION,
    updatedAtMs: nowMs,
    cursorConnectionCount: previous?.cursorConnectionCount ?? 0,
    httpParentChainAgeMs: 0,
    outboundHy2SessionAgeMs: 0,
    maxByteStallMs: previous?.maxByteStallMs ?? 0,
    frozenQuicCursorCount: previous?.frozenQuicCursorCount ?? 0,
    activeHy2Leaf,
    hy2ParentChainBirthMs: nowMs,
  })
}
