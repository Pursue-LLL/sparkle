import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CURSOR_2_APP_PATH_PREFIX,
  CURSOR_3_APP_PATH_PREFIX,
  CURSOR_DEDICATED_PROXY_APP_PATH_PREFIXES,
  CURSOR_LATEST_APP_PATH_PREFIX,
  CURSOR_MAIN_APP_PATH_PREFIX,
  CURSOR_NODE_SELECT_APP_PATH_PREFIXES
} from './cursorAppBundlePathsCore'

describe('cursorAppBundlePathsCore', () => {
  it('routes Cursor 主 / Latest / Cursor-2/3 to dedicated with no default node-select bundles', () => {
    assert.ok(CURSOR_DEDICATED_PROXY_APP_PATH_PREFIXES.includes(CURSOR_MAIN_APP_PATH_PREFIX))
    assert.deepEqual(CURSOR_DEDICATED_PROXY_APP_PATH_PREFIXES, [
      CURSOR_MAIN_APP_PATH_PREFIX,
      CURSOR_LATEST_APP_PATH_PREFIX,
      CURSOR_2_APP_PATH_PREFIX,
      CURSOR_3_APP_PATH_PREFIX
    ])
    assert.deepEqual(CURSOR_NODE_SELECT_APP_PATH_PREFIXES, [])
  })
})
