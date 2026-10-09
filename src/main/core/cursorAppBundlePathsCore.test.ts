import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CURSOR_2_APP_PATH_PREFIX,
  CURSOR_3_APP_PATH_PREFIX,
  CURSOR_DEDICATED_PROXY_APP_PATH_PREFIXES,
  CURSOR_MAIN_APP_PATH_PREFIX,
  CURSOR_NODE_SELECT_APP_PATH_PREFIXES
} from './cursorAppBundlePathsCore'

describe('cursorAppBundlePathsCore', () => {
  it('routes Cursor-2/3 to dedicated and Cursor.app to auto-select', () => {
    assert.ok(!CURSOR_DEDICATED_PROXY_APP_PATH_PREFIXES.includes(CURSOR_MAIN_APP_PATH_PREFIX))
    assert.deepEqual(CURSOR_DEDICATED_PROXY_APP_PATH_PREFIXES, [
      CURSOR_2_APP_PATH_PREFIX,
      CURSOR_3_APP_PATH_PREFIX
    ])
    assert.deepEqual(CURSOR_NODE_SELECT_APP_PATH_PREFIXES, [CURSOR_MAIN_APP_PATH_PREFIX])
  })
})
