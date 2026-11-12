import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runOverrideScript, type OverrideLogSink } from './overrideScript'

type Fields = Record<string, unknown>

function profileOf(fields: Fields): MihomoConfig {
  return fields as unknown as MihomoConfig
}

function createSink(): { writes: { text: string; flag: 'w' | 'a' }[]; sink: OverrideLogSink } {
  const writes: { text: string; flag: 'w' | 'a' }[] = []
  return {
    writes,
    sink: (text, flag) => {
      writes.push({ text, flag })
    }
  }
}

/** 脚本在独立的 vm 上下文里创建对象，原型与宿主不同：先经 JSON 还原成宿主对象再比较。 */
function plain(value: unknown): Fields {
  return JSON.parse(JSON.stringify(value)) as Fields
}

async function run(script: string, fields: Fields = { mode: 'rule' }): Promise<Fields> {
  return plain(await runOverrideScript(profileOf(fields), script, createSink().sink))
}

describe('runOverrideScript: result handling', () => {
  it('returns what main produced and logs the start and the success', async () => {
    const { writes, sink } = createSink()
    const result = await runOverrideScript(
      profileOf({ mode: 'rule' }),
      `function main(config) { config.mode = 'global'; return config }`,
      sink
    )

    assert.equal((result as unknown as Fields).mode, 'global')
    assert.deepEqual(writes, [
      { text: '[info] 开始执行脚本\n', flag: 'w' },
      { text: '[info] 脚本执行成功\n', flag: 'a' }
    ])
  })

  it('waits for an async main', async () => {
    const result = await run(
      `async function main(config) { await Promise.resolve(); config.async = true; return config }`
    )

    assert.equal(result.async, true)
  })

  it('hands main a copy, so the caller keeps its own object', async () => {
    const original = profileOf({ mode: 'rule', rules: ['MATCH,DIRECT'] })

    const result = await runOverrideScript(
      original,
      `function main(config) { config.rules.push('GEOIP,CN,DIRECT'); return config }`,
      createSink().sink
    )

    assert.notEqual(result, original)
    assert.deepEqual((original as unknown as Fields).rules, ['MATCH,DIRECT'])
    assert.deepEqual(plain(result).rules, ['MATCH,DIRECT', 'GEOIP,CN,DIRECT'])
  })

  it('keeps the original profile and says why when the script throws', async () => {
    const { writes, sink } = createSink()
    const original = profileOf({ mode: 'rule' })

    const result = await runOverrideScript(
      original,
      `function main(config) { config.mode = 'global'; throw new Error('boom') }`,
      sink
    )

    assert.equal(result, original)
    assert.deepEqual((original as unknown as Fields).mode, 'rule')
    assert.equal(writes.at(-1)?.text, '[exception] 脚本执行失败：Error: boom\n')
  })

  it('keeps the original profile when the script has no main', async () => {
    const { writes, sink } = createSink()
    const original = profileOf({ mode: 'rule' })

    assert.equal(await runOverrideScript(original, `const unused = 1`, sink), original)
    assert.match(writes.at(-1)?.text ?? '', /ReferenceError: main is not defined/)
  })

  it('keeps the original profile when the script itself does not parse', async () => {
    const original = profileOf({ mode: 'rule' })

    assert.equal(await runOverrideScript(original, `function main(`, createSink().sink), original)
  })

  it('rejects results that are not a plain object', async () => {
    for (const returned of ['null', '1', `'text'`, '[]', 'undefined', 'true']) {
      const { writes, sink } = createSink()
      const original = profileOf({ mode: 'rule' })

      const result = await runOverrideScript(
        original,
        `function main() { return ${returned} }`,
        sink
      )

      assert.equal(result, original, returned)
      assert.match(writes.at(-1)?.text ?? '', /脚本返回值必须是对象/, returned)
    }
  })
})

describe('runOverrideScript: script environment', () => {
  it('writes console output with its level and formatted arguments', async () => {
    const { writes, sink } = createSink()
    await runOverrideScript(
      profileOf({}),
      `function main(config) {
        const loop = {}
        loop.self = loop
        console.log('a', { b: 1 })
        console.info(2)
        console.debug(loop)
        console.error(new Error('bad'))
        return config
      }`,
      sink
    )

    const texts = writes.map((write) => write.text)
    assert.ok(texts.includes('[log] "a" {"b":1}\n'))
    assert.ok(texts.includes('[info] 2\n'))
    assert.ok(texts.includes('[debug] [object Object]\n'))
    assert.ok(texts.some((text) => text.startsWith('[error] Error: bad\nError: bad\n')))
  })

  it('offers yaml, base64 helpers, Buffer and fetch', async () => {
    const result = await run(
      `function main(config) {
        config.yamlValue = yaml.parse('a: 1').a
        config.yamlText = yaml.stringify({ b: 2 })
        config.encoded = [b64e('hi'), b64e(Buffer.from('hi'))]
        config.decoded = b64d('aGk=')
        config.hasFetch = typeof fetch
        return config
      }`
    )

    assert.equal(result.yamlValue, 1)
    assert.equal(result.yamlText, 'b: 2\n')
    assert.deepEqual(result.encoded, ['aGk=', 'aGk='])
    assert.equal(result.decoded, 'hi')
    assert.equal(result.hasFetch, 'function')
  })

  it('encodes binary buffers byte for byte', async () => {
    const result = await run(
      `function main(config) {
        config.encoded = b64e(Buffer.from([255, 254, 0]))
        return config
      }`
    )

    assert.equal(result.encoded, '//4A')
  })

  it('does not hand the script the Node module system, process or timers', async () => {
    const result = await run(
      `function main(config) {
        config.seen = [typeof require, typeof process, typeof module, typeof setTimeout]
        return config
      }`
    )

    assert.deepEqual(result.seen, ['undefined', 'undefined', 'undefined', 'undefined'])
  })

  it('runs every script in a fresh context', async () => {
    await run(`globalThis.leak = 1; function main(config) { return config }`)
    const result = await run(`function main(config) { config.leak = typeof leak; return config }`)

    assert.equal(result.leak, 'undefined')
  })
})

describe('runOverrideScript: logging failures', () => {
  it('never lets a broken log sink change the outcome', async () => {
    const broken: OverrideLogSink = () => {
      throw new Error('disk full')
    }
    const original = profileOf({ mode: 'rule' })

    const ok = await runOverrideScript(
      original,
      `function main(config) { config.mode = 'global'; return config }`,
      broken
    )
    const failed = await runOverrideScript(
      original,
      `function main() { throw new Error('x') }`,
      broken
    )

    assert.equal((ok as unknown as Fields).mode, 'global')
    assert.equal(failed, original)
  })
})
