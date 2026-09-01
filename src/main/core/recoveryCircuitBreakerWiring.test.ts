import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)))

describe('recoveryCircuitBreaker P1 wiring', () => {
  it('hy2ParentSidecar gates mutations and fixes birth-reset false success', () => {
    const source = readFileSync(path.join(ROOT, 'hy2ParentSidecar.ts'), 'utf8')
    assert.match(source, /assertRecoveryCircuitAllowsMutation/)
    assert.match(source, /notifyRecoveryCircuitFailure/)
    assert.match(source, /mutationClosedParentUdp/)
    assert.doesNotMatch(
      source,
      /if \(mutation\.mutated\) \{\s*parentUdpClosedThisInvocation = true/,
    )
  })

  it('recovery circuit breaker core exports P1 thresholds', () => {
    const source = readFileSync(path.join(ROOT, 'recoveryCircuitBreakerCore.ts'), 'utf8')
    assert.match(source, /RECOVERY_CIRCUIT_BREAKER_FAILURE_THRESHOLD = 3/)
    assert.match(source, /RECOVERY_CIRCUIT_BREAKER_COOLDOWN_MS = 10 \* 60_000/)
  })

  it('recovery circuit breaker uses static marathon guard import', () => {
    const source = readFileSync(path.join(ROOT, 'recoveryCircuitBreaker.ts'), 'utf8')
    assert.match(source, /import \{ evaluateMarathonCoreColdRestart \} from '\.\/marathonCoreRestartGuard'/)
    assert.doesNotMatch(
      source,
      /evaluateEscalateRestartGuard[\s\S]*await import\('\.\/marathonCoreRestartGuard'\)/,
    )
  })

  it('emergency core recovery uses bridge invoke (no manager dynamic import)', () => {
    const source = readFileSync(path.join(ROOT, 'emergencyCoreRecovery.ts'), 'utf8')
    assert.match(source, /invokeEmergencyCoreRestart/)
    assert.doesNotMatch(source, /import \{ restartCoreEmergency \} from '\.\/manager'/)
    assert.doesNotMatch(source, /await import\('\.\/manager'\)/)
    const bridge = readFileSync(path.join(ROOT, 'emergencyCoreRestartBridge.ts'), 'utf8')
    assert.match(bridge, /registerEmergencyCoreRestartHandler/)
    assert.match(readFileSync(path.join(ROOT, 'manager.ts'), 'utf8'), /registerEmergencyCoreRestartHandler\(restartCoreEmergency\)/)
  })
})
