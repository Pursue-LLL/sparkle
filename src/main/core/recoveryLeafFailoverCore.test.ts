import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveLeafFailoverTarget } from './recoveryLeafFailoverCore'

describe('recoveryLeafFailoverCore @phase1', () => {
  it('prefers JP-VPS-TLS over Reality when HY2 fails', () => {
    const target = resolveLeafFailoverTarget({
      failedLeafId: 'JP-VPS-HY2',
      availableMembers: ['JP-VPS-HY2', 'JP-VPS-Reality', 'JP-VPS-TLS', 'DIRECT'],
    })
    assert.equal(target, 'JP-VPS-TLS')
  })

  it('skips failed leaf', () => {
    const target = resolveLeafFailoverTarget({
      failedLeafId: 'JP-VPS-HY2',
      availableMembers: ['JP-VPS-HY2', '自动选择'],
    })
    assert.equal(target, '自动选择')
  })
})
