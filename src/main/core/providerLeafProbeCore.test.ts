import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { listUnconfirmedLeafNames, mapWithConcurrency } from './providerLeafProbeCore'

const NOW = Date.parse('2026-10-09T10:40:00.000Z')
const GEMINI = 'https://gemini.google.com'
const at = (minutesAgo: number, delay: number): ControllerProxiesHistory => ({
  time: new Date(NOW - minutesAgo * 60_000).toISOString(),
  delay
})

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

describe('providerLeafProbeCore', () => {
  it('never runs more than the allowed number of tasks at once', async () => {
    let running = 0
    let peak = 0
    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async () => {
      running += 1
      peak = Math.max(peak, running)
      await sleep(5)
      running -= 1
    })
    assert.equal(peak, 3)
  })

  it('keeps going when a task throws', async () => {
    const done: number[] = []
    await mapWithConcurrency([1, 2, 3], 2, async (item) => {
      if (item === 2) throw new Error('probe failed')
      done.push(item)
    })
    assert.deepEqual(done.sort(), [1, 3])
  })

  it('lists only failed or untested leaves for re-probing', () => {
    const names = listUnconfirmedLeafNames(
      [
        { name: 'ok', history: [at(1, 200)] },
        { name: 'flaky', history: [at(6, 200), at(1, 0)] },
        { name: 'dead', history: [at(9, 200), at(6, 0), at(3, 0), at(1, 0)] },
        { name: 'new', history: [] },
        { name: 'missing' }
      ],
      GEMINI,
      NOW
    )
    assert.deepEqual(names, ['dead', 'new', 'missing'])
  })

  it('judges leaves by the probe url, not by samples of other urls', () => {
    const names = listUnconfirmedLeafNames(
      [
        {
          name: 'gemini-dead',
          history: [at(8, 320), at(7, 0), at(3, 310), at(2, 0), at(1, 305)],
          extra: {
            [GEMINI]: { alive: false, history: [at(7, 0), at(2, 0), at(1, 0)] },
            'http://www.gstatic.com/generate_204': { alive: true, history: [at(8, 320), at(3, 310)] }
          }
        },
        {
          name: 'gemini-ok',
          history: [at(2, 0), at(1, 220)],
          extra: { [GEMINI]: { alive: true, history: [at(1, 220)] } }
        }
      ],
      GEMINI,
      NOW
    )
    assert.deepEqual(names, ['gemini-dead'])
  })
})
