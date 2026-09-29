import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildStallEscalationJsonlErrMsg, persistStallEscalationLadderJsonl } from './stallEscalationLadderJsonl'

describe('stallEscalationLadderJsonl R-41b', () => {
  it('builds triage-friendly errMsg', () => {
    const msg = buildStallEscalationJsonlErrMsg({
      action: 'emergency_sidecar_dial',
      reason: 'emergency_stall_escalation_r1',
      connectionId: 'f1ee553d',
      host: 'api2.cursor.sh',
      stallMs: 88499,
      upload: 2458,
      download: 4972,
    })
    assert.match(msg, /StallEscalationLadder/)
    assert.match(msg, /connection_id=f1ee553d/)
    assert.match(msg, /stall_ms=88499/)
  })

  it('persists jsonl row with stale RID', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sparkle-sel-jsonl-'))
    const previousHome = process.env.HOME
    process.env.HOME = home
    try {
      await persistStallEscalationLadderJsonl({
        action: 'emergency_sidecar_dial',
        reason: 'emergency_stall_escalation_r1',
        connectionId: 'f1ee553d',
        host: 'api2.cursor.sh',
        stallMs: 88499,
        upload: 2458,
        download: 4972,
        leaf: 'KR-VPS-HY2',
        staleRequestIds: ['5f587792-788d-4188-a82c-913e1464a5f5'],
        cursorConnectionCount: 28,
        nowMs: 1_000_000,
      })
      const text = await readFile(join(home, '.sparkle', 'agent-transport-failures.jsonl'), 'utf8')
      const row = JSON.parse(text.trim()) as {
        kind: string
        originalRequestId: string
        reasonSub: string
        proxyNode: string
      }
      assert.equal(row.kind, 'sparkle_stall_escalation')
      assert.equal(row.originalRequestId, '5f587792-788d-4188-a82c-913e1464a5f5')
      assert.equal(row.reasonSub, 'stall-escalation-emergency_sidecar_dial')
      assert.equal(row.proxyNode, 'KR-VPS-HY2')
    } finally {
      process.env.HOME = previousHome
    }
  })
})
