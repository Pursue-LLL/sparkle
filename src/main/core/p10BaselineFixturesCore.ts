// [INPUT] none — frozen replay fixtures for Phase 10 baseline gate (P10-0)
// [OUTPUT] P10 baseline fixture constants + evaluateP10BaselineVerdict
// [POS] SSOT §M.0.15.11 P10-0 — reproducible verdicts without mutating production behavior.

/** Frozen @ P10-0 capture 2026-08-01 — validated-ledger.v1.jsonl live read (read-only). */
export const P10_BASELINE_CAPTURED_AT_ISO = '2026-08-01T19:17:00+08:00'

export const P10_BAD_RULER_FIXTURE = {
  ledgerHttpSegmentStarted: 228,
  ledgerStreamTerminated: 163,
  ledgerStreamActivity: 446_488,
  ledgerNetworkStarted: 0,
  ledgerMaxStepsReached: 0,
  rolling100EarlyDisconnect: 100,
  rolling100MaxSteps: 0,
  /** Runtime install truth @ capture — not deploy-ready. */
  installedSparkleVersion: '1.28.0',
  candidateSparkleVersion: '1.28.6',
  installedGuardVersions: ['0.16.26', '0.16.27', '0.16.28', '0.16.34', '0.16.40'],
  candidateGuardVersion: '0.16.40',
} as const

export const P10_0730_UNSUPPORTED_REGION_GOLDEN = {
  outerCode: 8,
  outerMessage: 'resource_exhausted',
  innerErrorCode: 64,
  innerSubtype: 'ERROR_UNSUPPORTED_REGION',
  isRetryable: false,
  actionRequired: 'change_model',
  expectedProjection: 'unsupported_region',
  mustNotProjectAs: 'true_resource_exhausted',
} as const

export const P10_0801_DIAL_STORM_GOLDEN = {
  windowMinutes: 93,
  pulseCount: 348,
  rescueNudgeCount: 210,
  recoveryIneffectiveCount: 167,
  expectedVerdict: 'L2_L3_control_plane_self_excitation',
} as const

export const P10_0721_CODE8_UNKNOWN_GOLDEN = {
  historicalCode8Rows: 359,
  innerDetailsAvailable: false,
  expectedProjection: 'unknown_code8',
  mustNotProjectAs: 'cursor_server_definitive',
} as const

/** Read-only Mac/VPS baseline manifest @ P10-0 capture — no secrets, hash-only. */
export const P10_WORKBENCH_STOCK_PATCHED_DIFF = {
  capturedAtIso: P10_BASELINE_CAPTURED_AT_ISO,
  cursorAppPath: '/Applications/Cursor-3.1.15.app',
  stockBackupPath:
    '~/.cursor-patches/ifm-agent-stability/2026-08-01T10-19-06.085Z__Applications__Cursor-3.1.15.app__Contents__Resources__app__out__vs__workbench__workbench.desktop.main.js',
  stockWorkbenchMainJsSha256:
    '31edd10b2ab9db2530995cfb0c5cf4c20062f10eb568e7002889a6e1abb7419f',
  stockWorkbenchMainJsBytes: 50_319_049,
  stockIfmPatchMarkerCount: 0,
  patchedWorkbenchMainJsSha256:
    '08205fb9f7f73cf05b249394bf29c02305600c4d62a6cf5837e2ebe006732f1d',
  patchedWorkbenchMainJsBytes: 50_355_727,
  patchedIfmPatchMarkerCount: 6,
  patch482PresentOnDisk: true,
  patch482ActiveInMemory: false,
} as const

export const P10_BASELINE_MANIFEST = {
  capturedAtIso: P10_BASELINE_CAPTURED_AT_ISO,
  cursor315: {
    appPath: 'Cursor-3.1.15.app',
    workbenchMainJsSha256: P10_WORKBENCH_STOCK_PATCHED_DIFF.patchedWorkbenchMainJsSha256,
    workbenchMainJsBytes: P10_WORKBENCH_STOCK_PATCHED_DIFF.patchedWorkbenchMainJsBytes,
    stockWorkbenchMainJsSha256: P10_WORKBENCH_STOCK_PATCHED_DIFF.stockWorkbenchMainJsSha256,
    stockWorkbenchMainJsBytes: P10_WORKBENCH_STOCK_PATCHED_DIFF.stockWorkbenchMainJsBytes,
    workbenchIfmMarkerHits: P10_WORKBENCH_STOCK_PATCHED_DIFF.patchedIfmPatchMarkerCount,
    workbenchState: 'patched_observe_only',
    userDataRoot: 'Cursor-3.1.15-data',
    guardExtensionPath: 'local.cursor-usage-watch-0.16.40',
    /** Proven @ 20260801T174506 renderer: ifm-event-v1 + ifm-patch-480 active. */
    guardMemoryActivated: true,
    rendererIfmEventV1Count: 5231,
    ledgerNetworkStarted: 0,
    patch482NetworkStartedInLedger: false,
  },
  macSparkle: {
    mihomoYamlSha256: '64829b0e686d600b19a9f3e976b4998615b4cd34236cccc55068f8f23bd80035',
    workConfigYamlSha256: '8ad60078dda39a444f3b9fdd575b18821784eebcd03a777e5acaa992ab1304bc',
    tunUtun: 'utun4',
    tunMtu: 1400,
    tunFakeIp: '198.18.0.1',
    mixedPort: 7890,
    activeLeaf: 'JP-VPS-HY2',
  },
  vpsJpHy2: {
    singBoxVersion: '1.14.0-alpha.48',
    singBoxRevision: 'fa36eb769a200e9558c414a36eb16da9a2446ea9',
    configJsonSha256: 'a1378e2eee67e6331c1991bc720b537e2429c9b152f8b4b92e93fa93913d9f12',
    hy2QuicUdpTimeout: '3600s',
    hy2QuicIdleTimeout: '3600s',
    hy2QuicKeepAlivePeriod: '30s',
    conntrackCount: 379,
  },
} as const

/** 660d7a6f — documents evidence gap; forbids single-axis definitive root cause. */
export const P10_660D7A6F_EVIDENCE_GAP = {
  rid: '660d7a6f-072b-46cb-9e43-e6650e80e928',
  disconnectAtLocal: '2026-08-01T18:32:26+08:00',
  httpParentChainAgeMs: 103_881_422,
  outboundHy2SessionAgeMs: null,
  sseCarrierByteStallMs: null,
  observedByteStallOnOtherConnMs: 45_970,
  transportLongevityTruthLogged: false,
  definitiveRootCauseAllowed: false,
} as const

export type P10BaselineFixtureId =
  | 'bad_ruler'
  | '0730_unsupported_region'
  | '0801_dial_storm'
  | '0721_code8_unknown'
  | 'baseline_manifest'
  | 'workbench_stock_patched_diff'
  | '660d7a6f_evidence_gap'

export interface P10BaselineVerdict {
  fixtureId: P10BaselineFixtureId
  ok: boolean
  detail: string
}

export function evaluateP10BadRulerFixture(
  observed: typeof P10_BAD_RULER_FIXTURE = P10_BAD_RULER_FIXTURE,
): P10BaselineVerdict {
  const invalid =
    observed.ledgerNetworkStarted === 0 &&
    (observed.ledgerHttpSegmentStarted > 0 || observed.rolling100EarlyDisconnect > 0)
  return {
    fixtureId: 'bad_ruler',
    ok: invalid,
    detail: invalid
      ? 'physical ruler invalid — requestId/segment proxy cannot represent network starts'
      : 'expected invalid bad-ruler fixture',
  }
}

export function evaluateP10UnsupportedRegionGolden(
  innerSubtype: string | undefined,
): P10BaselineVerdict {
  const ok = innerSubtype === P10_0730_UNSUPPORTED_REGION_GOLDEN.innerSubtype
  return {
    fixtureId: '0730_unsupported_region',
    ok,
    detail: ok
      ? 'unsupported_region preserved from ErrorDetails'
      : `expected inner subtype ${P10_0730_UNSUPPORTED_REGION_GOLDEN.innerSubtype}, got ${innerSubtype ?? 'missing'}`,
  }
}

export function evaluateP10Code8UnknownGolden(hasInnerDetails: boolean): P10BaselineVerdict {
  const ok = !hasInnerDetails
  return {
    fixtureId: '0721_code8_unknown',
    ok,
    detail: ok
      ? 'missing inner details remain unknown_code8'
      : 'must not invent inner subtype when details absent',
  }
}

export function evaluateP10BaselineManifestFixture(
  manifest: typeof P10_BASELINE_MANIFEST = P10_BASELINE_MANIFEST,
): P10BaselineVerdict {
  const ok =
    manifest.cursor315.workbenchMainJsSha256.length === 64 &&
    manifest.cursor315.stockWorkbenchMainJsSha256.length === 64 &&
    manifest.cursor315.workbenchMainJsSha256 !== manifest.cursor315.stockWorkbenchMainJsSha256 &&
    manifest.macSparkle.mihomoYamlSha256.length === 64 &&
    manifest.vpsJpHy2.configJsonSha256.length === 64 &&
    manifest.vpsJpHy2.hy2QuicUdpTimeout === '3600s'
  return {
    fixtureId: 'baseline_manifest',
    ok,
    detail: ok
      ? 'mac/vps hash manifest + stock/patched workbench diff complete'
      : 'baseline manifest incomplete — missing hash fields or stock/patched diff',
  }
}

export function evaluateP10WorkbenchStockPatchedDiff(
  diff: typeof P10_WORKBENCH_STOCK_PATCHED_DIFF = P10_WORKBENCH_STOCK_PATCHED_DIFF,
): P10BaselineVerdict {
  const ok =
    diff.stockIfmPatchMarkerCount === 0 &&
    diff.patchedIfmPatchMarkerCount > 0 &&
    diff.stockWorkbenchMainJsSha256 !== diff.patchedWorkbenchMainJsSha256 &&
    diff.patch482PresentOnDisk &&
    !diff.patch482ActiveInMemory
  return {
    fixtureId: 'workbench_stock_patched_diff',
    ok,
    detail: ok
      ? 'stock vs patched workbench frozen; patch-482 disk≠memory (reload blocked)'
      : 'workbench stock/patched diff fixture violated',
  }
}

export function evaluateP10_660d7a6fEvidenceGap(
  gap: typeof P10_660D7A6F_EVIDENCE_GAP = P10_660D7A6F_EVIDENCE_GAP,
): P10BaselineVerdict {
  const ok = !gap.definitiveRootCauseAllowed && gap.outboundHy2SessionAgeMs == null
  return {
    fixtureId: '660d7a6f_evidence_gap',
    ok,
    detail: ok
      ? 'single-axis parent_chain age cannot support definitive HY2 root cause'
      : '660d7a6f evidence gap fixture violated',
  }
}
