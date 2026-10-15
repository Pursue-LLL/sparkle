import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  collectNodeDelays,
  hasPreferredUrlSamples,
  hasSameNodeOrder,
  shouldAdoptLatencyOrder
} from './sparkleFastLatencyOrderCore'

const URL = 'https://gemini.google.com'

describe('sparkleFastLatencyOrderCore', () => {
  it('prefers the group probe url history and uses the median of recent successes', () => {
    const delays = collectNodeDelays(
      [
        {
          name: 'a',
          alive: true,
          history: [{ delay: 999 }],
          extra: { [URL]: { alive: true, history: [{ delay: 0 }, { delay: 300 }, { delay: 100 }, { delay: 200 }] } },
        },
        { name: 'b', alive: true, history: [{ delay: 0 }, { delay: 80 }] },
      ],
      URL,
    )
    assert.equal(delays.get('a'), 200)
    assert.equal(delays.get('b'), 80)
  })

  it('omits dead nodes and nodes without successful samples', () => {
    const delays = collectNodeDelays(
      [
        { name: 'dead', alive: false, history: [{ delay: 50 }] },
        { name: 'dead-for-url', alive: true, history: [{ delay: 50 }], extra: { [URL]: { alive: false } } },
        { name: 'timeout-only', alive: true, history: [{ delay: 0 }] },
        { name: 'no-history', alive: true },
      ],
      URL,
    )
    assert.equal(delays.size, 0)
  })

  it('compares node order by name', () => {
    assert.equal(hasSameNodeOrder([{ name: 'a' }, { name: 'b' }], [{ name: 'a' }, { name: 'b' }]), true)
    assert.equal(hasSameNodeOrder([{ name: 'a' }, { name: 'b' }], [{ name: 'b' }, { name: 'a' }]), false)
    assert.equal(hasSameNodeOrder([{ name: 'a' }], []), false)
  })

  it('distinguishes target-url probe samples from default gstatic history and rejects partial startup probes', () => {
    assert.equal(
      hasPreferredUrlSamples([{ name: 'a', alive: true, history: [{ delay: 50 }] }], URL),
      false
    )
    assert.equal(
      hasPreferredUrlSamples(
        [{ name: 'a', alive: true, extra: { [URL]: { alive: false, history: [{ delay: 0 }] } } }],
        URL
      ),
      false
    )
    assert.equal(
      hasPreferredUrlSamples(
        [{ name: 'a', alive: true, extra: { [URL]: { alive: true, history: [{ delay: 120 }] } } }],
        URL
      ),
      true
    )
    assert.equal(
      hasPreferredUrlSamples(
        [
          { name: 'a', alive: true, extra: { [URL]: { alive: true, history: [{ delay: 120 }] } } },
          { name: 'b', alive: true },
          { name: 'c', alive: true }
        ],
        URL
      ),
      false
    )
  })
})

describe('shouldAdoptLatencyOrder', () => {
  const delays = new Map([['a', 200], ['b', 90], ['c', 180]])

  it('adopts only when the new first node is clearly faster', () => {
    assert.equal(shouldAdoptLatencyOrder('a', 'b', delays), true)
    assert.equal(shouldAdoptLatencyOrder('a', 'c', delays), false)
    assert.equal(shouldAdoptLatencyOrder('b', 'b', delays), false)
  })

  it('adopts when the current first node has no sample', () => {
    assert.equal(shouldAdoptLatencyOrder('dead', 'a', delays), true)
    assert.equal(shouldAdoptLatencyOrder(undefined, 'a', delays), true)
  })

  it('never adopts an unsampled next node over a sampled current one', () => {
    assert.equal(shouldAdoptLatencyOrder('a', 'unknown', delays), false)
  })
})
