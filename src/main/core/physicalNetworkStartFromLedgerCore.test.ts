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

  it('parses http_segment_started envelope (Cursor-2 validated-ledger)', () => {
    const line = JSON.stringify({
      envelope: {
        eventKind: 'http_segment_started',
        occurredAtMs: 1784866200310,
        processInstanceId: 'c2-1784858169328-cwt6pfbs',
        requestId: '8f984d3f-c0b1-48a8-95bb-738d53bed6b0',
        originalRequestId: '67db51f9-908a-4c80-aa25-dbd2576fc9d3',
        composerId: 'e716c716-1c0b-4350-895c-9a79ca5430c3',
        segmentId: 'c2-1784858169328-cwt6pfbs:segment:50',
        payload: {
          segmentId: 'c2-1784858169328-cwt6pfbs:segment:50',
          httpStartMs: 1784866200309,
        },
      },
    })
    const row = parseNetworkStartedLedgerLine(line)
    assert.equal(row?.networkStartId, 'c2-1784858169328-cwt6pfbs:segment:50')
    assert.equal(row?.rendererBootId, 'c2-1784858169328-cwt6pfbs')
    assert.equal(row?.httpStartMs, 1784866200309)
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
