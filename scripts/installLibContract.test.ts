import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import {
  CORE_BINARY_NAMES,
  type InterruptedUpgradeState,
  isCoreSetuidMode,
  planInterruptedUpgradeRecovery,
  resolveInstallShortCircuit,
  type UpgradePhase,
  UPGRADE_MARKER_TTL_MINUTES
} from './sparkleInstallSafetyCore'
import { libShell } from './testing/libShell'

/**
 * 契约测试：shell 库里的判定与 sparkleInstallSafetyCore.ts（判定语义的 SSOT）逐格对齐。
 * shell 不能 import TS（`tsx -e` 传参会被 node 当选项解析），所以两边各有一份实现，
 * 任何一边改了口径而另一边没改，这里就会红。
 */

const SCRIPTS = join(import.meta.dirname)
const scratch = mkdtempSync(join(tmpdir(), 'sparkle-lib-contract-'))
const bash = libShell(scratch)

const read = (path: string): string => readFileSync(join(SCRIPTS, path), 'utf8')

const PHASES: UpgradePhase[] = ['none', 'staging', 'quiesced', 'swapping', 'swapped', 'committed']

describe('shell libraries vs sparkleInstallSafetyCore.ts', () => {
  after(() => rmSync(scratch, { recursive: true, force: true }))

  describe('interrupted-transaction recovery table', () => {
    const flags = (bits: number): Omit<InterruptedUpgradeState, 'phase'> => ({
      destExists: (bits & 1) !== 0,
      prevExists: (bits & 2) !== 0,
      stageExists: (bits & 4) !== 0,
      failedExists: (bits & 8) !== 0
    })

    it('agrees on every phase × every combination of existing directories', () => {
      const fromBash = bash(`
        for phase in ${PHASES.join(' ')}; do
          for bits in $(seq 0 15); do
            plan="$(txn_plan_recovery "$phase" $((bits & 1)) $(((bits >> 1) & 1)) $(((bits >> 2) & 1)) $(((bits >> 3) & 1)) | tr '\\n' ',')"
            echo "$phase $bits $plan"
          done
        done`).split('\n')
      fromBash.pop() // 末尾换行产生的空串
      const fromTs = PHASES.flatMap((phase) =>
        Array.from({ length: 16 }, (_, bits) => {
          const steps = planInterruptedUpgradeRecovery({ phase, ...flags(bits) })
          return `${phase} ${bits} ${steps.map((step) => `${step},`).join('')}`
        })
      )
      assert.equal(fromBash.length, PHASES.length * 16)
      assert.deepEqual(fromBash, fromTs)
    })

    it('every step the planner can emit has an executor in txn_run_step', () => {
      const emitted = new Set(
        PHASES.flatMap((phase) =>
          Array.from({ length: 16 }, (_, bits) =>
            planInterruptedUpgradeRecovery({ phase, ...flags(bits) })
          ).flat()
        )
      )
      assert.ok(emitted.size >= 5, 'the matrix should exercise every step kind')
      const source = read('lib/install-transaction.sh')
      for (const step of emitted) {
        assert.match(
          source,
          new RegExp(`\\b${step}\\)`),
          `txn_run_step is missing the "${step}" step`
        )
      }
    })

    it('refuses a step it does not know instead of silently skipping it', () => {
      assert.match(bash('txn_run_step bogus; echo "rc=$?"'), /rc=1/)
    })

    it('only writes phases the TypeScript model knows about', () => {
      const written = new Set<string>()
      for (const file of ['lib/install-transaction.sh', 'install-sparkle-local.sh']) {
        for (const match of read(file).matchAll(/txn_set_phase\s+([a-z]+)/g)) written.add(match[1])
      }
      assert.deepEqual([...written].sort(), [
        'committed',
        'quiesced',
        'staging',
        'swapped',
        'swapping'
      ])
      for (const phase of written)
        assert.ok(PHASES.includes(phase as UpgradePhase), `unknown phase ${phase}`)
    })
  })

  describe('idempotent short-circuit', () => {
    it('agrees for every combination of app / data plane / permission once the bytes match', () => {
      const fromBash = bash(`
        for app in 0 1; do for plane in 0 1; do for perm in 0 1; do
          echo "$app $plane $perm $(install_short_circuit_reason $app $plane $perm)"
        done; done; done`)
        .trim()
        .split('\n')
      assert.equal(fromBash.length, 8)
      for (const line of fromBash) {
        const [app, plane, perm, reason] = line.split(' ')
        const expected = resolveInstallShortCircuit({
          distFresh: true,
          cdhashMatches: true,
          appRunning: app === '1',
          dataPlaneReachable: plane === '1',
          corePermissionSatisfied: perm === '1'
        })
        assert.equal(reason === 'skip', expected.skip, `skip for ${line}`)
        if (!expected.skip) assert.equal(reason, expected.reason, `reason for ${line}`)
      }
    })
  })

  describe('enabled core name', () => {
    it('maps every core binary the app can run to itself, and anything else to the default core', () => {
      const appData = join(scratch, 'app-data')
      mkdirSync(appData, { recursive: true })
      const configured = (value: string): string => {
        writeFileSync(join(appData, 'config.yaml'), `core: ${value}\n`)
        return bash('enabled_core_name', { SPARKLE_APP_DATA_DIR: appData }).trim()
      }
      for (const name of CORE_BINARY_NAMES) assert.equal(configured(name), name)
      assert.equal(configured('something-else'), 'mihomo')
      rmSync(join(appData, 'config.yaml'))
      assert.equal(bash('enabled_core_name', { SPARKLE_APP_DATA_DIR: appData }).trim(), 'mihomo')
    })
  })

  describe('setuid bit parsing', () => {
    it('agrees on every shape of `stat -f %Sp` output', () => {
      const modes = [
        '-rwsr-xr-x',
        '-rwSr-xr-x',
        '-rwxr-xr-x',
        '-rwsr-sr-x',
        '-rw-r--r--',
        '-rws',
        '-rw',
        '',
        'x'
      ]
      const fromBash = bash(
        modes.map((mode) => `is_setuid_mode '${mode}' && echo yes || echo no`).join('\n')
      )
        .trim()
        .split('\n')
      assert.deepEqual(
        fromBash,
        modes.map((mode) => (isCoreSetuidMode(mode) ? 'yes' : 'no'))
      )
    })
  })

  describe('etime_to_sec', () => {
    const TABLE: ReadonlyArray<readonly [string, number]> = [
      ['00:05', 5],
      ['05:13', 313],
      ['01:02:03', 3723],
      ['2-03:04:05', 183845],
      ['1-00:00:00', 86400],
      [' 12:08 ', 728],
      ['08:09', 489],
      ['09:09:09', 32949]
    ]

    it('converts ps etime formats, including zero-padded values that bash would read as octal', () => {
      const out = bash(TABLE.map(([input]) => `etime_to_sec '${input}'`).join('\n'))
        .trim()
        .split('\n')
      assert.deepEqual(
        out.map(Number),
        TABLE.map(([, seconds]) => seconds)
      )
    })
  })

  describe('txn_remove_scratch only ever deletes the three transaction directories', () => {
    it('refuses everything else, including look-alike paths', () => {
      const victim = join(scratch, 'victim')
      mkdirSync(victim, { recursive: true })
      const out = bash(`
        txn_init_paths
        mkdir -p "$TXN_STAGE" "$TXN_PREV" "$TXN_FAILED"
        for target in "${victim}" "$TXN_STAGE/../victim" "\${TXN_STAGE}x" "$DEST" "${scratch}" ""; do
          if txn_remove_scratch "$target" 2>/dev/null; then echo "removed:$target"; else echo "refused:$target"; fi
        done
        for target in "$TXN_STAGE" "$TXN_PREV" "$TXN_FAILED"; do
          if txn_remove_scratch "$target"; then echo "removed-own"; fi
        done`)
        .trim()
        .split('\n')
      assert.deepEqual(
        out.slice(0, 6).map((line) => line.split(':')[0]),
        Array(6).fill('refused')
      )
      assert.deepEqual(out.slice(6), Array(3).fill('removed-own'))
      assert.equal(existsSync(victim), true, 'a path outside the transaction must survive')
    })
  })

  describe('quiet marker shared by the installer and the background workers', () => {
    const ttl = (file: string, name: string): number => {
      const match = new RegExp(`^${name}=(\\d+)$`, 'm').exec(read(file))
      assert.ok(match, `${name} not found in ${file}`)
      return Number(match[1])
    }

    it('uses one TTL everywhere', () => {
      assert.equal(
        ttl('lib/install-transaction.sh', 'TXN_MARKER_TTL_MIN'),
        UPGRADE_MARKER_TTL_MINUTES
      )
      assert.equal(
        ttl('sparkle-profile-scheduler.sh', 'UPGRADE_MARKER_TTL_MIN'),
        UPGRADE_MARKER_TTL_MINUTES
      )
      assert.equal(
        ttl('sparkle-gui-watchdog.sh', 'UPGRADE_MARKER_TTL_MIN'),
        UPGRADE_MARKER_TTL_MINUTES
      )
    })

    it('uses one marker file name everywhere', () => {
      assert.match(
        read('lib/install-transaction.sh'),
        /TXN_MARKER_FILE="\$SPARKLE_STATE_DIR\/upgrade-in-progress"/
      )
      for (const worker of ['sparkle-profile-scheduler.sh', 'sparkle-gui-watchdog.sh']) {
        assert.match(read(worker), /UPGRADE_MARKER="\$\{STATE_DIR\}\/upgrade-in-progress"/, worker)
      }
    })

    it('is the marker the installer demands from deployed workers before it touches anything', () => {
      assert.match(read('install-sparkle-local.sh'), /grep -qF 'upgrade-in-progress'/)
    })
  })
})
