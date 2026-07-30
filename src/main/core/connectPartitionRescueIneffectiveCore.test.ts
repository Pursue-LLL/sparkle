import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  evaluateConnectPartitionRescueIneffective,
  formatConnectPartitionRescueIneffectiveLogLine,
  shouldRecordConnectPartitionRescueExecution,
} from './connectPartitionRescueIneffectiveCore'

describe('connectPartitionRescueIneffectiveCore R-31', () => {
  it('records executed connect_partition rescue outcomes only', () => {
    assert.equal(shouldRecordConnectPartitionRescueExecution('executed'), true)
    assert.equal(shouldRecordConnectPartitionRescueExecution('skipped_deferred'), false)
  })

  it('flags ineffective rescue when mass PING persists and short path stays green', () => {
    const nowMs = 10_000_000
    const observation = evaluateConnectPartitionRescueIneffective({
      record: {
        executedAtMs: nowMs - 30_000,
        outcome: 'executed',
        staleRequestIds: [
          '15e0c619-3b0b-463f-acd3-b4857d122497',
          '42e5846b-a4d7-49ed-afb5-66570cc58e15',
        ],
        pingFailureCountAtRescue: 5,
        connectPathPartitionStale: false,
      },
      nowMs,
      pingFailureCount: 6,
      staleRequestIds: ['15e0c619-3b0b-463f-acd3-b4857d122497'],
      connectPathPartitionStale: false,
      api2DelayMs: 316,
    })
    assert.ok(observation)
    assert.equal(observation?.connectPathPartitionStale, 0)
    assert.match(
      formatConnectPartitionRescueIneffectiveLogLine(observation!),
      /ConnectPartitionRescueIneffective/,
    )
  })

  it('does not flag ineffective when ping failures drop after rescue', () => {
    const nowMs = 20_000_000
    const observation = evaluateConnectPartitionRescueIneffective({
      record: {
        executedAtMs: nowMs - 30_000,
        outcome: 'executed',
        staleRequestIds: ['rid-1'],
        pingFailureCountAtRescue: 5,
        connectPathPartitionStale: false,
      },
      nowMs,
      pingFailureCount: 1,
      staleRequestIds: [],
      connectPathPartitionStale: false,
    })
    assert.equal(observation, undefined)
  })

  it('does not flag ineffective before min elapsed window', () => {
    const nowMs = 10_000_000
    const observation = evaluateConnectPartitionRescueIneffective({
      record: {
        executedAtMs: nowMs - 2_000,
        outcome: 'executed',
        staleRequestIds: ['rid-1'],
        pingFailureCountAtRescue: 3,
        connectPathPartitionStale: false,
      },
      nowMs,
      pingFailureCount: 5,
      staleRequestIds: ['rid-1'],
      connectPathPartitionStale: false,
    })
    assert.equal(observation, undefined)
  })
})
