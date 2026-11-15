import assert from 'node:assert/strict'
import { existsSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import {
  assertExit,
  assertTransactionClosed,
  elevationCalls,
  EXIT,
  quitCalls
} from './testing/installAssertions'
import { InstallSandbox } from './testing/installSandbox'
import { type BundleSpec, NEW_BUNDLE, serviceWorld, type WorldSpec } from './testing/installWorld'

describe('install-sparkle-local.sh short-circuit (sandboxed)', () => {
  let sandbox: InstallSandbox | undefined

  afterEach(() => {
    sandbox?.dispose()
    sandbox = undefined
  })

  const create = (spec: WorldSpec): InstallSandbox => {
    sandbox = new InstallSandbox(spec)
    return sandbox
  }

  const sameBuild: BundleSpec = { ...NEW_BUNDLE }

  describe('short-circuit when the same build is already healthy', () => {
    const identical = (overrides: Partial<WorldSpec> = {}): WorldSpec =>
      serviceWorld({ old: sameBuild, next: sameBuild, ...overrides })
    const markerPath = (sb: InstallSandbox): string => join(sb.root, 'short-circuit.marker')

    it('touches nothing and tells the parent flow it was a no-op', async () => {
      const sb = create(identical())
      const inodeBefore = statSync(sb.dest).ino
      const result = await sb.run({ SPARKLE_INSTALL_SHORT_CIRCUIT_MARKER: markerPath(sb) })

      assertExit(result, EXIT.ok)
      assert.match(result.output, /Same build already installed and healthy/)
      assert.equal(existsSync(markerPath(sb)), true)
      assert.equal(statSync(sb.dest).ino, inodeBefore)
      assert.deepEqual(quitCalls(sb), [])
      assert.deepEqual(sb.callsOf('ditto'), [])
      assert.equal(
        sb.callsOf('mv').some((line) => line.includes('Sparkle.app')),
        false
      )
      assertTransactionClosed(sb)
    })

    it('short-circuits a headless macOS 26 install whose GUI is legitimately absent', async () => {
      const sb = create(identical({ forceGui: false }))
      rmSync(join(sb.simDir, 'gui.pid'))
      const result = await sb.run({ SPARKLE_INSTALL_SHORT_CIRCUIT_MARKER: markerPath(sb) })
      assertExit(result, EXIT.ok)
      assert.equal(existsSync(markerPath(sb)), true)
    })

    const reinstallCases: Array<[string, Partial<WorldSpec>, Record<string, string>, RegExp]> = [
      ['the app is not running', { oldRunning: false }, {}, /Reinstall required: app_not_running/],
      [
        'the data plane was already down',
        { network: 'down' },
        {},
        /Reinstall required: data_plane_down/
      ],
      ['a reinstall is forced', {}, { SPARKLE_FORCE_REINSTALL: '1' }, /phase: staging/]
    ]
    for (const [name, overrides, env, expected] of reinstallCases) {
      it(`does a real install when ${name}`, async () => {
        const sb = create(identical(overrides))
        const result = await sb.run({
          SPARKLE_INSTALL_SHORT_CIRCUIT_MARKER: markerPath(sb),
          ...env
        })
        assertExit(result, EXIT.ok)
        assert.match(result.output, expected)
        assert.equal(existsSync(markerPath(sb)), false)
        assert.equal(sb.callsOf('ditto').length, 1)
        assertTransactionClosed(sb)
      })
    }

    it('skips the slow Gatekeeper assessment when a forced reinstall puts the same bytes back', async () => {
      const sb = create(identical())
      const result = await sb.run({ SPARKLE_FORCE_REINSTALL: '1' })
      assertExit(result, EXIT.ok)
      assert.equal(sb.callsOf('ditto').length, 1, 'a real install still happens')
      assert.deepEqual(sb.callsOf('spctl'), [])
      assert.doesNotMatch(result.output, /spctl: rejected/)
    })

    it('treats a missing setuid on an elevated TUN install as a defect to fix, not as healthy', async () => {
      const sb = create(
        identical({
          mode: 'elevated',
          darwin: '24.6.0',
          old: { ...sameBuild, coreSetuid: false },
          next: sameBuild
        })
      )
      const result = await sb.run({
        SIM_ELEVATION: 'grant',
        SPARKLE_INSTALL_SHORT_CIRCUIT_MARKER: markerPath(sb)
      })
      assertExit(result, EXIT.ok)
      assert.match(result.output, /Reinstall required: core_setuid_missing/)
      assert.equal(sb.coreSetuidBit(), true)
    })

    it('does not demand setuid in service mode, so a service install is stable across runs', async () => {
      const sb = create(identical())
      writeFileSync(join(sb.dest, 'Contents', 'touch-marker'), '')
      const first = await sb.run({ SPARKLE_INSTALL_SHORT_CIRCUIT_MARKER: markerPath(sb) })
      const second = await sb.run({ SPARKLE_INSTALL_SHORT_CIRCUIT_MARKER: markerPath(sb) })
      assertExit(first, EXIT.ok)
      assertExit(second, EXIT.ok)
      assert.deepEqual(sb.callsOf('ditto'), [])
      assert.deepEqual(elevationCalls(sb), [])
    })
  })
})
