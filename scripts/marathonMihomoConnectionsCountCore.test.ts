import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { countCursorConnections } from './marathonMihomoConnectionsCountCore'

describe('marathonMihomoConnectionsCountCore', () => {
  it('counts Cursor.app process paths and helper names', () => {
    const count = countCursorConnections([
      { metadata: { processPath: '/Applications/Cursor-3.1.15.app/Contents/MacOS/Cursor' } },
      { metadata: { process: 'Cursor Helper (Renderer)' } },
      { metadata: { processPath: '/Applications/Safari.app/Contents/MacOS/Safari' } },
    ])
    assert.equal(count, 2)
  })
})
