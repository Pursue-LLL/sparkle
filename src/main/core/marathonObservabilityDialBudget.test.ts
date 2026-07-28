import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  getMarathonObservabilityDialBudgetQueueStateForTests,
  resetMarathonObservabilityDialBudgetQueueForTests,
  runMarathonObservabilityDialBudget,
} from './marathonObservabilityDialBudgetQueueCore'

const marathonContext = { cursorConnectionCount: 20, quiesceActive: true }

describe('marathonObservabilityDialBudgetQueueCore', () => {
  it('serializes transport_pair and user_explicit under budget', async () => {
    resetMarathonObservabilityDialBudgetQueueForTests()
    const order: string[] = []

    const transport = runMarathonObservabilityDialBudget(
      'transport_pair',
      marathonContext,
      async () => {
        order.push('transport_start')
        await new Promise((resolve) => setTimeout(resolve, 20))
        order.push('transport_end')
        return 'transport'
      },
    )
    const user = runMarathonObservabilityDialBudget('user_explicit', marathonContext, async () => {
      order.push('user_start')
      return 'user'
    })

    const [transportResult, userResult] = await Promise.all([transport, user])
    assert.equal(transportResult.outcome, 'ran')
    assert.equal(userResult.outcome, 'ran')
    assert.deepEqual(order, ['transport_start', 'transport_end', 'user_start'])
  })

  it('skips session_nudge when transport_pair is in flight', async () => {
    resetMarathonObservabilityDialBudgetQueueForTests()
    let releaseTransport!: () => void
    const transportGate = new Promise<void>((resolve) => {
      releaseTransport = resolve
    })

    const transport = runMarathonObservabilityDialBudget(
      'transport_pair',
      marathonContext,
      async () => {
        await transportGate
        return true
      },
    )
    await new Promise((resolve) => setTimeout(resolve, 5))
    const nudge = await runMarathonObservabilityDialBudget(
      'session_nudge',
      marathonContext,
      async () => true,
    )
    releaseTransport()
    await transport

    assert.equal(nudge.outcome, 'skipped_busy')
    assert.equal(nudge.value, null)
    assert.equal(getMarathonObservabilityDialBudgetQueueStateForTests().activeDialCount, 0)
  })
})
