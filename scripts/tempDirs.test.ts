// [INPUT] scripts/testing/tempDirs.ts::makeTempDir (POS: 脚本测试共用的临时目录，进程退出时自动删除)
// [OUTPUT] （无导出，仅测试）
// [POS] 证明 makeTempDir 的清理由进程退出兜底：正常结束与崩溃都不在系统临时目录里留目录。
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'

const TSX = path.resolve(import.meta.dirname, '../node_modules/.bin/tsx')
const HELPER = path.join(import.meta.dirname, 'testing/tempDirs.ts')

/** 子进程里建一个带文件的临时目录并打印路径，再按 `ending` 结束；返回该路径和退出码。 */
function runChild(ending: string): { dir: string; status: number | null } {
  const code = `import(${JSON.stringify(HELPER)}).then(({ makeTempDir }) => {
    const dir = makeTempDir('sparkle-tempdirs-test-')
    require('node:fs').writeFileSync(dir + '/f', 'x')
    console.log(dir)
    ${ending}
  })`
  const result = spawnSync(TSX, ['-e', code], { encoding: 'utf8' })
  return { dir: result.stdout.split('\n')[0], status: result.status }
}

describe('makeTempDir', () => {
  it('removes the directory when the process ends normally', () => {
    const { dir, status } = runChild('')
    assert.equal(status, 0)
    assert.match(dir, /sparkle-tempdirs-test-/)
    assert.equal(existsSync(dir), false)
  })

  it('removes the directory when the process dies from an uncaught exception', () => {
    const { dir, status } = runChild("setTimeout(() => { throw new Error('boom') }, 0)")
    assert.equal(status, 1)
    assert.match(dir, /sparkle-tempdirs-test-/)
    assert.equal(existsSync(dir), false)
  })
})
