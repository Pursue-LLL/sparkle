import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  countHttpSegmentStartedLedgerLines,
  parseNetworkStartedLedgerLine,
  projectPhysicalNetworkStarts,
} from './physicalNetworkStartFromLedgerCore'

describe('physicalNetworkStartFromLedgerCore P10-5', () => {
  it('parses network_started envelope', () => {
    const line = JSON.stringify({
      envelope: {
        eventKind: 'network_started',
        occurredAtMs: 1000,
        requestId: 'req-1',
        originalRequestId: 'orig-1',
        composerId: 'comp-1',
        networkStartId: 'proc:net:1',
        rendererBootId: 'boot-a',
        payload: {
          networkStartId: 'proc:net:1',
          rendererBootId: 'boot-a',
          httpStartMs: 1000,
          origin: 'manual',
        },
      },
    })
    const row = parseNetworkStartedLedgerLine(line)
    assert.equal(row?.networkStartId, 'proc:net:1')
    assert.equal(row?.origin, 'manual')
  })

  it('projects terminal max_steps onto physical start by originalRequestId', () => {
    const starts = [
      {
        ts: 1000,
        networkStartId: 'net-1',
        rendererBootId: 'boot-a',
        originalRequestId: 'orig-1',
        httpStartMs: 1000,
      },
    ]
    const terminals = [
      {
        ts: 5000,
        originalRequestId: 'orig-1',
        isMaxSteps: true,
        terminalKind: 'agent_error_disconnect',
      },
    ]
    const records = projectPhysicalNetworkStarts({ starts, terminals })
    assert.equal(records.length, 1)
    assert.equal(records[0]?.outcome, 'max_steps')
    assert.equal(records[0]?.closedAtMs, 5000)
  })

  it('counts http_segment_started lines for bad-ruler detection', () => {
    const lines = [
      JSON.stringify({ envelope: { eventKind: 'http_segment_started' } }),
      JSON.stringify({ envelope: { eventKind: 'network_started' } }),
      JSON.stringify({ envelope: { eventKind: 'http_segment_started' } }),
    ]
    assert.equal(countHttpSegmentStartedLedgerLines(lines), 2)
  })
})
