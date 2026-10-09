import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parse } from 'yaml'
import {
  buildMergedProfileStr,
  createMergeRebuilder,
  findDependentMergeItems,
  matchesRegions,
  ReadMergeSource
} from './mergeProfileCore'

const REGIONS = ['台湾', '日本', '新加坡', '韩国', '美国', '越南', '菲律宾', '马来西亚']

const BASE_YAML = `
port: 7890
proxies:
  - { name: "🇭🇰 香港 01", type: trojan, server: a.example, port: 443 }
  - { name: "🇭🇰 台湾 M1 | 港澳B站", type: trojan, server: b.example, port: 443 }
  - { name: "🇸🇬 泰国 B1CM | 广新隧道", type: trojan, server: c.example, port: 443 }
  - { name: "🇯🇵 日本 01", type: trojan, server: d.example, port: 443 }
  - { name: "----- 账号信息 -----", type: trojan, server: e.example, port: 443 }
proxy-groups:
  - { name: "🚀 节点选择", type: select, proxies: ["🇭🇰 香港 01", "🇭🇰 台湾 M1 | 港澳B站", "🇸🇬 泰国 B1CM | 广新隧道", "🇯🇵 日本 01", "----- 账号信息 -----"] }
  - { name: "🎯 全球直连", type: select, proxies: [DIRECT, "🚀 节点选择", "🇭🇰 香港 01", "🇯🇵 日本 01"] }
  - { name: "🛑 全球拦截", type: select, proxies: [REJECT, DIRECT] }
rules:
  - DOMAIN-SUFFIX,example.com,🚀 节点选择
  - MATCH,🎯 全球直连
`

const OTHER_YAML = `
port: 9999
proxies:
  - { name: "🇺🇸 美国 01", type: vless, server: f.example, port: 443 }
  - { name: "🇩🇪 德国 01", type: vless, server: g.example, port: 443 }
  - { name: "🇯🇵 日本 01", type: vless, server: h.example, port: 443 }
  - { name: "🇭🇰 香港 02", type: vless, server: i.example, port: 443 }
proxy-groups:
  - { name: "🔰 手动选择", type: select, proxies: ["🇺🇸 美国 01", "🇩🇪 德国 01", "🇯🇵 日本 01"] }
rules:
  - MATCH,🔰 手动选择
`

const sources: Record<string, { label: string; yaml: string; derived: boolean }> = {
  base: { label: '主订阅', yaml: BASE_YAML, derived: false },
  other: { label: '移动订阅', yaml: OTHER_YAML, derived: false },
  merged: { label: '合并版', yaml: '', derived: true }
}

const readSource: ReadMergeSource = async (id) => sources[id]

function spec(overrides: Partial<MergeProfileSpec> = {}): MergeProfileSpec {
  return {
    base: 'base',
    sources: ['base', 'other'],
    regions: REGIONS,
    dedicatedRegions: [],
    ...overrides
  }
}

function names(list: { name: string }[]): string[] {
  return list.map((entry) => entry.name)
}

describe('mergeProfileCore', () => {
  it('matchesRegions 按中文国家名匹配，不看旗帜 emoji', () => {
    assert.equal(matchesRegions('🇭🇰 台湾 M1', REGIONS), true)
    assert.equal(matchesRegions('🇸🇬 泰国 B1', REGIONS), false)
    assert.equal(matchesRegions('🇭🇰 香港 01', REGIONS), false)
  })

  it('节点取各来源命中地区的并集，其余剔除', async () => {
    const merged = parse(await buildMergedProfileStr(spec(), readSource))
    assert.deepEqual(names(merged.proxies), [
      '🇭🇰 台湾 M1 | 港澳B站',
      '🇯🇵 日本 01',
      '🇺🇸 美国 01',
      '🇯🇵 日本 01 · 移动订阅'
    ])
  })

  it('策略组、规则与其他顶层字段沿用 base，节点引用整体替换为合并节点', async () => {
    const merged = parse(await buildMergedProfileStr(spec(), readSource))
    const mergedNames = names(merged.proxies)
    const [select, direct, block] = merged['proxy-groups']
    assert.deepEqual(select.proxies, mergedNames)
    assert.deepEqual(direct.proxies, ['DIRECT', '🚀 节点选择', ...mergedNames])
    assert.deepEqual(block.proxies, ['REJECT', 'DIRECT'])
    assert.equal(select['exclude-filter'], undefined)
    assert.equal(merged.port, 7890)
    assert.deepEqual(merged.rules, ['DOMAIN-SUFFIX,example.com,🚀 节点选择', 'MATCH,🎯 全球直连'])
  })

  it('专用地区节点保留在节点池，但被挡在含节点的普通组之外', async () => {
    const merged = parse(
      await buildMergedProfileStr(spec({ dedicatedRegions: ['香港'] }), readSource)
    )
    const generalNames = names(merged.proxies).filter((name) => !name.includes('香港'))
    assert.deepEqual(
      names(merged.proxies).filter((name) => name.includes('香港')),
      ['🇭🇰 香港 01', '🇭🇰 香港 02']
    )
    const [select, direct, block] = merged['proxy-groups']
    assert.deepEqual(select.proxies, generalNames)
    assert.equal(select['exclude-filter'], '香港')
    assert.deepEqual(direct.proxies, ['DIRECT', '🚀 节点选择', ...generalNames])
    assert.equal(direct['exclude-filter'], '香港')
    assert.equal(block['exclude-filter'], undefined)
  })

  it('专用地区关键词中的正则元字符会被转义，并与 base 已有的 exclude-filter 合并', async () => {
    sources.filtered = {
      label: '带过滤',
      yaml: `
proxies:
  - { name: "🇯🇵 日本 01", type: trojan, server: a.example, port: 443 }
proxy-groups:
  - { name: G, type: select, proxies: ["🇯🇵 日本 01"], exclude-filter: "过期" }
`,
      derived: false
    }
    const merged = parse(
      await buildMergedProfileStr(
        spec({ base: 'filtered', sources: ['filtered'], dedicatedRegions: ['HK.1'] }),
        readSource
      )
    )
    assert.equal(merged['proxy-groups'][0]['exclude-filter'], '过期|HK\\.1')
  })

  it('没有任何非专用节点命中地区时报错，避免生成空组', async () => {
    await assert.rejects(
      buildMergedProfileStr(spec({ regions: ['火星'] }), readSource),
      /没有匹配地区的节点/
    )
    await assert.rejects(
      buildMergedProfileStr(spec({ regions: ['火星'], dedicatedRegions: ['香港'] }), readSource),
      /没有匹配地区的节点/
    )
  })

  it('缺少地区或来源时报错', async () => {
    await assert.rejects(buildMergedProfileStr(spec({ regions: [] }), readSource), /至少需要/)
    await assert.rejects(buildMergedProfileStr(spec({ sources: [] }), readSource), /至少需要/)
  })

  it('来源内容不是配置对象或 base 没有策略组时报错，避免把垃圾内容写进合并结果', async () => {
    sources.errorPage = { label: '错误页', yaml: 'Service Unavailable', derived: false }
    sources.noGroups = {
      label: '无策略组',
      yaml: 'proxies:\n  - { name: "🇯🇵 日本 01", type: trojan, server: a.example, port: 443 }\n',
      derived: false
    }
    await assert.rejects(
      buildMergedProfileStr(spec({ sources: ['base', 'errorPage'] }), readSource),
      /不是有效的配置：错误页/
    )
    await assert.rejects(
      buildMergedProfileStr(spec({ base: 'noGroups', sources: ['noGroups'] }), readSource),
      /没有策略组：无策略组/
    )
  })

  it('合并订阅不能作为来源', async () => {
    await assert.rejects(
      buildMergedProfileStr(spec({ sources: ['merged'] }), readSource),
      /不能以另一个合并订阅为来源/
    )
  })

  it('findDependentMergeItems 只返回依赖变更订阅的合并订阅', () => {
    const merge = spec()
    const items = [
      { id: 'base', type: 'remote', name: '主订阅' },
      { id: 'other', type: 'remote', name: '移动订阅' },
      { id: 'merged', type: 'local', name: '合并版', merge },
      {
        id: 'unrelated',
        type: 'local',
        name: '其他',
        merge: { ...merge, base: 'x', sources: ['x'] }
      }
    ] as ProfileItem[]
    assert.deepEqual(
      findDependentMergeItems(items, 'other').map((item) => item.id),
      ['merged']
    )
    assert.deepEqual(findDependentMergeItems(items, 'merged'), [])
  })
})

describe('createMergeRebuilder', () => {
  const mergeItem = (id: string, base: string): ProfileItem =>
    ({ id, type: 'local', name: id, merge: spec({ base, sources: [base] }) }) as ProfileItem
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, ms)
    })

  it('只重建依赖变更订阅的合并订阅，并串行执行并发触发的重建', async () => {
    const events: string[] = []
    const rebuild = createMergeRebuilder({
      listItems: async () => [mergeItem('m1', 'a'), mergeItem('m2', 'b')],
      build: async (merge) => merge.base,
      apply: async (id) => {
        events.push(`start:${id}`)
        await sleep(15)
        events.push(`end:${id}`)
      },
      onError: async () => {}
    })
    await Promise.all([rebuild('a'), rebuild('b'), rebuild('a')])
    assert.deepEqual(events, ['start:m1', 'end:m1', 'start:m2', 'end:m2', 'start:m1', 'end:m1'])
  })

  it('单个合并订阅重建失败只上报，不影响其余合并订阅与后续重建', async () => {
    const applied: string[] = []
    const errors: string[] = []
    let failBuild = true
    const rebuild = createMergeRebuilder({
      listItems: async () => [mergeItem('bad', 'a'), mergeItem('good', 'a')],
      build: async (merge) => {
        if (failBuild && merge.sources[0] === 'a' && applied.length === 0) {
          failBuild = false
          throw new Error('没有匹配地区的节点')
        }
        return 'yaml'
      },
      apply: async (id) => {
        applied.push(id)
      },
      onError: async (item, error) => {
        errors.push(`${item?.id}:${(error as Error).message}`)
      }
    })
    await rebuild('a')
    assert.deepEqual(applied, ['good'])
    assert.deepEqual(errors, ['bad:没有匹配地区的节点'])
    await rebuild('a')
    assert.deepEqual(applied, ['good', 'bad', 'good'])
  })

  it('读取订阅列表失败或上报本身抛错，都不会中断后续重建', async () => {
    let listFails = true
    const applied: string[] = []
    const rebuild = createMergeRebuilder({
      listItems: async () => {
        if (listFails) {
          throw new Error('读取失败')
        }
        return [mergeItem('m1', 'a')]
      },
      build: async () => 'yaml',
      apply: async (id) => {
        applied.push(id)
      },
      onError: async () => {
        throw new Error('通知失败')
      }
    })
    await rebuild('a')
    listFails = false
    await rebuild('a')
    assert.deepEqual(applied, ['m1'])
  })
})
