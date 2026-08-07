import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  partitionGroupMembersForDelayTest,
  shouldRunManagedVpsGroupDelayTest,
} from './groupDelayTestCore'

describe('groupDelayTestCore', () => {
  it('splits Cursor dedicated members into VPS leaves vs DIRECT/others', () => {
    const partition = partitionGroupMembersForDelayTest([
      'DIRECT',
      'JP-VPS-HY2',
      'JP-VPS-TUIC',
      'JP-VPS-Reality',
    ])
    assert.deepEqual(partition.vpsLeafNames, ['JP-VPS-HY2', 'JP-VPS-TUIC', 'JP-VPS-Reality'])
    assert.deepEqual(partition.otherNames, ['DIRECT'])
    assert.equal(shouldRunManagedVpsGroupDelayTest(partition), true)
  })

  it('returns false for commercial-only groups', () => {
    const partition = partitionGroupMembersForDelayTest(['SG-01', '自动选择'])
    assert.deepEqual(partition.vpsLeafNames, [])
    assert.deepEqual(partition.otherNames, ['SG-01', '自动选择'])
    assert.equal(shouldRunManagedVpsGroupDelayTest(partition), false)
  })
})
