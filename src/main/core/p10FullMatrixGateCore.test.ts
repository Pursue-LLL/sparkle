import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runP10ParallelComposerGate, P10_PARALLEL_COMPOSER_COUNTS } from './p10ParallelComposerGateCore'
import { runP10StockParityGate } from './p10StockParityGateCore'
import { runP10TunLatencyGate } from './p10TunLatencyGateCore'
import { runP10ConsumerFaultGate } from './p10ConsumerFaultGateCore'
import { runP10FaultInjectionGate } from './p10FaultInjectionGateCore'
import { runP10ReplayGate } from './p10ReplayGateCore'

describe('p10FullMatrixGateCore P10-6', () => {
  it('passes historical replay gate before expanded matrix', () => {
    const replay = runP10ReplayGate()
    assert.equal(replay.nextGateAllowed, true, replay.verdicts.map((v) => v.detail).join(';'))
  })

  it('passes fault injection skeleton', () => {
    const fault = runP10FaultInjectionGate()
    assert.equal(fault.ok, true, fault.cases.filter((c) => !c.ok).map((c) => c.name).join(','))
  })

  it('passes 2/10/50 parallel composer matrix', () => {
    const parallel = runP10ParallelComposerGate(P10_PARALLEL_COMPOSER_COUNTS)
    assert.equal(parallel.ok, true, parallel.cases.filter((c) => !c.ok).map((c) => c.detail).join(';'))
  })

  it('passes consumer fault injection cases', () => {
    const consumer = runP10ConsumerFaultGate()
    assert.equal(consumer.ok, true, consumer.cases.filter((c) => !c.ok).map((c) => c.name).join(','))
  })

  it('passes stock-vs-telemetry frozen parity fixtures', () => {
    const stock = runP10StockParityGate()
    assert.equal(stock.ok, true, stock.cases.filter((c) => !c.ok).map((c) => c.detail).join(';'))
  })

  it('passes TUN-vs-mixed-port latency tax gate', () => {
    const tun = runP10TunLatencyGate()
    assert.equal(tun.ok, true, tun.detail)
  })
})
