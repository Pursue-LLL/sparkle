import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CURSOR_2_APP_PATH_PREFIX,
  CURSOR_3_APP_PATH_PREFIX,
  isCursorAppBundleProcessPath,
  MARATHON_CURSOR_APP_PATH_PREFIXES
} from './cursorAppBundlePathsCore'

describe('cursorAppBundlePathsCore', () => {
  it('includes Cursor-3 and Cursor-2 in marathon observability bundles', () => {
    assert.deepEqual(MARATHON_CURSOR_APP_PATH_PREFIXES, [
      CURSOR_3_APP_PATH_PREFIX,
      '/Applications/Cursor-3.1.15.app',
      CURSOR_2_APP_PATH_PREFIX
    ])
  })

  it('matches Cursor-2 and Cursor-3 process paths', () => {
    assert.equal(
      isCursorAppBundleProcessPath('/Applications/Cursor-2.app/Contents/MacOS/Cursor'),
      true
    )
    assert.equal(
      isCursorAppBundleProcessPath(
        '/Applications/Cursor-3.app/Contents/Frameworks/Cursor Helper.app/Contents/MacOS/Cursor Helper'
      ),
      true
    )
    assert.equal(isCursorAppBundleProcessPath('/Applications/Safari.app/Contents/MacOS/Safari'), false)
  })
})
