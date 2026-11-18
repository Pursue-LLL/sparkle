import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  profileReloadKeys,
  shouldReloadProfileForAppConfigPatch
} from './appConfigProfileReloadCore'

describe('shouldReloadProfileForAppConfigPatch', () => {
  it('returns true when cursorProxyAppPathPrefixes is present even if empty', () => {
    assert.equal(shouldReloadProfileForAppConfigPatch({ cursorProxyAppPathPrefixes: [] }), true)
  })

  it('returns true when cursorProxyAppPathPrefixes has a Cursor bundle path', () => {
    assert.equal(
      shouldReloadProfileForAppConfigPatch({
        cursorProxyAppPathPrefixes: ['/Applications/Cursor-3.1.15.app']
      }),
      true
    )
  })

  it('returns true for a dedicated group switch patch, whatever it switches', () => {
    assert.equal(shouldReloadProfileForAppConfigPatch({ dedicatedGroups: { grok: true } }), true)
    assert.equal(shouldReloadProfileForAppConfigPatch({ dedicatedGroups: { agy: false } }), true)
    assert.equal(shouldReloadProfileForAppConfigPatch({ dedicatedGroups: {} }), true)
  })

  it('returns false for unrelated app config patches', () => {
    assert.equal(shouldReloadProfileForAppConfigPatch({ cursorBidiOptimize: true }), false)
    assert.equal(shouldReloadProfileForAppConfigPatch({ saveLogs: false }), false)
  })
})

describe('profileReloadKeys', () => {
  it('lists every reload-relevant key of a patch, in a stable order', () => {
    assert.deepEqual(
      profileReloadKeys({ dedicatedGroups: { mail: false }, cursorProxyAppPathPrefixes: [] }),
      ['cursorProxyAppPathPrefixes', 'dedicatedGroups']
    )
  })

  it('is empty for patches that leave the runtime config alone', () => {
    assert.deepEqual(profileReloadKeys({ saveLogs: true }), [])
  })
})
