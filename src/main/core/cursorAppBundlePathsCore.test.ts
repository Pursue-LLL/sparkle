import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CURSOR_2_APP_PATH_PREFIX,
  CURSOR_3_APP_PATH_PREFIX,
  CURSOR_DEDICATED_PROXY_APP_PATH_PREFIXES,
  CURSOR_MAIN_APP_PATH_PREFIX,
  CURSOR_NODE_SELECT_APP_PATH_PREFIXES,
  isCursorAppBundleProcessPath,
  MARATHON_CURSOR_APP_PATH_PREFIXES
} from './cursorAppBundlePathsCore'

describe('cursorAppBundlePathsCore', () => {
  it('routes Cursor-2/3 to dedicated and Cursor.app to auto-select', () => {
    assert.ok(!CURSOR_DEDICATED_PROXY_APP_PATH_PREFIXES.includes(CURSOR_MAIN_APP_PATH_PREFIX))
    assert.deepEqual(CURSOR_DEDICATED_PROXY_APP_PATH_PREFIXES, [
      CURSOR_2_APP_PATH_PREFIX,
      CURSOR_3_APP_PATH_PREFIX,
    ])
    assert.deepEqual(CURSOR_NODE_SELECT_APP_PATH_PREFIXES, [CURSOR_MAIN_APP_PATH_PREFIX])
  })

  it('includes Cursor-3 and Cursor-2 in marathon observability bundles', () => {
    assert.deepEqual(MARATHON_CURSOR_APP_PATH_PREFIXES, [
      CURSOR_3_APP_PATH_PREFIX,
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
