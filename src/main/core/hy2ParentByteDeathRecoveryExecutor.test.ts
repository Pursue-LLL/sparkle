import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  executeByteDeathParentMutation,
  executeLeafCloseBatch,
} from './hy2ParentByteDeathRecoveryExecutor'

const nowMs = 2_000_000

describe('hy2ParentByteDeathRecoveryExecutor @1.30.31', () => {
  it('executeLeafCloseBatch records closed_count from closeFn invocations', async () => {
    const closed: string[] = []
    const batch = await executeLeafCloseBatch({
      targets: [
        { id: 'a', chains: ['JP-VPS-HY2'] } as ControllerConnectionDetail,
        { id: 'b', chains: ['JP-VPS-HY2'] } as ControllerConnectionDetail,
      ],
      closeFn: async (id) => {
        if (id === 'b') {
          throw new Error('close rejected')
        }
        closed.push(id)
      },
    })
    assert.deepEqual(batch.closedIds, ['a'])
    assert.deepEqual(batch.failedIds, ['b'])
    assert.match(batch.err ?? '', /close rejected/)
  })

  it('executeByteDeathParentMutation logs executed closed_count via injected deps', async () => {
    const logLines: string[] = []
    const connections = Array.from({ length: 12 }, (_, index) => ({
      id: `tcp-${index}`,
      chains: ['Cursor专用', 'JP-VPS-HY2'],
      metadata: { network: 'tcp', host: 'api2.cursor.sh' },
    })) as ControllerConnectionDetail[]
    const trackedLastByteChangeAtMsById = new Map(
      connections.map((conn) => [conn.id, nowMs - 150_000]),
    )
    const closedIds: string[] = []
    const result = await executeByteDeathParentMutation(
      {
        activeLeaf: 'JP-VPS-HY2',
        connections,
        trackedFirstSeenAtMsById: new Map(),
        trackedLastByteChangeAtMsById,
        nowMs,
        maxByteStallMs: 223_064,
        cursorConnectionCount: 73,
      },
      {
        fetchConnections: async () => connections,
        closeFn: async (id) => {
          closedIds.push(id)
        },
        appendLog: async (line) => {
          logLines.push(line)
        },
      },
    )
    assert.equal(result.mutated, true)
    assert.equal(result.plan.action, 'close_leaf_connections')
    assert.equal(closedIds.length, 8)
    assert.equal(result.leafReport?.closedCount, 8)
    assert.ok(
      logLines.some(
        (line) =>
          line.includes('outcome=executed') &&
          line.includes('closed_count=8') &&
          line.includes('attempted_count=8'),
      ),
    )
  })

  it('returns mutated=false when no targets and no UDP parent', async () => {
    const logLines: string[] = []
    const result = await executeByteDeathParentMutation(
      {
        activeLeaf: 'JP-VPS-HY2',
        connections: [],
        trackedFirstSeenAtMsById: new Map(),
        trackedLastByteChangeAtMsById: new Map(),
        nowMs,
        maxByteStallMs: 223_064,
        cursorConnectionCount: 0,
      },
      {
        fetchConnections: async () => [],
        closeFn: async () => {},
        appendLog: async (line) => {
          logLines.push(line)
        },
      },
    )
    assert.equal(result.mutated, false)
    assert.equal(result.plan.action, 'none')
    assert.ok(logLines.some((line) => line.includes('byte_death_no_mutation_targets')))
  })
})
