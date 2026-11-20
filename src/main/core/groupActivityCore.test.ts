import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  connectionChainsIncludeGroup,
  isGroupRecentlyActive,
  nextGroupActivityAtMs
} from './groupActivityCore'

const MAIL_GROUP = '📧 邮件专用'
const WINDOW_MS = 30 * 60 * 1000

function connectionsWithChains(chainsList: string[][]): ControllerConnections {
  return {
    downloadTotal: 0,
    uploadTotal: 0,
    memory: 0,
    connections: chainsList.map((chains, index) => ({
      id: String(index),
      metadata: {} as ControllerConnectionDetail['metadata'],
      upload: 0,
      download: 0,
      start: '',
      chains,
      rule: '',
      rulePayload: '',
      isActive: true
    }))
  }
}

describe('groupActivityCore', () => {
  it('detects the group in active connection chains', () => {
    const connections = connectionsWithChains([
      ['🚀 节点选择', 'Sparkle-日本', '日本-优化'],
      ['🚀 节点选择', MAIL_GROUP, '日本-优化']
    ])
    assert.equal(connectionChainsIncludeGroup(connections, MAIL_GROUP), true)
    assert.equal(connectionChainsIncludeGroup(connections, 'Sparkle-日本'), true)
    assert.equal(connectionChainsIncludeGroup(connections, '📧 不存在'), false)
  })

  it('treats missing or empty connections as no activity', () => {
    assert.equal(connectionChainsIncludeGroup(undefined, MAIL_GROUP), false)
    assert.equal(connectionChainsIncludeGroup(connectionsWithChains([]), MAIL_GROUP), false)
    assert.equal(
      connectionChainsIncludeGroup(
        connectionsWithChains([['🚀 节点选择', '自动选择']]),
        MAIL_GROUP
      ),
      false
    )
  })

  it('keeps the previous timestamp when no active connection is observed', () => {
    assert.equal(nextGroupActivityAtMs(1000, false, 2000), 1000)
    assert.equal(nextGroupActivityAtMs(1000, true, 2000), 2000)
  })

  it('only considers activity within the window it is given', () => {
    assert.equal(isGroupRecentlyActive(0, 1000, WINDOW_MS), false)
    assert.equal(isGroupRecentlyActive(1000, 1000 + WINDOW_MS - 1, WINDOW_MS), true)
    assert.equal(isGroupRecentlyActive(1000, 1000 + WINDOW_MS, WINDOW_MS), false)
    assert.equal(isGroupRecentlyActive(1000, 1000 + 60_000, 60_000), false)
  })
})
