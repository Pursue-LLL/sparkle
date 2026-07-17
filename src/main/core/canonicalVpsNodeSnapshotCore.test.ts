import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { collectCanonicalVpsNodeSnapshotsFromProviders } from './canonicalVpsNodeSnapshotCore'

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
            }
          ]
        }
      }
    })
    assert.equal(snapshots.length, 2)
    assert.deepEqual(
      snapshots.map((item) => item.name),
      ['JP-VPS-Reality', 'KR-VPS-HY2']
    )
    assert.equal(snapshots[1]?.delay, 366)
  })
})
