import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CURSOR_2_APP_PATH_PREFIX,
  isCursorAppBundleProcessPath,
  MARATHON_CURSOR_APP_PATH_PREFIXES
} from './cursorAppBundlePathsCore'

describe('cursorAppBundlePathsCore', () => {
  it('includes Cursor-2 as dedicated and marathon bundles for observability', () => {
    assert.deepEqual(MARATHON_CURSOR_APP_PATH_PREFIXES, [
      '/Applications/Cursor-3.1.15.app',
      CURSOR_2_APP_PATH_PREFIX
    ])
  })

  it('matches Cursor-2 process paths', () => {
    assert.equal(
      isCursorAppBundleProcessPath('/Applications/Cursor-2.app/Contents/MacOS/Cursor'),
      true
    )
    assert.equal(isCursorAppBundleProcessPath('/Applications/Safari.app/Contents/MacOS/Safari'), false)
  })
})
