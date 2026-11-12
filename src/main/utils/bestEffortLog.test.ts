import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { bestEffortLog } from './bestEffortLog'

describe('bestEffortLog', () => {
  it('forwards the line to the wrapped logger', async () => {
    const lines: string[] = []
    const log = bestEffortLog(async (line) => {
      lines.push(line)
    })

    await log('hello\n')

    assert.deepEqual(lines, ['hello\n'])
  })

  it('resolves even when the wrapped logger rejects', async () => {
    const log = bestEffortLog(() => Promise.reject(new Error('disk full')))

    assert.equal(await log('hello\n'), undefined)
  })
})
