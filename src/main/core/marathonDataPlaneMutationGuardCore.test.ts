import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  shouldBlockMarathonProviderMutation,
  formatMarathonProviderMutationBlockedLogLine,
} from './marathonDataPlaneMutationGuardCore'

describe('marathonDataPlaneMutationGuardCore R-22', () => {
  it('blocks provider mutation during marathon except user_explicit', () => {
    assert.equal(
      shouldBlockMarathonProviderMutation({
        marathonTruthActive: true,
        purpose: 'marathon_rescue',
      }),
      true,
    )
    assert.equal(
      shouldBlockMarathonProviderMutation({
        marathonTruthActive: true,
        purpose: 'hy2_tunnel_vitality',
      }),
      true,
    )
    assert.equal(
      shouldBlockMarathonProviderMutation({
        marathonTruthActive: true,
        purpose: 'user_explicit',
      }),
      false,
    )
    assert.equal(
      shouldBlockMarathonProviderMutation({
        marathonTruthActive: false,
        purpose: 'marathon_rescue',
      }),
      false,
    )
  })

  it('formats blocked provider update log line', () => {
    const line = formatMarathonProviderMutationBlockedLogLine({
      operation: 'provider_update',
      providerName: '678a1sub001-vps',
      purpose: 'marathon_rescue',
      cursorConnectionCount: 22,
    })
    assert.match(line, /blocked_provider_update/)
    assert.match(line, /marathon_truth_active=1/)
    assert.match(line, /data_plane_action=none/)
  })
})
