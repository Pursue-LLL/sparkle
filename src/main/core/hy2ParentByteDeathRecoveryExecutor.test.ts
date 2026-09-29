import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BYTE_DEATH_LEAF_CLOSE_MAX_BATCH } from './hy2ParentByteDeathRecoveryCore'
import {
  executeByteDeathParentMutationWithDeps,
  executeLeafCloseBatch,
} from './hy2ParentByteDeathRecoveryExecutorImpl'

const nowMs = 2_000_000

describe('hy2ParentByteDeathRecoveryExecutor @1.30.32', () => {
  it('executeLeafCloseBatch records closed_count from closeFn invocations', async () => {
    const closed: string[] = []
    const batch = await executeLeafCloseBatch({
      targets: [
        { id: 'a', chains: ['KR-VPS-HY2'] } as ControllerConnectionDetail,
        { id: 'b', chains: ['KR-VPS-HY2'] } as ControllerConnectionDetail,
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

  it('C-8.13: udp absent marathon → close frozen leaf batch (parent session rebuilt, core restart removed)', async () => {
    const logLines: string[] = []
    const connections = Array.from({ length: 12 }, (_, index) => ({
      id: `tcp-${index}`,
      chains: ['Cursor专用', 'KR-VPS-HY2'],
      metadata: { network: 'tcp', host: 'api2.cursor.sh' },
    })) as ControllerConnectionDetail[]
    const trackedLastByteChangeAtMsById = new Map(
      connections.map((conn) => [conn.id, nowMs - 150_000]),
    )
    const closedIds: string[] = []
    let birthReset = false
    const result = await executeByteDeathParentMutationWithDeps(
      {
        activeLeaf: 'KR-VPS-HY2',
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
        resetParentBirth: async () => {
          birthReset = true
        },
        appendLog: async (line) => {
          logLines.push(line)
        },
      },
    )
    assert.equal(result.mutated, true)
    assert.equal(result.plan.action, 'close_leaf_connections')
    assert.equal(result.plan.reason, 'byte_death_udp_absent_close_leaf_rebuild')
    assert.equal(closedIds.length, BYTE_DEATH_LEAF_CLOSE_MAX_BATCH)
    assert.equal(birthReset, false)
    assert.ok(
      logLines.some(
        (line) =>
          line.includes('action=close_leaf_connections') &&
          line.includes('outcome=executed'),
      ),
    )
  })

  it('refresh fail aborts before any close', async () => {
    const logLines: string[] = []
    const closedIds: string[] = []
    const result = await executeByteDeathParentMutationWithDeps(
      {
        activeLeaf: 'KR-VPS-HY2',
        connections: [],
        trackedFirstSeenAtMsById: new Map(),
        trackedLastByteChangeAtMsById: new Map(),
        nowMs,
        maxByteStallMs: 223_064,
        cursorConnectionCount: 73,
      },
      {
        fetchConnections: async () => {
          throw new Error('mihomoGetConnections is not a function')
        },
        closeFn: async (id) => {
          closedIds.push(id)
        },
        resetParentBirth: async () => {},
        appendLog: async (line) => {
          logLines.push(line)
        },
      },
    )
    assert.equal(result.mutated, false)
    assert.equal(result.plan.reason, 'byte_death_refresh_connections_failed')
    assert.equal(closedIds.length, 0)
    assert.ok(logLines.some((line) => line.includes('byte_death_refresh_connections_failed')))
  })

  it('close_leaf when UDP present and frozen batch', async () => {
    const logLines: string[] = []
    const connections = [
      {
        id: 'udp-parent',
        chains: ['Cursor专用', 'KR-VPS-HY2'],
        metadata: { network: 'udp' },
      },
      ...Array.from({ length: 12 }, (_, index) => ({
        id: `tcp-${index}`,
        chains: ['Cursor专用', 'KR-VPS-HY2'],
        metadata: { network: 'tcp', host: 'api2.cursor.sh' },
      })),
    ] as ControllerConnectionDetail[]
    const trackedLastByteChangeAtMsById = new Map(
      connections
        .filter((conn) => conn.id.startsWith('tcp-'))
        .map((conn) => [conn.id, nowMs - 150_000]),
    )
    const closedIds: string[] = []
    const result = await executeByteDeathParentMutationWithDeps(
      {
        activeLeaf: 'KR-VPS-HY2',
        connections,
        trackedFirstSeenAtMsById: new Map([['udp-parent', nowMs - 500_000]]),
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
        resetParentBirth: async () => {},
        appendLog: async (line) => {
          logLines.push(line)
        },
      },
    )
    assert.equal(result.mutated, true)
    assert.equal(result.plan.action, 'close_udp_outbound')
    assert.deepEqual(closedIds, ['udp-parent'])
  })

  it('no targets and no UDP → escalate core restart', async () => {
    const logLines: string[] = []
    let birthReset = false
    const result = await executeByteDeathParentMutationWithDeps(
      {
        activeLeaf: 'KR-VPS-HY2',
        connections: [],
        trackedFirstSeenAtMsById: new Map(),
        trackedLastByteChangeAtMsById: new Map(),
        nowMs,
        maxByteStallMs: 223_064,
        cursorConnectionCount: 0,
      },
      {
        fetchConnections: async () => [],
        resetParentBirth: async () => {
          birthReset = true
        },
        closeFn: async () => {},
        appendLog: async (line) => {
          logLines.push(line)
        },
      },
    )
    assert.equal(result.mutated, false)
    assert.equal(result.plan.action, 'none')
    assert.equal(result.plan.reason, 'byte_death_udp_absent_requires_core_restart')
    assert.equal(birthReset, false)
  })

  it('1.30.31 regression: refresh fail must not proceed to close (abort only)', async () => {
    const closedIds: string[] = []
    const result = await executeByteDeathParentMutationWithDeps(
      {
        activeLeaf: 'KR-VPS-HY2',
        connections: Array.from({ length: 12 }, (_, index) => ({
          id: `tcp-${index}`,
          chains: ['KR-VPS-HY2'],
        })) as ControllerConnectionDetail[],
        trackedFirstSeenAtMsById: new Map(),
        trackedLastByteChangeAtMsById: new Map(
          Array.from({ length: 12 }, (_, index) => [`tcp-${index}`, nowMs - 150_000]),
        ),
        nowMs,
        maxByteStallMs: 94501,
        cursorConnectionCount: 28,
      },
      {
        fetchConnections: async () => {
          throw new Error('mihomoGetConnections is not a function')
        },
        closeFn: async (id) => {
          closedIds.push(id)
        },
        resetParentBirth: async () => {},
        appendLog: async () => {},
      },
    )
    assert.equal(result.mutated, false)
    assert.equal(result.plan.reason, 'byte_death_refresh_connections_failed')
    assert.equal(closedIds.length, 0)
  })
})
