import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CORE_BINARY_NAMES,
  formatLockOwner,
  isCoreSetuidMode,
  isLockOwnerActive,
  parseLockOwner,
  resolveInstallShortCircuit,
  resolvePostInstallRecoveryRounds,
  shouldAttemptServiceKill,
} from './sparkleInstallSafetyCore'

describe('isCoreSetuidMode', () => {
  it('accepts setuid owner-execute bits in either case', () => {
    assert.equal(isCoreSetuidMode('-rwsr-sr-x'), true)
    assert.equal(isCoreSetuidMode('-rwsr-xr-x'), true)
    assert.equal(isCoreSetuidMode('-rwSr-sr-x'), true)
    assert.equal(isCoreSetuidMode(' -rwsr-sr-x '), true)
  })

  it('rejects modes without setuid', () => {
    assert.equal(isCoreSetuidMode('-rwxr-xr-x'), false)
    assert.equal(isCoreSetuidMode('-rw-r--r--'), false)
    assert.equal(isCoreSetuidMode(''), false)
    assert.equal(isCoreSetuidMode('rws'), false)
  })

  it('covers both cores that the grant flow authorizes', () => {
    assert.deepEqual([...CORE_BINARY_NAMES], ['mihomo', 'mihomo-alpha'])
  })
})

describe('resolveInstallShortCircuit', () => {
  const healthy = {
    distFresh: true,
    cdhashMatches: true,
    appRunning: true,
    dataPlaneReachable: true,
    coreSetuidIntact: true,
  }

  it('skips only when the installed app is byte-identical and healthy', () => {
    const decision = resolveInstallShortCircuit(healthy)
    assert.equal(decision.skip, true)
    assert.equal(decision.reason, 'already_installed_and_healthy')
  })

  it('never skips when a prerequisite is missing', () => {
    const cases: Array<[Partial<typeof healthy>, string]> = [
      [{ distFresh: false }, 'dist_not_fresh'],
      [{ cdhashMatches: false }, 'cdhash_mismatch'],
      [{ appRunning: false }, 'app_not_running'],
      [{ dataPlaneReachable: false }, 'data_plane_down'],
      [{ coreSetuidIntact: false }, 'core_setuid_missing'],
    ]
    for (const [override, reason] of cases) {
      const decision = resolveInstallShortCircuit({ ...healthy, ...override })
      assert.equal(decision.skip, false, reason)
      assert.equal(decision.reason, reason)
    }
  })

  it('treats missing setuid as a defect to fix, not a reason to skip', () => {
    // 回归护栏：曾经每次 ditto 都丢掉 setuid，导致 App 每次启动都重新要密码。
    const decision = resolveInstallShortCircuit({ ...healthy, coreSetuidIntact: false })
    assert.equal(decision.skip, false)
    assert.equal(decision.reason, 'core_setuid_missing')
  })
})

describe('shouldAttemptServiceKill', () => {
  it('signals directly when allowed, with no password prompt', () => {
    assert.deepEqual(shouldAttemptServiceKill({ canSignalDirectly: true, nonInteractive: false }), {
      shouldKill: true,
      needsElevation: false,
      reason: 'direct_signal',
    })
  })

  it('never prompts in non-interactive mode', () => {
    assert.deepEqual(shouldAttemptServiceKill({ canSignalDirectly: false, nonInteractive: true }), {
      shouldKill: false,
      needsElevation: false,
      reason: 'skip_non_interactive',
    })
  })

  it('asks for elevation only when a manual run truly needs it', () => {
    assert.deepEqual(shouldAttemptServiceKill({ canSignalDirectly: false, nonInteractive: false }), {
      shouldKill: true,
      needsElevation: true,
      reason: 'elevated_signal',
    })
  })
})

describe('resolvePostInstallRecoveryRounds', () => {
  it('defaults to zero so a failed install stops instead of rebooting the app', () => {
    assert.equal(resolvePostInstallRecoveryRounds(undefined), 0)
    assert.equal(resolvePostInstallRecoveryRounds(''), 0)
    assert.equal(resolvePostInstallRecoveryRounds('   '), 0)
  })

  it('honours an explicit opt-in for diagnosis runs', () => {
    assert.equal(resolvePostInstallRecoveryRounds('1'), 1)
    assert.equal(resolvePostInstallRecoveryRounds('2'), 2)
  })

  it('clamps junk and runaway values', () => {
    for (const raw of ['abc', '-1', '1.5', '99']) {
      const rounds = resolvePostInstallRecoveryRounds(raw)
      assert.ok(rounds >= 0 && rounds <= 3, raw)
      assert.equal(Number.isInteger(rounds), true, raw)
    }
    assert.equal(resolvePostInstallRecoveryRounds('99'), 3)
  })
})

describe('upgrade lock ownership', () => {
  const now = 1_700_000_000_000

  it('round-trips a formatted owner', () => {
    const owner = parseLockOwner(formatLockOwner(4321, now))
    assert.deepEqual(owner, { pid: 4321, startedAtMs: now })
  })

  it('treats malformed or empty content as no lock', () => {
    for (const text of [undefined, '', 'garbage', 'pid=abc started=def', 'pid=0 started=0']) {
      assert.equal(parseLockOwner(text), null, String(text))
    }
  })

  it('keeps a live owner locked and releases dead or stale ones', () => {
    const owner = { pid: 4321, startedAtMs: now }
    assert.equal(isLockOwnerActive(owner, true, now + 1000), true)
    assert.equal(isLockOwnerActive(owner, false, now + 1000), false)
    assert.equal(isLockOwnerActive(owner, true, now + 61 * 60 * 1000), false)
    assert.equal(isLockOwnerActive(null, true, now), false)
  })
})
