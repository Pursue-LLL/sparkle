import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveLeafFailoverTarget } from './recoveryLeafFailoverCore'

describe('recoveryLeafFailoverCore @phase1', () => {
  it('prefers DIRECT when HY2 fails, avoiding unstable public 自动选择 pool', () => {
    const target = resolveLeafFailoverTarget({
      failedLeafId: 'KR-VPS-HY2',
      availableMembers: ['KR-VPS-HY2', '自动选择', 'DIRECT'],
    })
    assert.equal(target, 'DIRECT')
  })

  it('skips failed leaf and returns undefined if only public pool remains', () => {
    const target = resolveLeafFailoverTarget({
      failedLeafId: 'KR-VPS-HY2',
      availableMembers: ['KR-VPS-HY2', '自动选择'],
    })
    assert.equal(target, undefined)
  })
})
