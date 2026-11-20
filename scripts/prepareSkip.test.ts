// [INPUT] scripts/prepare.ts（被测脚本，作为子进程运行）·
//         testing/tempDirs::makeTempDir (POS: 脚本测试共用的临时目录，退出时自动删除)
// [OUTPUT] （无导出，仅测试）
// [POS] `SKIP_PREPARE=1` 的契约：在什么都没有的全新目录里也必须成功退出且不做任何事——CI 在下载内核之前就带着它装依赖。
import assert from 'node:assert/strict'
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { before, describe, it } from 'node:test'
import { makeTempDir } from './testing/tempDirs'

const PREPARE = path.join(import.meta.dirname, 'prepare.ts')

describe('prepare.ts with SKIP_PREPARE=1', () => {
  const freshCheckout = makeTempDir('sparkle-prepare-skip-')
  let result: SpawnSyncReturns<string>

  before(() => {
    result = spawnSync(process.execPath, [PREPARE], {
      cwd: freshCheckout,
      env: { ...process.env, SKIP_PREPARE: '1' },
      encoding: 'utf8'
    })
  })

  it('exits 0 in a fresh checkout that has no sidecar yet', () => {
    assert.equal(result.status, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`)
    assert.match(result.stdout, /Skipping prepare script/)
  })

  it('does nothing: the working directory is still empty afterwards', () => {
    assert.deepEqual(readdirSync(freshCheckout), [])
  })
})
