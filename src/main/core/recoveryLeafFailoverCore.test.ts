import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveLeafFailoverTarget } from './recoveryLeafFailoverCore'

describe('recoveryLeafFailoverCore @phase1', () => {
  it('prefers 自动选择 when HY2 fails (HY2-only VPS)', () => {
    const target = resolveLeafFailoverTarget({
      failedLeafId: 'KR-VPS-HY2',
      availableMembers: ['KR-VPS-HY2', '自动选择', 'DIRECT'],
    })
    assert.equal(target, '自动选择')
  })

  it('skips failed leaf', () => {
    const target = resolveLeafFailoverTarget({
      failedLeafId: 'KR-VPS-HY2',
      availableMembers: ['KR-VPS-HY2', '自动选择'],
    })
    assert.equal(target, '自动选择')
  })
})
