// [INPUT] scripts/beforePack.ts::assertSidecarPresent / beforePack (POS: 打包边界的内核校验) ·
//         electron-builder.yml（beforePack 的挂接配置）· prepare.ts（内核文件名的来源）·
//         testing/tempDirs::makeTempDir (POS: 脚本测试共用的临时目录，退出时自动删除) · js-yaml::load (POS: 解析 electron-builder.yml)
// [OUTPUT] （无导出，仅测试）
// [POS] 打包边界内核校验的行为测试：内核缺失、为空、是目录、各平台文件名，以及它确实挂在 electron-builder 的配置上。
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { pathToFileURL } from 'node:url'
import { load } from 'js-yaml'
import beforePack, { assertSidecarPresent } from './beforePack'
import { makeTempDir } from './testing/tempDirs'

const ROOT = path.resolve(import.meta.dirname, '..')

/** 临时项目目录；`sidecar` 里每一项是 extra/sidecar 下的一个文件名与内容。 */
function makeProject(sidecar: Record<string, string> = {}): string {
  const projectDir = makeTempDir('sparkle-before-pack-')
  if (Object.keys(sidecar).length > 0) {
    const dir = path.join(projectDir, 'extra', 'sidecar')
    mkdirSync(dir, { recursive: true })
    for (const [name, content] of Object.entries(sidecar)) {
      writeFileSync(path.join(dir, name), content)
    }
  }
  return projectDir
}

describe('assertSidecarPresent', () => {
  for (const platform of ['darwin', 'linux']) {
    it(`accepts a non-empty mihomo on ${platform}`, () => {
      assert.doesNotThrow(() => assertSidecarPresent(makeProject({ mihomo: 'core' }), platform))
    })
  }

  it('says which file is missing and how to get it when extra/ does not exist', () => {
    assert.throws(
      () => assertSidecarPresent(makeProject(), 'darwin'),
      (error: Error) => {
        assert.match(error.message, /extra[\\/]sidecar[\\/]mihomo is missing or empty/)
        assert.match(error.message, /node scripts\/prepare\.ts/)
        return true
      }
    )
  })

  it('rejects an empty file, which is what an interrupted download leaves behind', () => {
    assert.throws(
      () => assertSidecarPresent(makeProject({ mihomo: '' }), 'linux'),
      /missing or empty/
    )
  })

  it('rejects a directory that happens to be named mihomo', () => {
    const projectDir = makeProject()
    mkdirSync(path.join(projectDir, 'extra', 'sidecar', 'mihomo'), { recursive: true })
    assert.throws(() => assertSidecarPresent(projectDir, 'darwin'), /missing or empty/)
  })

  it('wants mihomo.exe on Windows and does not accept the bare name there', () => {
    assert.doesNotThrow(() => assertSidecarPresent(makeProject({ 'mihomo.exe': 'core' }), 'win32'))
    assert.throws(
      () => assertSidecarPresent(makeProject({ mihomo: 'core' }), 'win32'),
      /extra[\\/]sidecar[\\/]mihomo\.exe is missing or empty/
    )
  })

  it('does not take mihomo.exe for macOS or Linux', () => {
    const projectDir = makeProject({ 'mihomo.exe': 'core' })
    assert.throws(() => assertSidecarPresent(projectDir, 'darwin'), /missing or empty/)
    assert.throws(() => assertSidecarPresent(projectDir, 'linux'), /missing or empty/)
  })
})

describe('beforePack hook', () => {
  it('reads the project directory and the target platform from the electron-builder context', async () => {
    const projectDir = makeProject({ 'mihomo.exe': 'core' })
    await assert.doesNotReject(
      beforePack({ electronPlatformName: 'win32', packager: { projectDir } })
    )
    await assert.rejects(
      beforePack({ electronPlatformName: 'darwin', packager: { projectDir } }),
      /missing or empty/
    )
  })
})

describe('electron-builder wiring', () => {
  it('points beforePack at the module whose default export is the hook', async () => {
    const config = load(readFileSync(path.join(ROOT, 'electron-builder.yml'), 'utf8')) as {
      beforePack?: string
    }
    assert.ok(
      config.beforePack,
      'electron-builder.yml has no beforePack: the package could ship without the core'
    )
    const hookModule = (await import(
      pathToFileURL(path.resolve(ROOT, config.beforePack)).href
    )) as {
      default: unknown
    }
    assert.equal(hookModule.default, beforePack)
  })

  it('expects the file name that prepare.ts gives the core it downloads', () => {
    const prepare = readFileSync(path.join(ROOT, 'scripts', 'prepare.ts'), 'utf8')
    assert.match(
      prepare,
      /targetFile: `mihomo\$\{isWin \? '\.exe' : ''\}`/,
      'prepare.ts renamed the core file: update mihomoFileName in beforePack.ts to match'
    )
  })
})
