import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatMarathonHy2OnlySsotBootLogLine,
  filterMarathonCursorEligibleVpsLeaves,
  isDeniedMarathonProtocolUpgradeToTls,
  isMarathonTlsCanaryLeaf,
  shouldRecoverTlsLeafToHy2,
} from './marathonHy2OnlyCore.js'

describe('marathonHy2OnlyCore', () => {
  it('identifies KR-VPS-TLS as marathon TLS canary leaf', () => {
    assert.equal(isMarathonTlsCanaryLeaf('KR-VPS-TLS'), true)
    assert.equal(isMarathonTlsCanaryLeaf('KR-VPS-HY2'), false)
  })

  it('denies HY2 to TLS protocol upgrade', () => {
    assert.equal(
      isDeniedMarathonProtocolUpgradeToTls('KR-VPS-HY2', 'KR-VPS-TLS'),
      true,
    )
  })

  it('does not deny TLS to HY2 downgrade', () => {
    assert.equal(
      isDeniedMarathonProtocolUpgradeToTls('KR-VPS-TLS', 'KR-VPS-HY2'),
      false,
    )
  })

  it('flags TLS leaf for HY2 recovery', () => {
    assert.equal(shouldRecoverTlsLeafToHy2('KR-VPS-TLS'), true)
    assert.equal(shouldRecoverTlsLeafToHy2('KR-VPS-HY2'), false)
  })

  it('formatMarathonHy2OnlySsotBootLogLine includes ssot_boot marker', () => {
    const line = formatMarathonHy2OnlySsotBootLogLine({ activeNode: 'KR-VPS-HY2' })
    assert.match(line, /ssot_boot/)
    assert.match(line, /deny_tls_upgrade=1/)
  })

  it('filterMarathonCursorEligibleVpsLeaves removes TLS canary', () => {
    assert.deepEqual(
      filterMarathonCursorEligibleVpsLeaves([
        'KR-VPS-HY2',
        'KR-VPS-TLS',
        'KR-VPS-Reality',
      ]),
      ['KR-VPS-HY2', 'KR-VPS-Reality'],
    )
  })
})
