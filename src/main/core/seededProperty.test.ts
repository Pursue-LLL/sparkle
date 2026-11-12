import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createRandom, forSeeds, forSeedsAsync } from './seededProperty'

function sample(seed: number, count = 20): number[] {
  const random = createRandom(seed)
  return Array.from({ length: count }, () => random.next())
}

describe('createRandom', () => {
  it('replays the same sequence for the same seed and differs between seeds', () => {
    assert.deepEqual(sample(7), sample(7))
    const sequences = new Set(Array.from({ length: 64 }, (_, index) => sample(index + 1).join()))
    assert.equal(sequences.size, 64)
  })

  it('matches the public mulberry32 reference so recorded seeds replay across versions', () => {
    assert.deepEqual(sample(1, 3), [0.6270739405881613, 0.002735721180215478, 0.5274470399599522])
    assert.deepEqual(sample(42, 3), [0.6011037519201636, 0.44829055899754167, 0.8524657934904099])
  })

  it('stays inside [0, 1) and spreads evenly', () => {
    const values = sample(1, 10_000)

    assert.ok(values.every((value) => value >= 0 && value < 1))
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    assert.ok(Math.abs(mean - 0.5) < 0.02, `mean ${mean}`)
  })

  it('draws integers over the whole closed range', () => {
    const random = createRandom(3)

    const seen = new Set(Array.from({ length: 2000 }, () => random.int(-2, 3)))

    assert.deepEqual(
      [...seen].sort((a, b) => a - b),
      [-2, -1, 0, 1, 2, 3]
    )
  })

  it('picks every item and honours the probability of a chance', () => {
    const random = createRandom(5)

    const picked = new Set(Array.from({ length: 200 }, () => random.pick(['a', 'b', 'c'])))
    const hits = Array.from({ length: 10_000 }, () => random.chance(0.25)).filter(Boolean).length

    assert.equal(picked.size, 3)
    assert.ok(hits > 2300 && hits < 2700, `hits ${hits}`)
    assert.equal(random.chance(0), false)
    assert.equal(random.chance(1), true)
  })

  it('treats a draw equal to the probability as a miss', () => {
    const [draw] = sample(11, 1)

    assert.equal(createRandom(11).chance(draw), false)
    assert.deepEqual(createRandom(11).subset(['only'], draw), [])
  })

  it('keeps a random subset in the original order', () => {
    const random = createRandom(9)
    const items = [1, 2, 3, 4, 5, 6]

    assert.deepEqual(random.subset(items, 0), [])
    assert.deepEqual(random.subset(items, 1), items)
    for (let run = 0; run < 100; run++) {
      const subset = random.subset(items, 0.5)
      assert.deepEqual(
        subset,
        items.filter((item) => subset.includes(item))
      )
    }
  })
})

describe('forSeeds', () => {
  it('runs seeds 1..runs, each with its own generator', () => {
    const seen: [number, number][] = []

    forSeeds(5, (random, seed) => {
      seen.push([seed, random.next()])
    })

    assert.deepEqual(
      seen,
      [1, 2, 3, 4, 5].map((seed) => [seed, createRandom(seed).next()])
    )
  })

  it('names the failing seed, keeps the original error as the cause and stops there', () => {
    const original = new Error('boom')
    const ran: number[] = []

    assert.throws(
      () =>
        forSeeds(10, (_, seed) => {
          ran.push(seed)
          if (seed === 4) throw original
        }),
      (error: Error) => {
        assert.equal(error.message, 'seed 4: boom')
        assert.equal(error.cause, original)
        return true
      }
    )
    assert.deepEqual(ran, [1, 2, 3, 4])
  })
})

describe('forSeedsAsync', () => {
  it('awaits each run before starting the next', async () => {
    const order: string[] = []

    await forSeedsAsync(3, async (_, seed) => {
      order.push(`start ${seed}`)
      await Promise.resolve()
      order.push(`end ${seed}`)
    })

    assert.deepEqual(order, ['start 1', 'end 1', 'start 2', 'end 2', 'start 3', 'end 3'])
  })

  it('names the failing seed, keeps the original error as the cause and stops there', async () => {
    const original = new Error('late boom')
    const ran: number[] = []

    await assert.rejects(
      forSeedsAsync(10, async (_, seed) => {
        ran.push(seed)
        await Promise.resolve()
        if (seed === 2) throw original
      }),
      (error: Error) => {
        assert.equal(error.message, 'seed 2: late boom')
        assert.equal(error.cause, original)
        return true
      }
    )
    assert.deepEqual(ran, [1, 2])
  })
})
