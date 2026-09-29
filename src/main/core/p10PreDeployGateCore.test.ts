import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { defaultP10PreDeploySrcMainRoot, runP10PreDeployGate } from './p10PreDeployGateCore'

describe('p10PreDeployGateCore', () => {
  it('passes code layer but blocks deploy until P10-6 artifacts', () => {
    const root = defaultP10PreDeploySrcMainRoot(process.cwd())
    const gate = runP10PreDeployGate(root)
    assert.equal(gate.codeLayerOk, true, gate.cases.filter((c) => !c.ok && !c.blocked).map((c) => c.name).join(','))
    assert.equal(gate.artifactLayerBlocked, true)
    assert.equal(gate.nextGateAllowed, false)
  })
})
