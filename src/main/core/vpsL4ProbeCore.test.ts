import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildVpsL4ProbeResult,
  parseVpsL4CurlOutput
} from './vpsL4ProbeCore'

describe('vpsL4ProbeCore', () => {
  it('parses api2 and marketplace curl lines', () => {
    const parsed = parseVpsL4CurlOutput(
      'api2 0.595200 200\nmarketplace 0.249000 200\n'
    )
    assert.equal(parsed.api2?.httpCode, 200)
    assert.equal(parsed.marketplace?.httpCode, 200)
    assert.ok((parsed.api2?.timeTotalSec ?? 0) > 0.5)
  })

  it('builds ok result when both curls succeed', () => {
    const result = buildVpsL4ProbeResult(
      'kr-vps',
      'KR-VPS',
      'api2 0.621000 200\nmarketplace 0.249000 200\n',
      ''
    )
    assert.equal(result.api2Ok, true)
    assert.equal(result.marketplaceOk, true)
    assert.equal(result.api2LatencyMs, 621)
  })

  it('marks failure when api2 line missing', () => {
    const result = buildVpsL4ProbeResult('jp-vps', 'JP-VPS', 'marketplace 0.200000 200\n', '')
    assert.equal(result.api2Ok, false)
    assert.match(result.errorDetail ?? '', /missing api2/)
  })
})
