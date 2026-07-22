import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyMarathonDialToleranceToProxies,
  MARATHON_DIAL_TIMEOUT_MARATHON_SEC,
  MARATHON_DIAL_TIMEOUT_NORMAL_SEC,
  shouldEnableMarathonDialTolerance,
} from './marathonDialToleranceCore'

describe('marathonDialToleranceCore', () => {
  const proxies = [
    { name: 'JP-VPS-HY2', type: 'hysteria2', server: '1.2.3.4' },
    { name: 'Commercial-1', type: 'ss', server: '9.9.9.9' },
  ]

  it('enables marathon dial-timeout at conn>=12', () => {
    assert.equal(shouldEnableMarathonDialTolerance(11), false)
    assert.equal(shouldEnableMarathonDialTolerance(12), true)
    const result = applyMarathonDialToleranceToProxies(proxies, 30)
    assert.equal(result.changed, true)
    assert.equal(result.dialTimeoutSec, MARATHON_DIAL_TIMEOUT_MARATHON_SEC)
    assert.equal(
      (result.proxies[0] as Record<string, unknown>)['dial-timeout'],
      MARATHON_DIAL_TIMEOUT_MARATHON_SEC,
    )
    assert.equal((result.proxies[1] as Record<string, unknown>)['dial-timeout'], undefined)
  })

  it('restores normal dial-timeout when load drops', () => {
    const marathon = applyMarathonDialToleranceToProxies(proxies, 20)
    const normal = applyMarathonDialToleranceToProxies(marathon.proxies, 5)
    assert.equal(normal.dialTimeoutSec, MARATHON_DIAL_TIMEOUT_NORMAL_SEC)
    assert.equal(normal.changed, true)
    assert.equal(
      (normal.proxies[0] as Record<string, unknown>)['dial-timeout'],
      MARATHON_DIAL_TIMEOUT_NORMAL_SEC,
    )
  })
})
