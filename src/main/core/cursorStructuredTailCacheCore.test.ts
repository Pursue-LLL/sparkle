import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  readStructuredLogTailCached,
  resetStructuredLogTailCacheForTests,
} from './cursorStructuredTailCacheCore'

describe('cursorStructuredTailCacheCore', () => {
  it('reuses cached tail when mtime and size unchanged', async () => {
    resetStructuredLogTailCacheForTests()
    let readCount = 0
    const text = await readStructuredLogTailCached(
      '/tmp/structured.log',
      1024,
      async () => {
        readCount += 1
        return 'line-a\n'
      },
      async () => ({ mtimeMs: 100, size: 10 }),
    )
    assert.equal(text, 'line-a\n')
    assert.equal(readCount, 1)

    const cached = await readStructuredLogTailCached(
      '/tmp/structured.log',
      1024,
      async () => {
        readCount += 1
        return 'line-b\n'
      },
      async () => ({ mtimeMs: 100, size: 10 }),
    )
    assert.equal(cached, 'line-a\n')
    assert.equal(readCount, 1)
  })

  it('re-reads when size changes even if mtime unchanged', async () => {
    resetStructuredLogTailCacheForTests()
    let size = 10
    let readCount = 0
    await readStructuredLogTailCached(
      '/tmp/structured-size.log',
      1024,
      async () => {
        readCount += 1
        return 'v1\n'
      },
      async () => ({ mtimeMs: 200, size }),
    )
    size = 20
    const text = await readStructuredLogTailCached(
      '/tmp/structured-size.log',
      1024,
      async () => {
        readCount += 1
        return 'v2\n'
      },
      async () => ({ mtimeMs: 200, size }),
    )
    assert.equal(text, 'v2\n')
    assert.equal(readCount, 2)
  })
})
