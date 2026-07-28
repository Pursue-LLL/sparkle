import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { collectCanonicalVpsNodeHistorySnapshotsFromProviders, collectCanonicalVpsNodeSnapshotsFromProviders } from './canonicalVpsNodeSnapshotCore'

describe('canonicalVpsNodeSnapshotCore', () => {
  it('collects latest delay for canonical VPS nodes only', () => {
    const snapshots = collectCanonicalVpsNodeSnapshotsFromProviders({
      providers: {
        demo: {
          proxies: [
            {
              name: 'KR-VPS-HY2',
              alive: true,
              history: [
                { time: '2026-07-17T08:00:00Z', delay: 0 },
                { time: '2026-07-17T08:05:00Z', delay: 366 }
              ]
            },
            {
              name: 'SG-VPS-Reality',
              alive: true,
              history: [{ time: '2026-07-17T08:05:00Z', delay: 100 }]
            },
            {
              name: 'JP-VPS-Reality',
              alive: true,
              history: [{ time: '2026-07-17T08:05:01Z', delay: 834 }]
            },
            {
              name: 'JP-VPS-TLS',
              alive: true,
              history: [{ time: '2026-07-17T08:05:02Z', delay: 255 }]
            }
          ]
        }
      }
    })
    assert.equal(snapshots.length, 2)
    assert.deepEqual(
      snapshots.map((item) => item.name),
      ['JP-VPS-Reality', 'JP-VPS-TLS']
    )
    assert.equal(snapshots[1]?.delay, 255)
  })

  it('collects last 8 history entries for canonical VPS nodes (V5.6 @ A replay)', () => {
    const historyEntries = Array.from({ length: 10 }, (_, index) => ({
      time: `2026-07-22T08:0${index}:00Z`,
      delay: 100 + index
    }))
    const snapshots = collectCanonicalVpsNodeHistorySnapshotsFromProviders({
      providers: {
        demo: {
          proxies: [
            {
              name: 'JP-VPS-HY2',
              alive: true,
              history: historyEntries
            },
            {
              name: 'SG-VPS-Reality',
              alive: true,
              history: [{ time: '2026-07-22T08:00:00Z', delay: 50 }]
            }
          ]
        }
      }
    })
    assert.equal(snapshots.length, 1)
    assert.equal(snapshots[0]?.history.length, 8)
    assert.equal(snapshots[0]?.history[0]?.time, '2026-07-22T08:02:00Z')
    assert.equal(snapshots[0]?.history[7]?.delay, 109)
  })
})
