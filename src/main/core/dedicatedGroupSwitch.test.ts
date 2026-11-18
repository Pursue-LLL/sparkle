import assert from 'node:assert/strict'
import { after, before, describe, it, mock } from 'node:test'
import { DEDICATED_GROUP_IDS } from './dedicatedGroups'
import type * as DedicatedGroupSwitch from './dedicatedGroupSwitch'

let appConfig: Partial<AppConfig> = {}
let readFails = false

describe('dedicatedGroupSwitch', () => {
  let sut: typeof DedicatedGroupSwitch

  before(async () => {
    mock.module('../config', {
      exports: {
        getAppConfig: async (): Promise<Partial<AppConfig>> => {
          if (readFails) throw new Error('config unreadable')
          return appConfig
        }
      }
    })
    sut = await import('./dedicatedGroupSwitch')
  })

  after(() => {
    mock.restoreAll()
  })

  it('reads the defaults while nothing was saved', async () => {
    appConfig = {}

    assert.deepEqual(await sut.loadDedicatedGroupSwitches(), {
      grok: false,
      gemini: true,
      mail: true,
      agy: true
    })
  })

  it('gives every group a gate that answers for that group alone', async () => {
    appConfig = { dedicatedGroups: { grok: true, gemini: false } }

    const answers = await Promise.all(DEDICATED_GROUP_IDS.map((id) => sut.dedicatedGroupGate(id)()))

    assert.deepEqual(answers, [true, false, true, true])
  })

  it('reads the saved switch on every call, so a change applies without a restart', async () => {
    const gate = sut.dedicatedGroupGate('mail')

    appConfig = { dedicatedGroups: { mail: true } }
    assert.equal(await gate(), true)
    appConfig = { dedicatedGroups: { mail: false } }
    assert.equal(await gate(), false)
    appConfig = {}
    assert.equal(await gate(), true, 'back to the default once the choice is gone')
  })

  it('lets a failed read reach the caller instead of guessing an answer', async () => {
    readFails = true
    try {
      await assert.rejects(sut.dedicatedGroupGate('agy')(), { message: 'config unreadable' })
    } finally {
      readFails = false
    }
  })
})
