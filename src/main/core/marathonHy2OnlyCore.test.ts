import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isDeniedMarathonProtocolUpgradeToTls,
  isMarathonTlsCanaryLeaf,
  shouldRecoverTlsLeafToHy2,
} from './marathonHy2OnlyCore.js'

describe('marathonHy2OnlyCore', () => {
  it('identifies JP-VPS-TLS as marathon TLS canary leaf', () => {
    assert.equal(isMarathonTlsCanaryLeaf('JP-VPS-TLS'), true)
    assert.equal(isMarathonTlsCanaryLeaf('JP-VPS-HY2'), false)
  })

  it('denies HY2 to TLS protocol upgrade', () => {
    assert.equal(
      isDeniedMarathonProtocolUpgradeToTls('JP-VPS-HY2', 'JP-VPS-TLS'),
      true,
    )
  })

  it('does not deny TLS to HY2 downgrade', () => {
    assert.equal(
      isDeniedMarathonProtocolUpgradeToTls('JP-VPS-TLS', 'JP-VPS-HY2'),
      false,
    )
  })

  it('flags TLS leaf for HY2 recovery', () => {
    assert.equal(shouldRecoverTlsLeafToHy2('JP-VPS-TLS'), true)
    assert.equal(shouldRecoverTlsLeafToHy2('JP-VPS-HY2'), false)
  })
})
