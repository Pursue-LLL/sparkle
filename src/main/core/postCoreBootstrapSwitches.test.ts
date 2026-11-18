import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEDICATED_GROUP_IDS, type DedicatedGroupId } from './dedicatedGroups'
import {
  allEnabled,
  behavior,
  calls,
  gates,
  runBootstrap,
  usePostCoreBootstrapRig
} from './postCoreBootstrapRig'

describe('postCoreBootstrap · 专用组开关', () => {
  const bootstrap = usePostCoreBootstrapRig()
  const run = (): Promise<void> => runBootstrap(bootstrap())

  const LOOPS_BY_GROUP: Record<DedicatedGroupId, string[]> = {
    grok: ['grok:loop'],
    gemini: ['gemini:loop'],
    mail: ['mail:current-node', 'mail:loop'],
    agy: ['agy:loop']
  }

  for (const id of DEDICATED_GROUP_IDS) {
    it(`skips the ${id} bootstrap while its group is off, but still starts its loop to pick the switch up later`, async () => {
      behavior.enabled[id] = false

      await run()

      assert.equal(calls.includes(`${id}:bootstrap`), false)
      for (const loop of LOOPS_BY_GROUP[id]) {
        assert.ok(calls.includes(loop), loop)
      }
      for (const other of DEDICATED_GROUP_IDS.filter((group) => group !== id)) {
        assert.ok(calls.includes(`${other}:bootstrap`), `${other} is unaffected`)
      }
    })
  }

  it('hands every loop the switch of its own group', async () => {
    await run()

    for (const id of DEDICATED_GROUP_IDS) {
      for (const loop of LOOPS_BY_GROUP[id]) {
        const gate = gates.get(loop)
        assert.ok(gate, loop)
        behavior.enabled = { grok: false, gemini: false, mail: false, agy: false }
        behavior.enabled[id] = true
        assert.equal(await gate(), true, `${loop} follows ${id}`)
        behavior.enabled = allEnabled()
        behavior.enabled[id] = false
        assert.equal(await gate(), false, `${loop} follows ${id}`)
      }
    }
  })
})
