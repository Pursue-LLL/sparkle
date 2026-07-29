import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ensureDirectoryExists } from './logDirEnsureCore'

describe('logDirEnsureCore', () => {
  it('creates directory when missing', () => {
    const created: string[] = []
    ensureDirectoryExists(
      '/tmp/sparkle-test/logs',
      () => false,
      (path) => {
        created.push(path)
      },
    )
    assert.deepEqual(created, ['/tmp/sparkle-test/logs'])
  })

  it('skips mkdir when directory exists', () => {
    let mkdirCalls = 0
    ensureDirectoryExists(
      '/tmp/sparkle-test/logs',
      () => true,
      () => {
        mkdirCalls += 1
      },
    )
    assert.equal(mkdirCalls, 0)
  })
})
