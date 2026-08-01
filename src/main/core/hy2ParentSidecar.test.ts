import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import {
  getLastHy2ParentSidecarDetectLogAtMsForTests,
  resetHy2ParentSidecarStateForTests,
} from './hy2ParentSidecar'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)))

describe('hy2ParentSidecar P10-2 passive-only', () => {
  it('source must not import production dial/close executors', () => {
    const source = readFileSync(path.join(ROOT, 'hy2ParentSidecar.ts'), 'utf8')
    assert.doesNotMatch(source, /executeMarathonRescueDial/)
    assert.doesNotMatch(source, /mihomoCloseConnection/)
    assert.match(source, /phase=detect_only/)
    assert.match(source, /outcome: 'skipped'/)
  })

  it('exposes detect log state helpers for tests', () => {
    resetHy2ParentSidecarStateForTests()
    assert.equal(getLastHy2ParentSidecarDetectLogAtMsForTests(), 0)
  })
})
