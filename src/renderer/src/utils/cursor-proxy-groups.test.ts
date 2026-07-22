import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AUTO_SELECT_DELAY_TEST_URL,
  CURSOR_DELAY_TEST_URL,
  CURSOR_DEDICATED_GROUP_NAME,
  DEFAULT_GENERAL_DELAY_TEST_URL,
  formatDelayTestUrlDisplay,
  resolveEffectiveDelayTestUrl
} from './cursor-proxy-groups'

describe('cursor-proxy-groups probe url helpers', () => {
  it('resolves effective url per group when scope is group', () => {
    assert.equal(
      resolveEffectiveDelayTestUrl({
        groupName: CURSOR_DEDICATED_GROUP_NAME,
        delayTestUrlScope: 'group'
      }),
      CURSOR_DELAY_TEST_URL
    )
    assert.equal(
      resolveEffectiveDelayTestUrl({
        groupName: 'Sparkle-自动-日本',
        delayTestUrlScope: 'group'
      }),
      AUTO_SELECT_DELAY_TEST_URL
    )
    assert.equal(
      resolveEffectiveDelayTestUrl({
        groupName: '🚀 节点选择',
        delayTestUrlScope: 'group'
      }),
      DEFAULT_GENERAL_DELAY_TEST_URL
    )
  })

  it('uses global delay test url when scope is global', () => {
    assert.equal(
      resolveEffectiveDelayTestUrl({
        groupName: CURSOR_DEDICATED_GROUP_NAME,
        delayTestUrlScope: 'global',
        globalDelayTestUrl: 'https://example.com/probe'
      }),
      'https://example.com/probe'
    )
    assert.equal(
      resolveEffectiveDelayTestUrl({
        groupName: '🚀 节点选择',
        delayTestUrlScope: 'global'
      }),
      DEFAULT_GENERAL_DELAY_TEST_URL
    )
  })

  it('formats delay test url for compact display', () => {
    assert.equal(formatDelayTestUrlDisplay('https://api2.cursor.sh'), 'api2.cursor.sh')
    assert.equal(
      formatDelayTestUrlDisplay('https://www.gstatic.com/generate_204'),
      'www.gstatic.com/generate_204'
    )
  })
})
