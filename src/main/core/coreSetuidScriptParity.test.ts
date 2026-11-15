import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { computeMacOs26MitigationPatch } from '../sys/macos26ElectronMitigationCore'
import { type CorePermissionMode, requiresCoreSetuid } from './tunStartupGuardCore'

/**
 * 契约测试：安装脚本（scripts/lib/core-setuid.sh）判断「新包启动后内核是否需要 setuid」
 * 必须与 App 自己的判定一致——App 的启动守卫据此决定要不要提权，安装脚本据此决定要不要弹密码框。
 * 两边口径不同就会出现「安装补了没人要的 setuid」或「安装漏补、App 启动再弹框」。
 * 放在 src 下是因为 scripts 是 ESM，无法静态导入 src 里的 CJS 模块。
 */

const CORE_SETUID_LIB = resolve(__dirname, '../../../scripts/lib/core-setuid.sh')
const workdir = mkdtempSync(join(tmpdir(), 'sparkle-setuid-parity-'))

interface Scenario {
  tunEnabled: boolean
  configuredMode: CorePermissionMode | undefined
  /** `uname -r` 的值：24.x 是 macOS 15，25.x 是 macOS 26。 */
  darwinRelease: string
  serviceBinaryShipped: boolean
}

/** App 的有效模式：init.ts 先套用 macOS 26 缓解补丁，补丁没改的字段保持配置值（默认 elevated）。 */
function appEffectiveMode(scenario: Scenario): CorePermissionMode {
  const patch = computeMacOs26MitigationPatch({
    platform: 'darwin',
    release: scenario.darwinRelease,
    disableGPU: true,
    corePermissionMode: scenario.configuredMode ?? 'elevated',
    sparkleServiceBinaryExists: scenario.serviceBinaryShipped
  })
  return patch.corePermissionMode ?? scenario.configuredMode ?? 'elevated'
}

/** 在临时目录里还原这个场景：配置文件与（是否带 sparkle-service 的）App 包。 */
function materialize(scenario: Scenario, index: number): { app: string; appData: string } {
  const root = join(workdir, String(index))
  const app = join(root, 'Sparkle.app')
  const appData = join(root, 'data')
  mkdirSync(join(app, 'Contents/Resources/files'), { recursive: true })
  mkdirSync(appData, { recursive: true })
  if (scenario.serviceBinaryShipped) {
    const binary = join(app, 'Contents/Resources/files/sparkle-service')
    writeFileSync(binary, 'binary')
    chmodSync(binary, 0o755)
  }
  const configLines = ['core: mihomo']
  if (scenario.configuredMode) configLines.push(`corePermissionMode: ${scenario.configuredMode}`)
  writeFileSync(join(appData, 'config.yaml'), `${configLines.join('\n')}\n`)
  writeFileSync(join(appData, 'mihomo.yaml'), `tun:\n  enable: ${scenario.tunEnabled}\n`)
  return { app, appData }
}

function scriptVerdict(scenario: Scenario, index: number): { mode: string; required: boolean } {
  const { app, appData } = materialize(scenario, index)
  // 用同名函数替换 uname，让脚本以为自己跑在指定的 Darwin 版本上；其余命令是真的。
  const output = execFileSync(
    '/bin/bash',
    [
      '-c',
      `uname() { echo "${scenario.darwinRelease}"; }
       source "${CORE_SETUID_LIB}"
       echo "$(effective_core_permission_mode "${app}")"
       if core_setuid_required "${app}"; then echo yes; else echo no; fi`
    ],
    {
      env: { PATH: '/usr/bin:/bin', HOME: workdir, SPARKLE_APP_DATA_DIR: appData },
      encoding: 'utf8'
    }
  )
  const [mode, required] = output.trim().split('\n')
  return { mode, required: required === 'yes' }
}

describe('core-setuid.sh vs the app’s own setuid requirement', () => {
  const MODES: Array<CorePermissionMode | undefined> = ['elevated', 'service', undefined]
  const scenarios: Scenario[] = []
  for (const tunEnabled of [true, false]) {
    for (const configuredMode of MODES) {
      for (const darwinRelease of ['24.6.0', '25.5.0']) {
        for (const serviceBinaryShipped of [true, false]) {
          scenarios.push({ tunEnabled, configuredMode, darwinRelease, serviceBinaryShipped })
        }
      }
    }
  }
  let verdicts: Array<{ mode: string; required: boolean }> = []

  before(() => {
    verdicts = scenarios.map(scriptVerdict)
  })
  after(() => rmSync(workdir, { recursive: true, force: true }))

  it('covers every combination of TUN, configured mode, macOS generation and shipped service binary', () => {
    assert.equal(scenarios.length, 24)
    assert.equal(verdicts.length, 24)
  })

  it('agrees on the effective permission mode in every scenario', () => {
    scenarios.forEach((scenario, index) => {
      assert.equal(verdicts[index].mode, appEffectiveMode(scenario), JSON.stringify(scenario))
    })
  })

  it('agrees on whether the core needs setuid in every scenario', () => {
    scenarios.forEach((scenario, index) => {
      const expected = requiresCoreSetuid({
        tunEnabled: scenario.tunEnabled,
        corePermissionMode: appEffectiveMode(scenario)
      })
      assert.equal(verdicts[index].required, expected, JSON.stringify(scenario))
    })
  })

  it('is not vacuous: some scenarios need setuid and some do not', () => {
    const required = verdicts.filter((verdict) => verdict.required).length
    assert.ok(required > 0 && required < verdicts.length, `${required} of ${verdicts.length}`)
  })
})
