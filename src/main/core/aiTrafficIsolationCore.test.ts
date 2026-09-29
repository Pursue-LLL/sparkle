import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  excludeMarathonHy2FromAiProxyGroups,
  isAiTrafficProxyGroupName,
  isMarathonCursorHy2Leaf,
} from './aiTrafficIsolationCore'

describe('aiTrafficIsolationCore W2', () => {
  it('recognizes AI / OpenAI group names', () => {
    assert.equal(isAiTrafficProxyGroupName('🤖 AI'), true)
    assert.equal(isAiTrafficProxyGroupName('🤖 OpenAI'), true)
    assert.equal(isAiTrafficProxyGroupName('🎯 Cursor 专用'), false)
    assert.equal(isAiTrafficProxyGroupName('🧱 GFW 列表'), false)
  })

  it('identifies marathon Cursor HY2 leaves', () => {
    assert.equal(isMarathonCursorHy2Leaf('KR-VPS-HY2'), true)
    assert.equal(isMarathonCursorHy2Leaf('KR-VPS-HY2'), true)
    assert.equal(isMarathonCursorHy2Leaf('🇸🇬 新加坡 02'), false)
    assert.equal(isMarathonCursorHy2Leaf('KR-VPS-Reality'), false)
  })

  it('strips KR-VPS-HY2 from AI groups only', () => {
    const groups = [
      { name: '🤖 AI', proxies: ['KR-VPS-HY2', '🇸🇬 新加坡 02', 'SG-01'] },
      { name: '🎯 Cursor 专用', proxies: ['KR-VPS-HY2', 'KR-VPS-Reality'] },
    ]
    const result = excludeMarathonHy2FromAiProxyGroups(groups)
    assert.equal(result.groupsMutated, 1)
    assert.equal(result.proxiesRemoved, 1)
    assert.deepEqual(groups[0]?.proxies, ['🇸🇬 新加坡 02', 'SG-01'])
    assert.deepEqual(groups[1]?.proxies, ['KR-VPS-HY2', 'KR-VPS-Reality'])
  })
})
