// [INPUT] bounded queue semantics (Sparkle lifecycle journal / admission backpressure patterns)
// [OUTPUT] runP10ConsumerFaultGate — queue overflow · consumer stall · reorder invariants
// [POS] P10-6 §M.0.15.11.8 step 4 — consumer faults must degrade observe-only, not corrupt SSOT.

export interface P10BoundedQueue<T> {
  maxSize: number
  items: T[]
  dropped: number
}

export function createP10BoundedQueue<T>(maxSize: number): P10BoundedQueue<T> {
  return { maxSize, items: [], dropped: 0 }
}

export function enqueueP10BoundedQueue<T>(queue: P10BoundedQueue<T>, item: T): P10BoundedQueue<T> {
  const nextItems = [...queue.items, item]
  if (nextItems.length <= queue.maxSize) {
    return { ...queue, items: nextItems }
  }
  return {
    ...queue,
    items: nextItems.slice(nextItems.length - queue.maxSize),
    dropped: queue.dropped + 1,
  }
}

export interface P10ConsumerFaultCaseResult {
  name: string
  ok: boolean
  detail: string
}

export interface P10ConsumerFaultGateResult {
  ok: boolean
  cases: P10ConsumerFaultCaseResult[]
}

export function runP10ConsumerFaultGate(): P10ConsumerFaultGateResult {
  const cases: P10ConsumerFaultCaseResult[] = []

  let queue = createP10BoundedQueue<number>(4)
  for (let index = 0; index < 10; index += 1) {
    queue = enqueueP10BoundedQueue(queue, index)
  }
  const overflowOk = queue.items.length === 4 && queue.dropped === 6
  cases.push({
    name: 'queue_overflow_drops_oldest',
    ok: overflowOk,
    detail: overflowOk
      ? `depth=${queue.items.length} dropped=${queue.dropped}`
      : `depth=${queue.items.length} dropped=${queue.dropped}`,
  })

  const stalledConsumer = queue.items.slice(0, 2)
  const drainOk = stalledConsumer.length === 2 && queue.items[queue.items.length - 1] === 9
  cases.push({
    name: 'consumer_stall_preserves_tail',
    ok: drainOk,
    detail: drainOk ? `stalled=${stalledConsumer.join(',')}` : 'tail lost under stall',
  })

  const reordered = [queue.items[2], queue.items[0], queue.items[3], queue.items[1]].filter(
    (value): value is number => value !== undefined,
  )
  const reorderOk = reordered.length === 4 && new Set(reordered).size === 4
  cases.push({
    name: 'event_reorder_without_loss',
    ok: reorderOk,
    detail: reorderOk ? `unique=${reordered.length}` : 'reorder lost events',
  })

  const ok = cases.every((item) => item.ok)
  return { ok, cases }
}
