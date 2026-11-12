import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { forSeeds, type Random } from '../core/seededProperty'
import { parseYaml, stringifyYaml } from './yaml'

describe('parseYaml Reality short-id in generated documents', () => {
  interface Proxy {
    name: string
    shortId: string
    alpn: string[]
  }

  const DIGITS = [...'0123456789']
  const HEX_LETTERS = [...'abcdef']
  const TRICKY = ['12345678', '01234567', '1e5', '12e3456', '0', '00', '1234567890123456789']

  /** 绝大多数是纯数字：只有这种写法才会被 YAML 当成数字。 */
  function randomShortId(random: Random): string {
    if (random.chance(0.3)) return random.pick(TRICKY)
    return Array.from({ length: random.pick([2, 8, 16]) }, () =>
      random.pick(random.chance(0.85) ? DIGITS : HEX_LETTERS)
    ).join('')
  }

  const flowProxy = (proxy: Proxy, index: number): string => {
    const alpn = proxy.alpn.length > 0 ? `, alpn: [${proxy.alpn.join(', ')}]` : ''
    const reality = `reality-opts: {public-key: pk${index}, short-id: ${proxy.shortId}}`
    return `{name: ${proxy.name}, type: vless${alpn}, ${reality}}`
  }

  /** 块风格代理；marker 是列表项 `-` 前的缩进，延续行比它多两格。 */
  function blockProxy(proxy: Proxy, index: number, marker: string, flowReality: boolean): string[] {
    const inner = `${marker}  `
    const reality = flowReality
      ? [`${inner}reality-opts: {public-key: pk${index}, short-id: ${proxy.shortId}}`]
      : [
          `${inner}reality-opts:`,
          `${inner}  public-key: pk${index}`,
          `${inner}  short-id: ${proxy.shortId} # panel`
        ]
    return [
      `${marker}- name: ${proxy.name}`,
      `${inner}type: vless`,
      ...(proxy.alpn.length > 0
        ? [`${inner}alpn:`, ...proxy.alpn.map((a) => `${inner}  - ${a}`)]
        : []),
      ...reality
    ]
  }

  const withMixedPort = (lines: string[]): string => [...lines, 'mixed-port: 7890', ''].join('\n')

  const documentStyles: Array<{ name: string; render: (proxies: Proxy[]) => string }> = [
    {
      name: 'block',
      render: (proxies) =>
        withMixedPort(['proxies:', ...proxies.flatMap((p, i) => blockProxy(p, i, '  ', false))])
    },
    {
      name: 'block list flush with the key',
      render: (proxies) =>
        withMixedPort(['proxies:', ...proxies.flatMap((p, i) => blockProxy(p, i, '', false))])
    },
    {
      name: 'block proxy with a flow reality-opts',
      render: (proxies) =>
        withMixedPort(['proxies:', ...proxies.flatMap((p, i) => blockProxy(p, i, '  ', true))])
    },
    {
      name: 'flow proxies in a block list',
      render: (proxies) =>
        withMixedPort(['proxies:', ...proxies.map((p, i) => `  - ${flowProxy(p, i)}`)])
    },
    {
      name: 'flow proxies spread over lines',
      render: (proxies) =>
        withMixedPort([
          'proxies:',
          ...proxies.flatMap((p, i) => ['  - {', `      ${flowProxy(p, i).slice(1, -1)},`, '    }'])
        ])
    },
    {
      name: 'everything in flow style',
      render: (proxies) =>
        `{proxies: [${proxies.map((p, i) => flowProxy(p, i)).join(', ')}], mixed-port: 7890}\n`
    }
  ]

  const expectedProxy = (proxy: Proxy, index: number): Record<string, unknown> => ({
    name: proxy.name,
    type: 'vless',
    ...(proxy.alpn.length > 0 ? { alpn: proxy.alpn } : {}),
    'reality-opts': { 'public-key': `pk${index}`, 'short-id': proxy.shortId }
  })

  it('keeps every short-id exactly as written, in every document style', () => {
    forSeeds(300, (random) => {
      const proxies = Array.from({ length: random.int(1, 4) }, (_, index) => ({
        name: `n${index}`,
        shortId: randomShortId(random),
        alpn: random.subset(['h2', 'http/1.1'], 0.5)
      }))
      const style = random.pick(documentStyles)

      const parsed = parseYaml(style.render(proxies))

      assert.deepEqual(
        parsed,
        { proxies: proxies.map(expectedProxy), 'mixed-port': 7890 },
        style.name
      )
      // 写回磁盘再读回来也要稳定（provider 文件就是这样来回的）
      assert.deepEqual(parseYaml(stringifyYaml(parsed)), parsed, style.name)
    })
  })
})
