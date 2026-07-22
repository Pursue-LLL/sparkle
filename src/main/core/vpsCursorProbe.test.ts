import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CANONICAL_VPS_NODE_PATTERN, isCanonicalVpsNodeName } from './vpsCanonicalNodes'

describe('vpsCursorProbe', () => {
  it('matches managed VPS transport node names', () => {
    const canonical = [
      'KR-VPS-Reality',
      'KR-VPS-HY2',
      'KR-VPS-TUIC',
      'JP-VPS-Reality',
      'JP-VPS-TLS',
      'JP-VPS-HY2',
      'JP-VPS-TUIC',
      'KR-VPS-Reality-backup'
    ]
    for (const name of canonical) {
      assert.equal(CANONICAL_VPS_NODE_PATTERN.test(name), true)
      assert.equal(isCanonicalVpsNodeName(name), true)
    }
  })

  it('rejects non-canonical VPS or commercial names', () => {
    const rejected = [
      'KR-VPS-Other',
      'SG-VPS-Reality',
      'SG-VPS-Other',
      'c7sg-vps-01',
      '🇸🇬新加坡-01 S 1.0x',
      'Cursor-专用'
    ]
    for (const name of rejected) {
      assert.equal(isCanonicalVpsNodeName(name), false)
    }
  })
})
