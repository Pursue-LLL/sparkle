import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'

const LIB = join(import.meta.dirname, 'lib', 'core-setuid.sh')

/**
 * 在给定的函数库里执行一段 bash。
 * stderr 统一重定向到 stdout（`2>&1`），因为 execFileSync 成功返回时不回传 stderr，
 * 而这里的断言大多要检查库打到 stderr 的提示语。
 */
function runBash(script: string, env: Record<string, string> = {}): {
  ok: boolean
  output: string
} {
  try {
    const output = execFileSync('bash', ['-c', `{ ${script} ; } 2>&1`], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, output }
  } catch (error) {
    const err = error as { status?: number; stdout?: string }
    return { ok: false, output: err.stdout ?? '' }
  }
}

describe('lib/core-setuid.sh', () => {
  let root: string
  let fakeApp: string
  let sidecar: string

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'sparkle-core-setuid-'))
  })

  after(() => {
    rmSync(root, { recursive: true, force: true })
  })

  beforeEach(() => {
    rmSync(root, { recursive: true, force: true })
    mkdirSync(root, { recursive: true })
    fakeApp = join(root, 'Sparkle.app')
    sidecar = join(fakeApp, 'Contents', 'Resources', 'sidecar')
    mkdirSync(sidecar, { recursive: true })
  })

  const writeCore = (name: string, mode: number): void => {
    const file = join(sidecar, name)
    writeFileSync(file, '#!/bin/sh\n', 'utf8')
    chmodSync(file, mode)
  }

  const writeConfig = (core: string): string => {
    const configPath = join(root, 'config.yaml')
    writeFileSync(configPath, `core: ${core}\n`, 'utf8')
    return configPath
  }

  it('detects the setuid bit exactly like the app does', () => {
    const cases: Array<[string, boolean]> = [
      ['-rwsr-sr-x', true],
      ['-rwsr-xr-x', true],
      ['-rwSr-sr-x', true],
      ['-rwxr-xr-x', false],
      ['-rw-r--r--', false],
      ['', false],
      ['rws', false],
    ]
    for (const [mode, expected] of cases) {
      const out = runBash(
        `source "${LIB}"; if is_setuid_mode ${JSON.stringify(mode)}; then echo yes; else echo no; fi`
      )
      assert.equal(out.output.trim(), expected ? 'yes' : 'no', mode)
    }
  })

  it('reads the enabled core from config.yaml and ignores the unused one', () => {
    const configPath = writeConfig('mihomo-alpha')
    const out = runBash(`source "${LIB}"; enabled_core_name`, {
      SPARKLE_APP_CONFIG_PATH: configPath,
    })
    assert.equal(out.output.trim(), 'mihomo-alpha')

    writeConfig('mihomo')
    const out2 = runBash(`source "${LIB}"; enabled_core_name`, {
      SPARKLE_APP_CONFIG_PATH: configPath,
    })
    assert.equal(out2.output.trim(), 'mihomo')
  })

  it('falls back to mihomo when the config is missing or unreadable', () => {
    const out = runBash(`source "${LIB}"; enabled_core_name`, {
      SPARKLE_APP_CONFIG_PATH: join(root, 'nope.yaml'),
    })
    assert.equal(out.output.trim(), 'mihomo')
  })

  it('reports intact when the enabled core carries setuid', () => {
    writeCore('mihomo', 0o4755)
    const configPath = writeConfig('mihomo')
    const out = runBash(
      `source "${LIB}"; if core_setuid_intact '${sidecar}'; then echo INTACT; else echo MISSING; fi`,
      { SPARKLE_APP_CONFIG_PATH: configPath }
    )
    assert.equal(out.output.trim(), 'INTACT')
  })

  it('reports missing when ditto dropped the setuid bit', () => {
    writeCore('mihomo', 0o755)
    const configPath = writeConfig('mihomo')
    const out = runBash(
      `source "${LIB}"; if core_setuid_intact '${sidecar}'; then echo INTACT; else echo MISSING; fi`,
      { SPARKLE_APP_CONFIG_PATH: configPath }
    )
    assert.equal(out.output.trim(), 'MISSING')
  })

  it('treats a missing core binary as nothing to fix', () => {
    const configPath = writeConfig('mihomo')
    const out = runBash(
      `source "${LIB}"; if core_setuid_intact '${sidecar}'; then echo OK; else echo FAIL; fi`,
      { SPARKLE_APP_CONFIG_PATH: configPath }
    )
    assert.equal(out.output.trim(), 'OK')
  })

  it('refuses to elevate in non-interactive mode and prints the manual command', () => {
    writeCore('mihomo', 0o755)
    const configPath = writeConfig('mihomo')
    const out = runBash(
      `source "${LIB}"; restore_core_setuid '${fakeApp}'; echo "rc=$?"`,
      { SPARKLE_APP_CONFIG_PATH: configPath, SPARKLE_NONINTERACTIVE: '1' }
    )
    assert.match(out.output, /non-interactive mode forbids elevation/)
    assert.match(out.output, /chown root:admin/)
    assert.match(out.output, /chmod \+sx/)
    // 非交互模式绝不动权限位
    assert.equal(statSync(join(sidecar, 'mihomo')).mode & 0o4000, 0)
    assert.match(out.output.trim(), /rc=1$/)
  })

  it('is a no-op when setuid is already present, without prompting', () => {
    writeCore('mihomo', 0o4755)
    const configPath = writeConfig('mihomo')
    const out = runBash(
      `source "${LIB}"; restore_core_setuid '${fakeApp}'; echo "rc=$?"`,
      { SPARKLE_APP_CONFIG_PATH: configPath, SPARKLE_NONINTERACTIVE: '1' }
    )
    assert.match(out.output, /setuid already intact/)
    assert.match(out.output.trim(), /rc=0$/)
  })

  it('fails loudly when the sidecar directory is missing', () => {
    const configPath = writeConfig('mihomo')
    const out = runBash(
      `source "${LIB}"; restore_core_setuid '/nonexistent/Sparkle.app'; echo "rc=$?"`,
      { SPARKLE_APP_CONFIG_PATH: configPath, SPARKLE_NONINTERACTIVE: '1' }
    )
    assert.match(out.output, /missing sidecar dir/)
    assert.match(out.output.trim(), /rc=1$/)
  })
})
