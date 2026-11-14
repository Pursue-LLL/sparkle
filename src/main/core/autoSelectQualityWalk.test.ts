import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  describeReading,
  walkForQualifiedNode,
  type ProbeRole,
  type WalkContext
} from './autoSelectQualityWalk'
import {
  ADMISSION_KBPS,
  DEGRADED_KBPS,
  MAX_UNMEASURED_FAILURES,
  type ThroughputReading
} from './sparkleNodeQualityCore'

const measured = (kbps: number): ThroughputReading => ({ kind: 'measured', kbps })
const FAILED: ThroughputReading = { kind: 'failed' }
const UNAVAILABLE: ThroughputReading = { kind: 'unavailable' }
const GOOD = measured(ADMISSION_KBPS + 100)

type Script = Record<string, Partial<Record<ProbeRole, ThroughputReading>>>

/** 按脚本回放读数；脚本里没写的读数视为没数据。 */
function rig(script: Script, overrides: Partial<WalkContext> = {}) {
  const calls: string[] = []
  const context: WalkContext = {
    measure: async (node, role) => {
      calls.push(`${role}:${node}`)
      return script[node]?.[role] ?? FAILED
    },
    isRegionEligible: async () => true,
    isAdmittedRecently: () => false,
    isCancelled: () => false,
    ...overrides
  }
  return { context, calls }
}

describe('walkForQualifiedNode', () => {
  describe('a candidate that passes', () => {
    it('is the first one that clears the admission line on both targets', async () => {
      const { context, calls } = rig({
        A: { primary: measured(ADMISSION_KBPS), control: measured(DEGRADED_KBPS) },
        B: { primary: GOOD, control: GOOD }
      })

      const outcome = await walkForQualifiedNode(['A', 'B'], context)

      assert.deepEqual(outcome, {
        kind: 'passed',
        node: 'A',
        detail: `google ${ADMISSION_KBPS} KB/s, control ${DEGRADED_KBPS} KB/s`,
        rejected: []
      })
      assert.deepEqual(calls, ['primary:A', 'control:A'], 'later candidates are never measured')
    })

    it('does not need the control site to answer', async () => {
      for (const control of [FAILED, UNAVAILABLE]) {
        const { context } = rig({ A: { primary: GOOD, control } })

        const outcome = await walkForQualifiedNode(['A'], context)

        assert.equal(outcome.kind, 'passed')
      }
    })

    it('reports what it had to skip on the way', async () => {
      const { context } = rig({
        A: { primary: measured(40) },
        B: { primary: GOOD, control: GOOD }
      })

      const outcome = await walkForQualifiedNode(['A', 'B'], context)

      assert.deepEqual(outcome, {
        kind: 'passed',
        node: 'B',
        detail: `google ${ADMISSION_KBPS + 100} KB/s, control ${ADMISSION_KBPS + 100} KB/s`,
        rejected: [{ node: 'A', detail: 'google 40 KB/s', degraded: true }]
      })
    })
  })

  describe('a candidate that is turned down', () => {
    it('is skipped when the primary reading is below the admission line, even by one', async () => {
      const { context, calls } = rig({
        A: { primary: measured(ADMISSION_KBPS - 1), control: GOOD },
        B: { primary: GOOD, control: GOOD }
      })

      const outcome = await walkForQualifiedNode(['A', 'B'], context)

      assert.equal(outcome.kind === 'passed' && outcome.node, 'B')
      assert.ok(
        !calls.includes('control:A'),
        'the control site is only asked after the primary passed'
      )
    })

    it('is skipped when the primary has no data at all', async () => {
      const { context } = rig({ A: { primary: FAILED }, B: { primary: GOOD, control: GOOD } })

      const outcome = await walkForQualifiedNode(['A', 'B'], context)

      assert.deepEqual(outcome.kind === 'passed' && outcome.rejected, [
        { node: 'A', detail: 'google no data', degraded: true }
      ])
    })

    it('is vetoed by a control reading below the degraded line, and counted as degraded', async () => {
      const { context } = rig({
        A: { primary: GOOD, control: measured(DEGRADED_KBPS - 1) },
        B: { primary: GOOD, control: GOOD }
      })

      const outcome = await walkForQualifiedNode(['A', 'B'], context)

      assert.deepEqual(outcome.kind === 'passed' && outcome.rejected, [
        {
          node: 'A',
          detail: `google ${ADMISSION_KBPS + 100} KB/s, control ${DEGRADED_KBPS - 1} KB/s`,
          degraded: true
        }
      ])
    })

    it('is not vetoed by a control reading inside the hysteresis band', async () => {
      const { context } = rig({ A: { primary: GOOD, control: measured(ADMISSION_KBPS - 1) } })

      const outcome = await walkForQualifiedNode(['A'], context)

      assert.equal(outcome.kind, 'passed')
    })

    it('is not called degraded while its primary reading sits in the hysteresis band', async () => {
      const { context } = rig({
        A: { primary: measured(DEGRADED_KBPS) },
        B: { primary: GOOD, control: GOOD }
      })

      const outcome = await walkForQualifiedNode(['A', 'B'], context)

      assert.deepEqual(outcome.kind === 'passed' && outcome.rejected, [
        { node: 'A', detail: `google ${DEGRADED_KBPS} KB/s`, degraded: false }
      ])
    })

    it('is called degraded one step below the degraded line', async () => {
      const { context } = rig({
        A: { primary: measured(DEGRADED_KBPS - 1) },
        B: { primary: GOOD, control: GOOD }
      })

      const outcome = await walkForQualifiedNode(['A', 'B'], context)

      assert.equal(outcome.kind === 'passed' && outcome.rejected[0].degraded, true)
    })
  })

  describe('when nobody passes', () => {
    it('ends exhausted and lists every candidate it measured', async () => {
      const { context } = rig({
        A: { primary: measured(30) },
        B: { primary: GOOD, control: measured(10) },
        C: { primary: measured(120) }
      })

      const outcome = await walkForQualifiedNode(['A', 'B', 'C'], context)

      assert.deepEqual(outcome, {
        kind: 'exhausted',
        rejected: [
          { node: 'A', detail: 'google 30 KB/s', degraded: true },
          {
            node: 'B',
            detail: `google ${ADMISSION_KBPS + 100} KB/s, control 10 KB/s`,
            degraded: true
          },
          { node: 'C', detail: 'google 120 KB/s', degraded: false }
        ]
      })
    })

    it('has nothing to say about an empty candidate list', async () => {
      const { context, calls } = rig({})

      assert.deepEqual(await walkForQualifiedNode([], context), { kind: 'exhausted', rejected: [] })
      assert.deepEqual(calls, [])
    })
  })

  describe('when the answer cannot be trusted', () => {
    it('stops at once when the probe channel is unavailable', async () => {
      const { context, calls } = rig({
        A: { primary: measured(30) },
        B: { primary: UNAVAILABLE },
        C: { primary: GOOD, control: GOOD }
      })

      const outcome = await walkForQualifiedNode(['A', 'B', 'C'], context)

      assert.deepEqual(outcome, {
        kind: 'unverified',
        reason: 'probe channel unavailable',
        rejected: [{ node: 'A', detail: 'google 30 KB/s', degraded: true }]
      })
      assert.deepEqual(calls, ['primary:A', 'primary:B'])
    })

    it('gives up after enough candidates in a row returned no data at all', async () => {
      const nodes = Array.from({ length: MAX_UNMEASURED_FAILURES + 2 }, (_, i) => `N${i}`)
      const { context, calls } = rig({
        [nodes[MAX_UNMEASURED_FAILURES]]: { primary: GOOD, control: GOOD }
      })

      const outcome = await walkForQualifiedNode(nodes, context)

      assert.equal(outcome.kind, 'unverified')
      assert.equal(calls.length, MAX_UNMEASURED_FAILURES, 'it stops right at the limit')
    })

    it('one fewer failure than the limit keeps looking', async () => {
      const nodes = Array.from({ length: MAX_UNMEASURED_FAILURES }, (_, i) => `N${i}`)
      const { context } = rig({
        [nodes[MAX_UNMEASURED_FAILURES - 1]]: { primary: GOOD, control: GOOD }
      })

      const outcome = await walkForQualifiedNode(nodes, context)

      assert.equal(outcome.kind, 'passed')
    })

    it('keeps looking through no-data candidates once any candidate gave a real reading', async () => {
      const nodes = [
        'A',
        ...Array.from({ length: MAX_UNMEASURED_FAILURES + 1 }, (_, i) => `N${i}`),
        'Z'
      ]
      const { context } = rig({ A: { primary: measured(30) }, Z: { primary: GOOD, control: GOOD } })

      const outcome = await walkForQualifiedNode(nodes, context)

      assert.equal(outcome.kind === 'passed' && outcome.node, 'Z')
    })

    it('counts a vetoed candidate as a real reading, not as missing data', async () => {
      const nodes = [
        'A',
        ...Array.from({ length: MAX_UNMEASURED_FAILURES }, (_, i) => `N${i}`),
        'Z'
      ]
      const { context } = rig({
        A: { primary: GOOD, control: measured(5) },
        Z: { primary: GOOD, control: GOOD }
      })

      const outcome = await walkForQualifiedNode(nodes, context)

      assert.equal(outcome.kind === 'passed' && outcome.node, 'Z')
    })
  })

  describe('region and memory', () => {
    it('skips a restricted candidate without measuring or rejecting it', async () => {
      const { context, calls } = rig(
        { A: { primary: GOOD, control: GOOD }, B: { primary: GOOD, control: GOOD } },
        { isRegionEligible: async (node) => node !== 'A' }
      )

      const outcome = await walkForQualifiedNode(['A', 'B'], context)

      assert.equal(outcome.kind === 'passed' && outcome.node, 'B')
      assert.equal(outcome.kind === 'passed' && outcome.rejected.length, 0)
      assert.deepEqual(calls, ['primary:B', 'control:B'])
    })

    it('passes a node admitted moments ago without measuring it again', async () => {
      const { context, calls } = rig({}, { isAdmittedRecently: (node) => node === 'A' })

      const outcome = await walkForQualifiedNode(['A'], context)

      assert.equal(outcome.kind === 'passed' && outcome.node, 'A')
      assert.deepEqual(calls, [])
    })

    it('still refuses a recently admitted node that turned out to be in a restricted region', async () => {
      const { context } = rig(
        { B: { primary: GOOD, control: GOOD } },
        {
          isAdmittedRecently: (node) => node === 'A',
          isRegionEligible: async (node) => node !== 'A'
        }
      )

      const outcome = await walkForQualifiedNode(['A', 'B'], context)

      assert.equal(outcome.kind === 'passed' && outcome.node, 'B')
    })
  })

  describe('cancellation', () => {
    it('stops before the next candidate once cancelled', async () => {
      let cancelled = false
      const { context, calls } = rig(
        { A: { primary: measured(30) }, B: { primary: GOOD, control: GOOD } },
        { isCancelled: () => cancelled }
      )
      const inner = context.measure
      context.measure = async (node, role) => {
        const reading = await inner(node, role)
        cancelled = true
        return reading
      }

      const outcome = await walkForQualifiedNode(['A', 'B'], context)

      assert.deepEqual(outcome, { kind: 'cancelled' })
      assert.deepEqual(calls, ['primary:A'])
    })

    it('does not start at all when already cancelled', async () => {
      const { context, calls } = rig({}, { isCancelled: () => true })

      assert.deepEqual(await walkForQualifiedNode(['A'], context), { kind: 'cancelled' })
      assert.deepEqual(calls, [])
    })
  })
})

describe('describeReading', () => {
  it('rounds a measured rate to whole KB/s', () => {
    assert.equal(describeReading(measured(82.6)), '83 KB/s')
  })

  it('names the two readings that carry no rate', () => {
    assert.equal(describeReading(FAILED), 'no data')
    assert.equal(describeReading(UNAVAILABLE), 'unavailable')
  })
})
