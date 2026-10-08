import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildCorporateNameservers,
  CORPORATE_STATIC_NAMESERVERS,
  parseDefaultInterface
} from './corporateDnsCore'

const STATIC = [...CORPORATE_STATIC_NAMESERVERS]

describe('corporateDnsCore', () => {
  it('parses the default interface from `route -n get default`', () => {
    const sample = `
   route to: default
destination: default
       mask: default
    gateway: 10.203.80.1
  interface: en0
      flags: <UP,GATEWAY,DONE,STATIC,PRCLONING,GLOBAL>
`
    assert.equal(parseDefaultInterface(sample), 'en0')
    assert.equal(parseDefaultInterface('route: writing to routing socket: not in table'), undefined)
  })

  it('follows the live DHCP lease of a physical default interface', () => {
    assert.deepEqual(buildCorporateNameservers('en0'), ['dhcp://en0', ...STATIC])
    assert.deepEqual(buildCorporateNameservers('en7'), ['dhcp://en7', ...STATIC])
  })

  it('falls back to static office resolvers when no physical interface is known', () => {
    assert.deepEqual(buildCorporateNameservers(undefined), STATIC)
    assert.deepEqual(buildCorporateNameservers('utun4'), STATIC)
    assert.deepEqual(buildCorporateNameservers('bridge0'), STATIC)
  })

  it('never derives resolvers from arbitrary private addresses', () => {
    for (const device of ['en0', 'utun4', undefined]) {
      const resolvers = buildCorporateNameservers(device).filter((s) => !s.startsWith('dhcp://'))
      assert.deepEqual(resolvers, STATIC)
    }
  })
})
