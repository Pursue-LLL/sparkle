import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatLockOwner,
  type InterruptedUpgradeState,
  isCoreSetuidMode,
  isLockOwnerActive,
  parseLockOwner,
  planInterruptedUpgradeRecovery,
  type RecoveryStep,
  resolveInstallShortCircuit,
  UPGRADE_MARKER_TTL_MINUTES,
  type UpgradePhase
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
})

describe('resolveInstallShortCircuit', () => {
  const healthy = {
    distFresh: true,
    cdhashMatches: true,
    appRunning: true,
    dataPlaneReachable: true,
    corePermissionSatisfied: true
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
      [{ corePermissionSatisfied: false }, 'core_setuid_missing']
    ]
    for (const [override, reason] of cases) {
      const decision = resolveInstallShortCircuit({ ...healthy, ...override })
      assert.equal(decision.skip, false, reason)
      assert.equal(decision.reason, reason)
    }
  })

  it('treats an unmet core permission requirement as a defect to fix, not a reason to skip', () => {
    // 护栏：ditto 会丢掉 setuid，权限要求未满足时必须继续安装去补齐，否则 App 每次启动都会重新要密码。
    const decision = resolveInstallShortCircuit({ ...healthy, corePermissionSatisfied: false })
    assert.equal(decision.skip, false)
    assert.equal(decision.reason, 'core_setuid_missing')
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

describe('planInterruptedUpgradeRecovery', () => {
  const state = (
    phase: UpgradePhase,
    flags: Partial<Omit<InterruptedUpgradeState, 'phase'>> = {}
  ): InterruptedUpgradeState => ({
    phase,
    destExists: false,
    prevExists: false,
    stageExists: false,
    failedExists: false,
    ...flags
  })

  it('does nothing when there is nothing to clean', () => {
    assert.deepEqual(planInterruptedUpgradeRecovery(state('none', { destExists: true })), [])
  })

  it('always drops the staging draft first', () => {
    assert.deepEqual(
      planInterruptedUpgradeRecovery(state('staging', { destExists: true, stageExists: true })),
      ['remove_stage']
    )
  })

  it('drops an unverified failed build left behind by an interrupted rollback', () => {
    // 回滚中途被打断：旧包只剩备份，未经验证的新包停在失败品目录里。
    assert.deepEqual(
      planInterruptedUpgradeRecovery(state('swapped', { prevExists: true, failedExists: true })),
      ['remove_failed', 'restore_prev']
    )
    // 回滚其实已经放回了旧包，只差删失败品。
    assert.deepEqual(
      planInterruptedUpgradeRecovery(state('swapped', { destExists: true, failedExists: true })),
      ['remove_failed']
    )
  })

  it('puts the old app back when the swap was cut between its two renames', () => {
    // 第一次 rename 之后、第二次之前：目标目录不存在，旧包只剩在备份里。
    for (const phase of ['swapping', 'quiesced', 'committed'] as const) {
      assert.deepEqual(
        planInterruptedUpgradeRecovery(state(phase, { prevExists: true, stageExists: true })),
        ['remove_stage', 'restore_prev'],
        phase
      )
    }
  })

  it('discards an unverified new app once the swap started', () => {
    for (const phase of ['swapping', 'swapped'] as const) {
      assert.deepEqual(
        planInterruptedUpgradeRecovery(state(phase, { destExists: true, prevExists: true })),
        ['discard_dest_restore_prev'],
        phase
      )
    }
  })

  it('keeps the new app and only removes the backup when the cut happened after commit', () => {
    assert.deepEqual(
      planInterruptedUpgradeRecovery(state('committed', { destExists: true, prevExists: true })),
      ['remove_prev']
    )
  })

  it('never loses the app: whatever the phase, an app that existed is still in place afterwards', () => {
    const phases: UpgradePhase[] = [
      'none',
      'staging',
      'quiesced',
      'swapping',
      'swapped',
      'committed'
    ]
    for (const phase of phases) {
      for (let bits = 0; bits < 16; bits += 1) {
        const initial = state(phase, {
          destExists: (bits & 1) !== 0,
          prevExists: (bits & 2) !== 0,
          stageExists: (bits & 4) !== 0,
          failedExists: (bits & 8) !== 0
        })
        let { destExists, prevExists, stageExists, failedExists } = initial
        for (const step of planInterruptedUpgradeRecovery(initial) as RecoveryStep[]) {
          if (step === 'remove_stage') stageExists = false
          if (step === 'remove_failed') failedExists = false
          if (step === 'remove_prev') prevExists = false
          if (step === 'restore_prev') {
            // mv 到已存在的目录会「移进去」而不是替换，所以只能在目标不存在时执行。
            assert.equal(
              destExists,
              false,
              `${phase}/${bits}: restore_prev needs an empty destination`
            )
            destExists = true
            prevExists = false
          }
          if (step === 'discard_dest_restore_prev') {
            assert.equal(
              destExists && prevExists,
              true,
              `${phase}/${bits}: needs both dest and prev`
            )
            prevExists = false
          }
        }
        const hadApp = initial.destExists || initial.prevExists
        assert.equal(destExists, hadApp, `${phase}/${bits}: app presence`)
        assert.equal(stageExists, false, `${phase}/${bits}: draft must be gone`)
        assert.equal(failedExists, false, `${phase}/${bits}: failed build must be gone`)
        assert.equal(prevExists, false, `${phase}/${bits}: backup must be consumed or removed`)
      }
    }
  })
})

describe('upgrade marker TTL', () => {
  it('is long enough to cover a full transaction but bounded so a crash cannot freeze background tasks', () => {
    assert.ok(UPGRADE_MARKER_TTL_MINUTES >= 10)
    assert.ok(UPGRADE_MARKER_TTL_MINUTES <= 30)
  })
})
