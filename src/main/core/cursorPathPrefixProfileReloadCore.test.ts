import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { shouldReloadProfileForAppConfigPatch } from './cursorPathPrefixProfileReloadCore'

describe('shouldReloadProfileForAppConfigPatch', () => {
  it('returns true when cursorProxyAppPathPrefixes is present even if empty', () => {
    assert.equal(shouldReloadProfileForAppConfigPatch({ cursorProxyAppPathPrefixes: [] }), true)
  })

  it('returns true when cursorProxyAppPathPrefixes has marathon target path', () => {
    assert.equal(
      shouldReloadProfileForAppConfigPatch({
        cursorProxyAppPathPrefixes: ['/Applications/Cursor-3.1.15.app']
      }),
      true
    )
  })

  it('returns false for unrelated app config patches', () => {
    assert.equal(shouldReloadProfileForAppConfigPatch({ cursorBidiOptimize: true }), false)
    assert.equal(shouldReloadProfileForAppConfigPatch({ saveLogs: false }), false)
  })
})
