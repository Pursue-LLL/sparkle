import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyTunStartupLogLine,
  createTunStartupGuardState,
  isCoreSetuidSatisfied,
  isTunAdapterListeningLog,
  isTunPermissionError,
  requiresCoreSetuid,
  shouldRecoverTunPermission,
  type CorePermissionMode
} from './tunStartupGuardCore'

describe('tunStartupGuardCore', () => {
  it('detects tun adapter listening log', () => {
    assert.equal(
      isTunAdapterListeningLog(
        '[TUN] Tun adapter listening at: utun4([198.18.0.1/30],[]), mtu: 1400'
      ),
      true
    )
  })

  it('detects tun permission error log', () => {
    assert.equal(
      isTunPermissionError(
        'Start TUN listening error: configure tun interface: operation not permitted'
      ),
      true
    )
  })

  it('marks permission error and clears adapter flag', () => {
    let state = createTunStartupGuardState()
    state = applyTunStartupLogLine(
      state,
      '[TUN] Tun adapter listening at: utun4([198.18.0.1/30],[]), mtu: 1400'
    )
    assert.equal(state.adapterListening, true)

    state = applyTunStartupLogLine(
      state,
      'Start TUN listening error: configure tun interface: operation not permitted'
    )
    assert.equal(state.permissionErrorSeen, true)
    assert.equal(state.adapterListening, false)
  })

  it('requires recovery when tun enabled without setuid', () => {
    const state = createTunStartupGuardState()
    assert.equal(shouldRecoverTunPermission(true, false, state, 2), true)
  })

  it('skips recovery when adapter is listening', () => {
    const state = {
      ...createTunStartupGuardState(),
      adapterListening: true
    }
    assert.equal(shouldRecoverTunPermission(true, true, state, 2), false)
  })

  it('skips recovery when tun is disabled, in flight or out of attempts', () => {
    const idle = createTunStartupGuardState()
    assert.equal(shouldRecoverTunPermission(false, false, idle, 2), false)
    assert.equal(
      shouldRecoverTunPermission(true, false, { ...idle, recoveryInFlight: true }, 2),
      false
    )
    assert.equal(
      shouldRecoverTunPermission(true, false, { ...idle, recoveryAttempts: 2 }, 2),
      false
    )
    assert.equal(shouldRecoverTunPermission(true, false, { ...idle, recoveryAttempts: 1 }, 2), true)
  })

  it('still recovers on a real permission error when the setuid requirement is satisfied', () => {
    const state = { ...createTunStartupGuardState(), permissionErrorSeen: true }
    assert.equal(shouldRecoverTunPermission(true, true, state, 2), true)
  })
})

describe('requiresCoreSetuid', () => {
  const table: Array<[boolean, CorePermissionMode | undefined, boolean]> = [
    // tun 关闭：任何模式都不需要。
    [false, 'elevated', false],
    [false, 'service', false],
    [false, undefined, false],
    // tun 开启：只有 service 模式（内核是 root 服务的子进程）免 setuid；未配置按 App 默认的 elevated 处理。
    [true, 'elevated', true],
    [true, undefined, true],
    [true, 'service', false]
  ]

  for (const [tunEnabled, corePermissionMode, expected] of table) {
    it(`tun=${tunEnabled} mode=${corePermissionMode ?? 'unset'} → ${expected}`, () => {
      assert.equal(requiresCoreSetuid({ tunEnabled, corePermissionMode }), expected)
    })
  }
})

describe('isCoreSetuidSatisfied', () => {
  it('does not touch the filesystem when setuid is not required', () => {
    let probed = 0
    const hasCoreSetuid = (): boolean => {
      probed += 1
      return false
    }

    assert.equal(
      isCoreSetuidSatisfied({ tunEnabled: true, corePermissionMode: 'service' }, hasCoreSetuid),
      true
    )
    assert.equal(
      isCoreSetuidSatisfied({ tunEnabled: false, corePermissionMode: 'elevated' }, hasCoreSetuid),
      true
    )
    assert.equal(probed, 0)
  })

  it('defers to the real setuid state when it is required', () => {
    const input = { tunEnabled: true, corePermissionMode: 'elevated' } as const
    assert.equal(
      isCoreSetuidSatisfied(input, () => true),
      true
    )
    assert.equal(
      isCoreSetuidSatisfied(input, () => false),
      false
    )
    assert.equal(
      isCoreSetuidSatisfied({ ...input, corePermissionMode: undefined }, () => false),
      false
    )
  })
})
