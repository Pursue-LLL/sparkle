// [INPUT] scripts/deepSignMac.cjs（被测钩子，按 electron-builder.yml 的 afterSign 路径加载并真实执行）·
//         testing/tempDirs::makeTempDir (POS: 脚本测试共用的临时目录，退出时自动删除) · js-yaml::load (POS: 解析 electron-builder.yml)
// [OUTPUT] （无导出，仅测试）
// [POS] afterSign 重签钩子的行为测试：只对 macOS 目标重签；electron-builder 在 Windows 目标上同样会触发 afterSign，那里没有 codesign，钩子不得去调用。
import assert from 'node:assert/strict'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { load } from 'js-yaml'
import { makeTempDir } from './testing/tempDirs'

interface AfterSignContext {
  electronPlatformName: string
  appOutDir: string
  packager: { appInfo: { productFilename: string } }
}

type AfterSignHook = (context: AfterSignContext) => Promise<void>

const ROOT = path.resolve(import.meta.dirname, '..')

/** electron-builder 按 electron-builder.yml 里的 afterSign 路径加载钩子（取模块的默认导出）；测试走同一条路径。 */
function loadConfiguredHook(): AfterSignHook {
  const config = load(readFileSync(path.join(ROOT, 'electron-builder.yml'), 'utf8')) as {
    afterSign?: string
  }
  assert.ok(config.afterSign, 'electron-builder.yml must configure afterSign')
  const loaded = createRequire(import.meta.url)(path.resolve(ROOT, config.afterSign)) as {
    default: AfterSignHook
  }
  assert.equal(typeof loaded.default, 'function')
  return loaded.default
}

const hook = loadConfiguredHook()
const originalPath = process.env.PATH ?? ''
let workDir = ''
let callLog = ''

/** 放进 PATH 的假 codesign / xattr：只把「工具名 + 参数」追加进日志，不碰任何文件。 */
beforeEach(() => {
  workDir = makeTempDir('sparkle-after-sign-')
  callLog = path.join(workDir, 'calls.log')
  for (const tool of ['codesign', 'xattr']) {
    const file = path.join(workDir, tool)
    writeFileSync(file, `#!/bin/sh\necho "${tool} $*" >> "${callLog}"\n`)
    chmodSync(file, 0o755)
  }
  process.env.PATH = `${workDir}${path.delimiter}${originalPath}`
})

afterEach(() => {
  process.env.PATH = originalPath
})

function contextFor(electronPlatformName: string): AfterSignContext {
  return {
    electronPlatformName,
    appOutDir: path.join(workDir, 'out'),
    packager: { appInfo: { productFilename: 'Sparkle' } }
  }
}

describe('afterSign hook', () => {
  it('re-signs the app bundle and clears its extended attributes on macOS', async () => {
    await hook(contextFor('darwin'))
    const app = path.join(workDir, 'out', 'Sparkle.app')
    assert.equal(
      readFileSync(callLog, 'utf8'),
      `codesign --deep --force --sign - ${app}\nxattr -cr ${app}\n`
    )
  })

  for (const platform of ['win32', 'linux']) {
    it(`does not run codesign for a ${platform} package`, async () => {
      await hook(contextFor(platform))
      assert.equal(existsSync(callLog), false)
    })
  }
})
