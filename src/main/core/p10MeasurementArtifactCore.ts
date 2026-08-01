// [INPUT] artifact metadata + percentile payloads
// [OUTPUT] validateP10MeasurementArtifact · paired TUN tax helpers
// [POS] P10-6 SSOT — real measurement artifacts only; synthetic constants cannot PASS deploy gate.

export interface P10MeasurementArtifactMeta {
  schemaVersion: 'p10-measurement-artifact.v1'
  capturedAtIso: string
  source: string
  sha256: string
  endpoint?: string
  node?: string
}

export interface P10MeasurementArtifact<TPayload> {
  meta: P10MeasurementArtifactMeta
  payload: TPayload
}

export interface P10ArtifactValidationResult {
  ok: boolean
  detail: string
}

export function validateP10MeasurementArtifact<TPayload>(
  artifact: P10MeasurementArtifact<TPayload> | undefined,
  label: string,
): P10ArtifactValidationResult {
  if (!artifact) {
    return {
      ok: false,
      detail: `${label}: missing artifact — synthetic fixture cannot PASS (§M.0.15.13)`,
    }
  }
  const { meta } = artifact
  if (meta.schemaVersion !== 'p10-measurement-artifact.v1') {
    return { ok: false, detail: `${label}: unsupported schema ${String(meta.schemaVersion)}` }
  }
  if (!meta.capturedAtIso.trim() || !meta.source.trim()) {
    return { ok: false, detail: `${label}: artifact missing capturedAtIso or source` }
  }
  if (!/^[a-f0-9]{64}$/.test(meta.sha256)) {
    return { ok: false, detail: `${label}: artifact sha256 invalid` }
  }
  return { ok: true, detail: `${label}: artifact ${meta.sha256.slice(0, 12)}… @ ${meta.capturedAtIso}` }
}

export function computePairedTunTaxMs(tunMs: number, mixedMs: number): number {
  return tunMs - mixedMs
}
