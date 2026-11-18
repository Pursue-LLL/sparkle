import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { InvalidProfileContentError } from './profileContentCore'
import {
  createDueProfileUpdateRunner,
  FAILURE_NOTICE_AFTER_MS,
  type FailureNotice
} from './profileUpdaterCore'
import { at, merged, remote } from './profileUpdaterRig'

describe('createDueProfileUpdateRunner: telling the user a subscription keeps failing', () => {
  const SECOND = 1000
  const MINUTE = 60 * SECOND
  const START = at(12, 11, 0)

  type Outcome = 'network' | 'invalid' | 'long' | 'ok'

  function setup(ids: readonly string[] = ['main']) {
    const items = ids.map((id) => remote({ id, name: `订阅${id}`, updated: at(10, 7, 0) }))
    const outcomes = new Map<string, Outcome>(ids.map((id) => [id, 'network']))
    const notices: FailureNotice[] = []
    const logs: string[] = []
    let clock = START
    let notifyError: Error | undefined
    const build = (): (() => Promise<number>) =>
      createDueProfileUpdateRunner({
        now: () => clock,
        listItems: async () => items,
        update: async (item) => {
          const outcome = outcomes.get(item.id)
          if (outcome === 'network') {
            throw new Error(`getaddrinfo ENOTFOUND ${item.id}`)
          }
          if (outcome === 'invalid') {
            throw new InvalidProfileContentError(
              `订阅内容不是有效的配置：${item.name}（不是配置文件，开头：「<!DOCTYPE html>」）`
            )
          }
          if (outcome === 'long') {
            throw new Error('x'.repeat(500))
          }
          const stored = items.find((candidate) => candidate.id === item.id) as ProfileItem
          stored.updated = clock
        },
        log: async (message) => {
          logs.push(message)
        },
        notify: async (notice) => {
          if (notifyError) {
            throw notifyError
          }
          notices.push(notice)
        }
      })
    return {
      items,
      notices,
      logs,
      run: build(),
      build,
      advance: (ms: number) => {
        clock += ms
      },
      outcome: (id: string, value: Outcome) => {
        outcomes.set(id, value)
      },
      /** 成功更新会把 updated 推到现在；回到上一个计划时刻之前，下一次检查才会再次到期。 */
      makeDue: (id: string) => {
        const stored = items.find((candidate) => candidate.id === id) as ProfileItem
        stored.updated = at(10, 7, 0)
      },
      failNotification: (error: Error) => {
        notifyError = error
      }
    }
  }

  it('stays quiet until the failure has lasted long enough, then says which subscription and why', async () => {
    const { run, notices, logs, advance } = setup()

    await run()
    advance(FAILURE_NOTICE_AFTER_MS - 1)
    await run()
    assert.equal(notices.length, 0, 'one millisecond short of lasting long enough')

    advance(1)
    await run()

    assert.deepEqual(notices, [
      {
        id: 'profile-update-failed:main',
        title: '订阅更新失败',
        body: '「订阅main」已连续 3 次更新失败，仍在使用上一份内容：getaddrinfo ENOTFOUND main'
      }
    ])
    assert.match(logs.join(''), /failure notice sent id=main name=订阅main failures=3/)
  })

  it('does not mistake failures seconds apart for an outage', async () => {
    // GUI 心跳与 LaunchAgent 是两个触发源、相位不同，相邻两次尝试可以只隔几秒。
    const { run, notices, advance } = setup()

    await run()
    advance(4 * SECOND)
    await run()
    advance(30 * SECOND)
    await run()
    advance(MINUTE)
    await run()

    assert.equal(notices.length, 0)
  })

  it('does not repeat itself for the rest of the streak', async () => {
    const { run, notices, advance } = setup()

    for (let round = 0; round < 12; round += 1) {
      await run()
      advance(FAILURE_NOTICE_AFTER_MS)
    }

    assert.equal(notices.length, 1)
  })

  it('starts the clock again after a success', async () => {
    const { run, notices, advance, outcome, makeDue } = setup()
    await run()

    advance(MINUTE)
    outcome('main', 'ok')
    await run()
    makeDue('main')
    outcome('main', 'network')
    advance(FAILURE_NOTICE_AFTER_MS - MINUTE)
    await run()

    assert.equal(notices.length, 0, 'the failure before the success no longer counts')
  })

  it('speaks again for the next streak, under the same id so it replaces the earlier notice', async () => {
    const { run, notices, advance, outcome, makeDue } = setup()
    await run()
    advance(FAILURE_NOTICE_AFTER_MS)
    await run()

    outcome('main', 'ok')
    await run()
    makeDue('main')
    outcome('main', 'network')
    await run()
    advance(FAILURE_NOTICE_AFTER_MS)
    await run()

    assert.equal(notices.length, 2)
    assert.equal(notices[0].id, notices[1].id)
  })

  it('times each subscription on its own', async () => {
    const { run, notices, advance, outcome, makeDue } = setup(['main', 'mobile'])
    outcome('mobile', 'ok')
    await run()

    advance(FAILURE_NOTICE_AFTER_MS - MINUTE)
    makeDue('mobile')
    outcome('mobile', 'network')
    await run()
    advance(MINUTE)
    await run()

    assert.deepEqual(
      notices.map((notice) => notice.id),
      ['profile-update-failed:main'],
      'mobile has only been failing for one minute'
    )
  })

  it('counts invalid-content failures across the backoff, and a skipped wait is not an attempt', async () => {
    const { run, notices, advance, outcome } = setup()
    outcome('main', 'invalid')
    await run()

    advance(FAILURE_NOTICE_AFTER_MS - 1)
    await run()
    assert.equal(notices.length, 0, 'still waiting: nothing was attempted, so nothing failed')

    advance(1)
    await run()
    assert.equal(notices.length, 1)
    assert.match(notices[0].body, /已连续 2 次/, 'the run during the wait was skipped, not counted')
  })

  it('does not repeat what the server sent back when the content is invalid', async () => {
    const { run, notices, logs, advance, outcome } = setup()
    outcome('main', 'invalid')
    await run()
    advance(FAILURE_NOTICE_AFTER_MS)
    await run()

    assert.equal(
      notices[0].body,
      '「订阅main」已连续 2 次更新失败，仍在使用上一份内容：服务端返回的内容不是有效的配置'
    )
    assert.match(logs.join(''), /开头：「<!DOCTYPE html>」/, 'the details stay in the log')
  })

  it('treats failures of different kinds as one streak', async () => {
    const { run, notices, advance, outcome } = setup()
    await run()

    advance(FAILURE_NOTICE_AFTER_MS)
    outcome('main', 'invalid')
    await run()

    assert.equal(notices.length, 1)
  })

  it('also covers a merged profile whose rebuild keeps failing', async () => {
    const items: ProfileItem[] = [
      remote({ id: 'main', updated: at(12, 8, 0) }),
      remote({ id: 'mobile', name: '移动订阅', updated: at(12, 8, 0) }),
      merged({ updated: at(10, 7, 0) })
    ]
    const notices: FailureNotice[] = []
    let clock = START
    const run = createDueProfileUpdateRunner({
      now: () => clock,
      listItems: async () => items,
      update: async () => {
        throw new Error('订阅内容不是有效的配置：主订阅')
      },
      log: async () => undefined,
      notify: async (notice) => {
        notices.push(notice)
      }
    })

    await run()
    clock += FAILURE_NOTICE_AFTER_MS
    await run()

    assert.equal(notices.length, 1)
    assert.match(notices[0].body, /「合并版」已连续 2 次更新失败/)
  })

  it('keeps going when the notice cannot be shown, and logs why', async () => {
    const { run, notices, logs, items, advance, failNotification, outcome, makeDue } = setup([
      'main',
      'mobile'
    ])
    outcome('mobile', 'ok')
    failNotification(new Error('通知不可用'))
    await run()

    advance(FAILURE_NOTICE_AFTER_MS)
    makeDue('mobile')
    const updated = await run()

    assert.equal(updated, 1, 'the subscription after the failing one is still updated')
    assert.deepEqual(notices, [])
    assert.match(logs.join(''), /failure notice failed id=main name=订阅main: 通知不可用/)
    assert.ok(!logs.join('').includes('failure notice sent'))
    assert.equal(items[1].updated, START + FAILURE_NOTICE_AFTER_MS)
  })

  it('keeps a long failure reason short', async () => {
    const { run, notices, advance, outcome } = setup()
    outcome('main', 'long')
    await run()
    advance(FAILURE_NOTICE_AFTER_MS)
    await run()

    const { body } = notices[0]
    assert.ok(body.endsWith('…'), body)
    assert.ok(!body.includes('x'.repeat(101)), 'only the first 100 characters of the reason')
    assert.ok(body.includes('x'.repeat(100)))
  })

  it('says nothing about notices when nobody asked to be notified', async () => {
    const logs: string[] = []
    let clock = START
    const run = createDueProfileUpdateRunner({
      now: () => clock,
      listItems: async () => [remote({ id: 'main', updated: at(10, 7, 0) })],
      update: async () => {
        throw new Error('getaddrinfo ENOTFOUND main')
      },
      log: async (message) => {
        logs.push(message)
      }
    })

    await run()
    clock += FAILURE_NOTICE_AFTER_MS
    await run()

    assert.equal(logs.length, 2, 'only the two "update failed" lines')
    assert.ok(!logs.join('').includes('failure notice'))
  })

  it('never notices in a one-shot process, because the streak lives in memory', async () => {
    const { build, notices, advance } = setup()

    await build()()
    advance(FAILURE_NOTICE_AFTER_MS)
    await build()()
    advance(FAILURE_NOTICE_AFTER_MS)
    await build()()

    assert.deepEqual(notices, [])
  })
})
