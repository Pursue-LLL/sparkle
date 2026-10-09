import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { probeMihomoControllerVersion } from './mihomoControllerReadyCore'

describe('mihomoControllerReadyCore', () => {
  it('exports a callable probe', () => {
    assert.equal(typeof probeMihomoControllerVersion, 'function')
  })
})
