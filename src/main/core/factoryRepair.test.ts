import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import {
  GROUP,
  groupNames,
  groupOf,
  loadFactoryRig,
  rulesOf,
  subscription,
  type FactoryRig,
  type RigState
} from './factoryRig'

describe('factory: repairing what the subscription gets wrong', () => {
  let rig: FactoryRig
  let state: RigState

  before(async () => {
    rig = await loadFactoryRig()
    state = rig.state
  })
  beforeEach(() => rig.reset())
  after(() => rig.dispose())

  describe('a subscription that is not self-consistent', () => {
    it('drops members that no longer exist without turning the group into a direct exit', async () => {
      const failover = { type: 'fallback', url: 'https://example.com', interval: 300 }
      state.profile = subscription({
        'proxy-groups': [
          { name: GROUP, type: 'select', proxies: ['台湾 01', '日本 01', 'DIRECT'] },
          { name: '备用', ...failover, proxies: ['台湾 01', '已下架节点'] },
          { name: '全失效', ...failover, proxies: ['已下架节点'] }
        ],
        rules: ['DOMAIN-SUFFIX,example.com,备用', `MATCH,${GROUP}`]
      })

      const config = await rig.generate()

      assert.deepEqual(groupOf(config, '备用')?.proxies, undefined)
      assert.deepEqual(groupOf(config, '备用')?.use, ['p1'])
      assert.deepEqual(groupOf(config, '全失效')?.proxies, ['DIRECT'])
      assert.ok(
        state.logs.includes(
          '[Factory]: dropped unknown group members: 备用->[已下架节点]; 全失效->[已下架节点]\n'
        )
      )
    })

    it('says nothing about dropped members when there were none', async () => {
      await rig.generate()

      assert.equal(
        state.logs.some((line) => line.includes('dropped unknown group members')),
        false
      )
    })

    it('points a rule at the main group when the group it names does not exist', async () => {
      state.profile = subscription({
        rules: ['DOMAIN-SUFFIX,example.com,不存在的组', `MATCH,${GROUP}`]
      })

      const rules = rulesOf(await rig.generate())

      assert.ok(rules.includes(`DOMAIN-SUFFIX,example.com,${GROUP}`))
      assert.equal(
        rules.some((rule) => rule.includes('不存在的组')),
        false
      )
    })

    it('lists each provider once per group', async () => {
      state.profile = subscription({
        'proxy-groups': [
          { name: GROUP, type: 'select', proxies: ['DIRECT'] },
          { name: '重复', type: 'fallback', url: 'https://example.com', use: ['p1', 'p1'] }
        ]
      })

      assert.deepEqual(groupOf(await rig.generate(), '重复')?.use, ['p1'])
    })

    it('drops groups that did not come from the subscription', async () => {
      state.controlled = {
        'proxy-groups': [{ name: '外来组', type: 'select', proxies: ['DIRECT'] }]
      }

      assert.equal(groupNames(await rig.generate()).includes('外来组'), false)
    })

    it('appends a MATCH rule to the main group when the subscription has none', async () => {
      state.profile = subscription({ rules: [`DOMAIN-SUFFIX,example.com,${GROUP}`] })

      const rules = rulesOf(await rig.generate())

      assert.equal(rules.at(-1), `MATCH,${GROUP}`)
      assert.ok(state.logs.includes(`[Factory]: appended MATCH fallback -> ${GROUP}\n`))
    })

    it('keeps the subscription’s own MATCH and says nothing', async () => {
      await rig.generate()

      assert.equal(
        state.logs.some((line) => line.includes('appended MATCH fallback')),
        false
      )
    })

    it('adds the CN direct baseline only when the subscription routes no CN traffic itself', async () => {
      await rig.generate()
      const baselineNote = '[Factory]: subscription has no CN rules, appended CN direct baseline\n'
      assert.ok(state.logs.includes(baselineNote))

      state.logs = []
      state.profile = subscription({ rules: ['GEOSITE,CN,DIRECT', `MATCH,${GROUP}`] })
      const rules = rulesOf(await rig.generate())

      assert.equal(state.logs.includes(baselineNote), false)
      assert.equal(rules.filter((rule) => rule === 'GEOSITE,CN,DIRECT').length, 1)
      assert.equal(rules.includes('GEOIP,CN,DIRECT'), false)
    })
  })
})
