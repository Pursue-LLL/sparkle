import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CANONICAL_VPS_LEAVES_BY_REGION,
  isCanonicalVpsNodeName,
  isVpsRegionNodeName,
  resolveVpsRegionFromLeafNode,
} from './vpsCanonicalNodes'

describe('vpsCanonicalNodes', () => {
  it('resolveVpsRegionFromLeafNode maps HY2 leaf and region keys', () => {
    assert.equal(resolveVpsRegionFromLeafNode('KR-VPS-HY2'), 'KR-VPS')
    assert.equal(resolveVpsRegionFromLeafNode('KR-VPS-Reality'), null)
    assert.equal(resolveVpsRegionFromLeafNode('KR-VPS'), 'KR-VPS')
    assert.equal(resolveVpsRegionFromLeafNode('SG-01'), null)
  })

  it('lists canonical HY2-only leaves', () => {
    assert.ok(isVpsRegionNodeName('KR-VPS'))
    assert.ok(isCanonicalVpsNodeName('KR-VPS-HY2'))
    assert.equal(isCanonicalVpsNodeName('KR-VPS-TUIC'), false)
    assert.deepEqual(CANONICAL_VPS_LEAVES_BY_REGION['KR-VPS'], ['KR-VPS-HY2'])
  })
})
