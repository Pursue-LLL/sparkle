import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { InvalidProfileContentError } from './profileContentCore'
import { createDueProfileUpdateRunner, INVALID_CONTENT_RETRY_MS } from './profileUpdaterCore'
import { at, merged, remote } from './profileUpdaterRig'

describe('createDueProfileUpdateRunner: content the server returned is not a configuration', () => {
  const MINUTE = 60 * 1000
  const START = at(12, 11, 0)
  type Outcome = 'invalid' | 'network' | 'ok'

  function setup(ids: readonly string[] = ['main']) {
    const items = ids.map((id) => remote({ id, name: id, updated: at(10, 7, 0) }))
    const outcomes = new Map<string, Outcome>(ids.map((id) => [id, 'invalid']))
    const calls: string[] = []
    const logs: string[] = []
    let clock = START
    const build = (): (() => Promise<number>) =>
      createDueProfileUpdateRunner({
        now: () => clock,
        listItems: async () => items,
        update: async (item) => {
          calls.push(item.id)
          const outcome = outcomes.get(item.id)
          if (outcome === 'invalid') {
            throw new InvalidProfileContentError(
              `订阅内容不是有效的配置：${item.name}（不是配置文件）`
            )
          }
          if (outcome === 'network') {
            throw new Error(`getaddrinfo ENOTFOUND ${item.id}`)
          }
          const stored = items.find((candidate) => candidate.id === item.id) as ProfileItem
          stored.updated = clock
        },
        log: async (message) => {
          logs.push(message)
        }
      })
    return {
      items,
      calls,
      logs,
      run: build(),
      build,
      advance: (ms: number) => {
        clock += ms
      },
      outcome: (id: string, value: Outcome) => {
        outcomes.set(id, value)
      }
    }
  }

  it('keeps the old content, says when it will ask again, and does not ask before then', async () => {
    const { calls, logs, run, advance } = setup()

    assert.equal(await run(), 0)
    assert.deepEqual(calls, ['main'])
    assert.match(logs.join(''), /update failed id=main name=main: 订阅内容不是有效的配置：main/)
    assert.match(logs.join(''), /旧内容原样保留，第 1 次失败，5 分钟后重试/)

    advance(5 * MINUTE - 1)
    assert.equal(await run(), 0)
    assert.deepEqual(calls, ['main'], 'still waiting: no request goes out')

    advance(1)
    await run()
    assert.deepEqual(calls, ['main', 'main'])
    assert.match(logs.join(''), /第 2 次失败，15 分钟后重试/)
  })

  it('waits 5, 15, 30 then 60 minutes and stays at 60 however long the server keeps failing', async () => {
    const { calls, logs, run, advance } = setup()
    const waits = [...INVALID_CONTENT_RETRY_MS, INVALID_CONTENT_RETRY_MS.at(-1) as number]

    for (const wait of waits) {
      await run()
      advance(wait)
    }
    await run()

    assert.equal(calls.length, waits.length + 1)
    assert.deepEqual(
      logs.map((line) =>
        line
          .match(/第 (\d+) 次失败，(\d+) 分钟后重试/)
          ?.slice(1)
          .map(Number)
      ),
      [
        [1, 5],
        [2, 15],
        [3, 30],
        [4, 60],
        [5, 60],
        [6, 60]
      ]
    )
  })

  it('goes back to asking right away after one success, and starts counting from 1 again', async () => {
    const { calls, logs, items, run, advance, outcome } = setup()
    await run()
    advance(5 * MINUTE)
    await run()

    outcome('main', 'ok')
    advance(15 * MINUTE)
    assert.equal(await run(), 1)
    assert.match(logs.at(-1) ?? '', /update succeeded id=main/)

    // 下一个计划时刻之后再次到期，服务端又给了坏内容：从第 1 次、5 分钟重新计
    items[0].updated = at(10, 7, 0)
    outcome('main', 'invalid')
    const before = calls.length
    await run()
    assert.equal(calls.length, before + 1, 'no waiting left over from the earlier failures')
    assert.match(logs.at(-1) ?? '', /第 1 次失败，5 分钟后重试/)
  })

  it('keeps retrying network errors on every run, as before', async () => {
    const { calls, logs, run, outcome } = setup()
    outcome('main', 'network')

    await run()
    await run()
    await run()

    assert.deepEqual(calls, ['main', 'main', 'main'])
    assert.ok(logs.every((line) => !line.includes('后重试')))
  })

  it('does not let an invalid-content wait leak into a network error that follows', async () => {
    const { calls, run, advance, outcome } = setup()
    await run()
    advance(5 * MINUTE)
    outcome('main', 'network')
    await run()
    await run()

    assert.deepEqual(calls, ['main', 'main', 'main'])
  })

  it('waits per subscription: one stuck source does not hold back the others', async () => {
    const { calls, run, advance, outcome } = setup(['main', 'mobile'])
    outcome('mobile', 'network')

    await run()
    advance(MINUTE)
    await run()

    assert.deepEqual(calls, ['main', 'mobile', 'mobile'])
  })

  it('counts failures per subscription instead of sharing one counter', async () => {
    const { logs, run, advance } = setup(['main', 'mobile'])

    await run()
    advance(5 * MINUTE)
    await run()

    const attempts = logs.map((line) => line.match(/id=(\w+) .*第 (\d+) 次失败/)?.slice(1))
    assert.deepEqual(attempts, [
      ['main', '1'],
      ['mobile', '1'],
      ['main', '2'],
      ['mobile', '2']
    ])
  })

  it('counts again from the start after a restart, since the wait only lives in memory', async () => {
    const { calls, build, run } = setup()
    await run()

    await build()()

    assert.deepEqual(calls, ['main', 'main'])
  })

  it('applies the same wait to a merged profile whose rebuild reports invalid content', async () => {
    const items: ProfileItem[] = [
      remote({ id: 'main', updated: at(12, 8, 0) }),
      remote({ id: 'mobile', name: '移动订阅', updated: at(12, 8, 0) }),
      merged({ updated: at(10, 7, 0) })
    ]
    let calls = 0
    const run = createDueProfileUpdateRunner({
      now: () => START,
      listItems: async () => items,
      update: async () => {
        calls += 1
        throw new InvalidProfileContentError('订阅内容不是有效的配置：主订阅（不是配置文件）')
      },
      log: async () => undefined
    })

    await run()
    await run()

    assert.equal(calls, 1)
  })

  it('lets a merged profile whose rebuild fails with a plain error retry on every run', async () => {
    // 来源在今天的计划时刻之后更新过（不到期），合并版停在 10 号：只有合并版到期
    const items: ProfileItem[] = [
      remote({ id: 'main', updated: at(12, 8, 0) }),
      remote({ id: 'mobile', name: '移动订阅', updated: at(12, 8, 0) }),
      merged({ updated: at(10, 7, 0) })
    ]
    let calls = 0
    const run = createDueProfileUpdateRunner({
      now: () => START,
      listItems: async () => items,
      update: async () => {
        calls += 1
        throw new Error('订阅内容不是有效的配置：主订阅')
      },
      log: async () => undefined
    })

    await run()
    await run()

    assert.equal(calls, 2)
  })
})
