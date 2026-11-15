import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'

const LIB = join(import.meta.dirname, 'lib', 'core-setuid.sh')
const STUB = join(import.meta.dirname, 'testing', 'sandbox-stub.sh')

interface BashResult {
  ok: boolean
  output: string
}

describe('lib/core-setuid.sh', () => {
  let root: string
  let appDataDir: string
  let fakeApp: string
  let sidecar: string
  let binDir: string
  let simDir: string

  /**
   * 在系统自带的 bash 3.2 里、以与安装脚本相同的 `set -euo pipefail` 执行片段：
   * 判定函数「返回非零」是常态（比如 TUN 未开启），只有严格模式下才能暴露 `set -e` 的误杀。
   * stderr 并入 stdout，因为成功返回时 execFileSync 不回传 stderr，而断言大多要看提示语。
   * `uname -r` 由命令桩提供（默认 Darwin 24），不依赖跑测试的机器。
   */
  function bash(script: string, env: Record<string, string> = {}): BashResult {
    try {
      const output = execFileSync(
        '/bin/bash',
        ['-c', `set -euo pipefail; source "${LIB}"; { ${script} ; } 2>&1`],
        {
          encoding: 'utf8',
          env: {
            PATH: `${binDir}:/usr/bin:/bin`,
            HOME: root,
            SPARKLE_APP_DATA_DIR: appDataDir,
            SIM_DIR: simDir,
            SIM_DARWIN: '24.0.0',
            ...env
          },
          stdio: ['ignore', 'pipe', 'pipe']
        }
      )
      return { ok: true, output }
    } catch (error) {
      return { ok: false, output: (error as { stdout?: string }).stdout ?? '' }
    }
  }

  const yes = (script: string, env: Record<string, string> = {}): boolean =>
    bash(`if ${script}; then echo yes; else echo no; fi`, env).output.trim() === 'yes'

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'sparkle-core-setuid-'))
  })

  after(() => {
    rmSync(root, { recursive: true, force: true })
  })

  beforeEach(() => {
    rmSync(root, { recursive: true, force: true })
    appDataDir = join(root, 'data')
    fakeApp = join(root, 'Sparkle.app')
    sidecar = join(fakeApp, 'Contents', 'Resources', 'sidecar')
    binDir = join(root, 'bin')
    simDir = join(root, 'sim')
    for (const dir of [appDataDir, sidecar, binDir, simDir]) {
      mkdirSync(dir, { recursive: true })
    }
    symlinkSync(STUB, join(binDir, 'osascript'))
    symlinkSync(STUB, join(binDir, 'uname'))
  })

  const writeCore = (name: string, mode: number): string => {
    const file = join(sidecar, name)
    writeFileSync(file, '#!/bin/sh\n', 'utf8')
    chmodSync(file, mode)
    return file
  }

  const writeConfig = (lines: string[]): void => {
    writeFileSync(join(appDataDir, 'config.yaml'), `${lines.join('\n')}\n`, 'utf8')
  }

  const writeTun = (content: string): void => {
    writeFileSync(join(appDataDir, 'mihomo.yaml'), content, 'utf8')
  }

  const addServiceBinary = (): void => {
    const dir = join(fakeApp, 'Contents', 'Resources', 'files')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'sparkle-service'), '', 'utf8')
  }

  const setupElevatedWithTun = (): string => {
    writeTun('tun:\n  enable: true\n')
    writeConfig(['corePermissionMode: elevated'])
    return writeCore('mihomo', 0o755)
  }

  it('detects the setuid bit exactly like the app does', () => {
    const cases: Array<[string, boolean]> = [
      ['-rwsr-sr-x', true],
      ['-rwsr-xr-x', true],
      ['-rwSr-sr-x', true],
      ['-rwxr-xr-x', false],
      ['-rw-r--r--', false],
      ['', false],
      ['rws', false]
    ]
    for (const [mode, expected] of cases) {
      assert.equal(yes(`is_setuid_mode ${JSON.stringify(mode)}`), expected, mode)
    }
  })

  describe('config parsing', () => {
    it('reads the enabled core and ignores the unused one', () => {
      writeConfig(['core: mihomo-alpha'])
      assert.equal(bash('enabled_core_name').output.trim(), 'mihomo-alpha')
      writeConfig(['core: mihomo'])
      assert.equal(bash('enabled_core_name').output.trim(), 'mihomo')
    })

    it('tolerates quotes, trailing comments and unrelated keys', () => {
      writeConfig(['other: 1', 'core: "mihomo-alpha"   # chosen by user', 'core2: mihomo'])
      assert.equal(bash('enabled_core_name').output.trim(), 'mihomo-alpha')
    })

    it('falls back to mihomo when the config is missing or names an unknown core', () => {
      assert.equal(bash('enabled_core_name').output.trim(), 'mihomo')
      writeConfig(['core: something-else'])
      assert.equal(bash('enabled_core_name').output.trim(), 'mihomo')
    })

    it('defaults the permission mode to elevated like the app, and only honours service', () => {
      assert.equal(bash('configured_core_permission_mode').output.trim(), 'elevated')
      for (const [line, expected] of [
        ['corePermissionMode: service', 'service'],
        ["corePermissionMode: 'service'", 'service'],
        ['corePermissionMode: elevated', 'elevated'],
        ['corePermissionMode: banana', 'elevated']
      ]) {
        writeConfig([line])
        assert.equal(bash('configured_core_permission_mode').output.trim(), expected, line)
      }
    })
  })

  describe('effective_core_permission_mode (macOS 26 mitigation parity)', () => {
    const effective = (darwin: string): string =>
      bash(`effective_core_permission_mode '${fakeApp}' ${darwin}`).output.trim()

    it('rewrites elevated to service only on Darwin >= 25 with the service binary present', () => {
      writeConfig(['corePermissionMode: elevated'])
      addServiceBinary()
      assert.equal(effective('24'), 'elevated')
      assert.equal(effective('25'), 'service')
      assert.equal(effective('26'), 'service')
    })

    it('keeps elevated when the bundle has no service binary', () => {
      writeConfig(['corePermissionMode: elevated'])
      assert.equal(effective('25'), 'elevated')
    })

    it('never turns service back into elevated', () => {
      writeConfig(['corePermissionMode: service'])
      assert.equal(effective('24'), 'service')
      assert.equal(effective('25'), 'service')
    })

    it('treats a missing config as elevated, then applies the mitigation', () => {
      addServiceBinary()
      assert.equal(effective('24'), 'elevated')
      assert.equal(effective('25'), 'service')
    })

    it('reads the Darwin version from uname when it is not given', () => {
      writeConfig(['corePermissionMode: elevated'])
      addServiceBinary()
      const run = (darwin: string): string =>
        bash(`effective_core_permission_mode '${fakeApp}'`, { SIM_DARWIN: darwin }).output.trim()
      assert.equal(run('24.6.0'), 'elevated')
      assert.equal(run('25.5.0'), 'service')
    })
  })

  describe('tun_enabled', () => {
    it('recognises block and flow style enablement', () => {
      for (const content of [
        'tun:\n  enable: true\n  stack: gvisor\n',
        'tun: { enable: true, stack: mixed }\n',
        'tun:\n  enable: true # on\n'
      ]) {
        writeTun(content)
        assert.equal(yes('tun_enabled'), true, content)
      }
    })

    it('is false when disabled, absent or the file is missing', () => {
      assert.equal(yes('tun_enabled'), false)
      writeTun('tun:\n  enable: false\n')
      assert.equal(yes('tun_enabled'), false)
      writeTun('mixed-port: 7890\n')
      assert.equal(yes('tun_enabled'), false)
    })

    it("does not mistake another section's enable flag for the tun block", () => {
      writeTun('dns:\n  enable: true\ntun:\n  enable: false\nprofile:\n  enable: true\n')
      assert.equal(yes('tun_enabled'), false)
      writeTun('dns:\n  enable: true\ntun:\n  stack: system\n')
      assert.equal(yes('tun_enabled'), false)
    })
  })

  describe('requirement matrix', () => {
    const required = (darwin = '24.0.0'): boolean =>
      yes(`core_setuid_required '${fakeApp}'`, { SIM_DARWIN: darwin })
    const satisfied = (darwin = '24.0.0'): boolean =>
      yes(`core_setuid_satisfied '${fakeApp}'`, { SIM_DARWIN: darwin })

    it('needs setuid only when TUN is on and the core does not run under the service', () => {
      writeTun('tun:\n  enable: true\n')
      writeConfig(['corePermissionMode: elevated'])
      assert.equal(required(), true)
      writeConfig(['corePermissionMode: service'])
      assert.equal(required(), false)
      writeTun('tun:\n  enable: false\n')
      writeConfig(['corePermissionMode: elevated'])
      assert.equal(required(), false)
    })

    it('does not need setuid on macOS 26 once the mitigation rewrites elevated to service', () => {
      writeTun('tun:\n  enable: true\n')
      writeConfig(['corePermissionMode: elevated'])
      addServiceBinary()
      assert.equal(required('25.5.0'), false)
      assert.equal(required('24.6.0'), true)
    })

    it('is satisfied without setuid when it is not required', () => {
      writeTun('tun:\n  enable: true\n')
      writeConfig(['corePermissionMode: service'])
      writeCore('mihomo', 0o755)
      assert.equal(satisfied(), true)
    })

    it('is unsatisfied when required and the setuid bit is missing, satisfied once present', () => {
      setupElevatedWithTun()
      assert.equal(satisfied(), false)
      writeCore('mihomo', 0o4755)
      assert.equal(satisfied(), true)
    })

    it('judges only the enabled core', () => {
      writeTun('tun:\n  enable: true\n')
      writeConfig(['corePermissionMode: elevated', 'core: mihomo-alpha'])
      writeCore('mihomo', 0o4755)
      writeCore('mihomo-alpha', 0o755)
      assert.equal(satisfied(), false)
    })

    it('treats a missing core binary as nothing to fix', () => {
      assert.equal(yes(`core_setuid_intact '${sidecar}'`), true)
    })
  })

  describe('restore_core_setuid', () => {
    const restore = (env: Record<string, string> = {}): BashResult =>
      bash(`rc=0; restore_core_setuid '${fakeApp}' || rc=$?; echo "rc=$rc"`, env)

    it('never elevates when the core runs under the service', () => {
      writeTun('tun:\n  enable: true\n')
      writeConfig(['corePermissionMode: service'])
      const core = writeCore('mihomo', 0o755)
      const out = restore()
      assert.match(out.output, /setuid not required/)
      assert.match(out.output.trim(), /rc=0$/)
      assert.equal(statSync(core).mode & 0o4000, 0)
      assert.equal(out.output.includes('administrator'), false)
    })

    it('never elevates when TUN is off', () => {
      writeTun('tun:\n  enable: false\n')
      writeConfig(['corePermissionMode: elevated'])
      writeCore('mihomo', 0o755)
      assert.match(restore().output.trim(), /rc=0$/)
    })

    it('is a no-op when setuid is already present', () => {
      setupElevatedWithTun()
      writeCore('mihomo', 0o4755)
      const out = restore({ SPARKLE_NONINTERACTIVE: '1' })
      assert.match(out.output, /setuid already intact/)
      assert.match(out.output.trim(), /rc=0$/)
    })

    it('refuses to elevate in non-interactive mode and prints the manual command', () => {
      const core = setupElevatedWithTun()
      const out = restore({ SPARKLE_NONINTERACTIVE: '1' })
      assert.match(out.output, /non-interactive mode forbids elevation/)
      assert.match(out.output, /chown root:admin/)
      assert.match(out.output, /chmod \+sx/)
      assert.equal(statSync(core).mode & 0o4000, 0)
      assert.match(out.output.trim(), /rc=1$/)
    })

    it('restores setuid with a single elevation when the user grants it', () => {
      const core = setupElevatedWithTun()
      const out = restore({ SIM_ELEVATION: 'grant' })
      assert.match(out.output, /setuid restored/)
      assert.match(out.output.trim(), /rc=0$/)
      assert.notEqual(statSync(core).mode & 0o4000, 0)
    })

    it('keeps the elevation error visible when the user cancels', () => {
      const core = setupElevatedWithTun()
      const out = restore({ SIM_ELEVATION: 'deny' })
      // 护栏：osascript 的 stderr 必须进日志，用户取消、被策略拒绝等原因才查得到。
      assert.match(out.output, /User canceled/)
      assert.match(out.output, /chown root:admin/)
      assert.match(out.output.trim(), /rc=1$/)
      assert.equal(statSync(core).mode & 0o4000, 0)
    })

    it('refuses to hand over a build whose setuid is still missing after elevation', () => {
      setupElevatedWithTun()
      // 提权「成功」却什么都没改（例如被策略静默忽略）：不能把这样的包交出去。
      rmSync(join(binDir, 'osascript'))
      writeFileSync(join(binDir, 'osascript'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
      const out = restore()
      assert.match(out.output, /setuid still missing after elevation/)
      assert.match(out.output.trim(), /rc=1$/)
    })

    it('fails loudly when the sidecar directory is missing', () => {
      const out = bash(
        `rc=0; restore_core_setuid '/nonexistent/Sparkle.app' || rc=$?; echo "rc=$rc"`
      )
      assert.match(out.output, /missing sidecar dir/)
      assert.match(out.output.trim(), /rc=1$/)
    })
  })
})
