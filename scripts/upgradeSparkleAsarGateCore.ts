/** SSOT: post-build asar main bundle checks (upgrade-sparkle-local.sh + unit tests). */

function findInvalidJsRegexPcrePatterns(source: string): string[] {
  const hits: string[] = []
  const pattern = /\/\(\?[a-z]*\)/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    hits.push(match[0])
  }
  return hits
}

export type SparkleMainAsarGateResult =
  | { ok: true }
  | {
      ok: false
      reason:
        | 'stale_bundle'
        | 'invalid_js_regex_pcre'
        | 'missing_core_readiness_gate'
    }

const FAILURE_MESSAGES: Record<Exclude<SparkleMainAsarGateResult, { ok: true }>['reason'], string> = {
  stale_bundle: 'asar main bundle looks stale or corrupt',
  invalid_js_regex_pcre:
    'asar contains invalid JS regex PCRE inline flags e.g. /(?i)/ — SyntaxError at launch',
  missing_core_readiness_gate: 'asar missing Core Readiness Contract — cold start may silent-hang',
}

export function validateSparkleMainAsarBundle(mainSource: string): SparkleMainAsarGateResult {
  if (!mainSource.includes('appendAppLog')) {
    return { ok: false, reason: 'stale_bundle' }
  }
  if (findInvalidJsRegexPcrePatterns(mainSource).length > 0) {
    return { ok: false, reason: 'invalid_js_regex_pcre' }
  }
  if (!mainSource.includes('[CoreReadiness]:') && !mainSource.includes('runCoreReadinessPipeline')) {
    return { ok: false, reason: 'missing_core_readiness_gate' }
  }
  return { ok: true }
}

export function assertSparkleMainAsarBundle(mainSource: string): void {
  const result = validateSparkleMainAsarBundle(mainSource)
  if (!result.ok) {
    throw new Error(FAILURE_MESSAGES[result.reason])
  }
}
