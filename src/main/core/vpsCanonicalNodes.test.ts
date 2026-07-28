import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CANONICAL_VPS_LEAVES_BY_REGION,
  isVpsRegionNodeName,
  resolveVpsRegionFromLeafNode,
} from './vpsCanonicalNodes'

describe('vpsCanonicalNodes', () => {
  it('resolveVpsRegionFromLeafNode maps leaves and region keys', () => {
    assert.equal(resolveVpsRegionFromLeafNode('JP-VPS-HY2'), 'JP-VPS')
    assert.equal(resolveVpsRegionFromLeafNode('KR-VPS-TUIC'), null)
    assert.equal(resolveVpsRegionFromLeafNode('JP-VPS'), 'JP-VPS')
    assert.equal(resolveVpsRegionFromLeafNode('SG-01'), null)
  })

  it('lists canonical leaves per region', () => {
    assert.ok(isVpsRegionNodeName('JP-VPS'))
    assert.equal(CANONICAL_VPS_LEAVES_BY_REGION['JP-VPS'].length, 4)
  })
})
