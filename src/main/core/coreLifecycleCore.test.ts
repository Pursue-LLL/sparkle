import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatCoreLifecycleLogLine,
  POST_CORE_READY_FAKE_IP_FLUSH_RETRIES,
} from './coreLifecycleCore'

describe('coreLifecycleCore', () => {
  it('formats post_ready fake_ip_flush executed line', () => {
    const line = formatCoreLifecycleLogLine({
      phase: 'post_ready',
      action: 'fake_ip_flush',
      outcome: 'executed',
      reason: 'emergency',
      attempt: 1,
    })
    assert.match(line, /\[CoreLifecycle\]: phase=post_ready/)
    assert.match(line, /action=fake_ip_flush/)
    assert.match(line, /outcome=executed/)
    assert.match(line, /reason=emergency/)
    assert.match(line, /attempt=1/)
  })

  it('exposes bounded flush retry count', () => {
    assert.equal(POST_CORE_READY_FAKE_IP_FLUSH_RETRIES, 3)
  })
})
