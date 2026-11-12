import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createListenerHub } from './listenerHub'

function createLifecycle(): {
  events: string[]
  lifecycle: { onFirstSubscribed: () => void; onLastUnsubscribed: () => void }
} {
  const events: string[] = []
  return {
    events,
    lifecycle: {
      onFirstSubscribed: () => {
        events.push('first')
      },
      onLastUnsubscribed: () => {
        events.push('last')
      }
    }
  }
}

describe('listener hub', () => {
  it('publishes to every subscriber', () => {
    const hub = createListenerHub<number>()
    const seen: string[] = []
    hub.subscribe((value) => seen.push(`a${value}`))
    hub.subscribe((value) => seen.push(`b${value}`))

    hub.publish(1)

    assert.deepEqual(seen, ['a1', 'b1'])
  })

  it('does not publish to a subscriber that has left', () => {
    const hub = createListenerHub<number>()
    const seen: number[] = []
    const leave = hub.subscribe((value) => seen.push(value))
    hub.publish(1)
    leave()
    hub.publish(2)

    assert.deepEqual(seen, [1])
  })

  it('keeps publishing when one subscriber throws', () => {
    const hub = createListenerHub<string>()
    const seen: string[] = []
    hub.subscribe(() => {
      throw new Error('bad subscriber')
    })
    hub.subscribe((value) => seen.push(value))

    hub.publish('x')

    assert.deepEqual(seen, ['x'])
  })

  it('notifies the lifecycle on the first subscriber and after the last one leaves', () => {
    const { events, lifecycle } = createLifecycle()
    const hub = createListenerHub<number>(lifecycle)

    const leaveA = hub.subscribe(() => undefined)
    const leaveB = hub.subscribe(() => undefined)
    assert.deepEqual(events, ['first'])

    leaveA()
    assert.deepEqual(events, ['first'])
    leaveB()
    assert.deepEqual(events, ['first', 'last'])
  })

  it('starts again for a new generation of subscribers', () => {
    const { events, lifecycle } = createLifecycle()
    const hub = createListenerHub<number>(lifecycle)

    hub.subscribe(() => undefined)()
    hub.subscribe(() => undefined)()

    assert.deepEqual(events, ['first', 'last', 'first', 'last'])
  })

  it('ignores repeated unsubscribes', () => {
    const { events, lifecycle } = createLifecycle()
    const hub = createListenerHub<number>(lifecycle)
    const leave = hub.subscribe(() => undefined)

    leave()
    leave()

    assert.deepEqual(events, ['first', 'last'])
  })

  it('counts the same function subscribed twice as one subscriber', () => {
    const { events, lifecycle } = createLifecycle()
    const hub = createListenerHub<number>(lifecycle)
    const listener = (): void => undefined

    const leave = hub.subscribe(listener)
    hub.subscribe(listener)
    assert.deepEqual(events, ['first'])

    leave()
    assert.deepEqual(events, ['first', 'last'])
  })

  it('works without a lifecycle', () => {
    const hub = createListenerHub<number>()

    assert.doesNotThrow(() => {
      hub.subscribe(() => undefined)()
    })
  })
})
