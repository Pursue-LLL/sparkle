import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import {
  assertLog,
  cacheFileExists,
  cacheKey,
  cacheRecord,
  callsStarting,
  HY2_TW,
  MINUTE_MS,
  NODES,
  readCache,
  readProviderMembers,
  settle,
  SS_TW,
  useMailRig,
  VLESS_JP,
  world,
  writeCache,
  writeProviderMembers
} from './sparkleMailProbeRig'
import { spyOnTimer } from './timerSpyHarness'

const MAIL_GROUP = '📧 邮件专用'
const CHECK_INTERVAL_MS = 5 * MINUTE_MS
const EARLY_CHECK_DELAY_MS = 30 * 1000
const FAILED_DIAL = '[TCP] dial imap.gmail.com:993 error: i/o timeout using 📧 邮件专用'
const SUCCESSFUL_MATCH = '[TCP] match DomainKeyword using 📧 邮件专用[台湾-HY2] imap.gmail.com:993'

/** mihomo 里有一条连接经过邮件组。 */
function mailInUse(): void {
  world.connections = { connections: [{ chains: ['台湾-HY2', MAIL_GROUP] }] }
}

/** 邮件组当前选中的节点及其成员。 */
function mailGroupOn(now: string | undefined, all: string[] = now ? [now] : []): void {
  world.group = { now, all }
}

async function advance(ms: number): Promise<void> {
  mock.timers.tick(ms)
  await settle()
}

const check = (): Promise<void> => advance(CHECK_INTERVAL_MS)

function logLine(payload: string | undefined): void {
  assert.ok(world.logHandler, 'the probe has not subscribed to the core logs')
  world.logHandler({ type: 'info', payload } as { type: string; payload: string })
}

describe('sparkleMailCurrentNodeProbe loop', () => {
  const mail = useMailRig()

  it('listens to the core logs once however often it is started', () => {
    mail.current().startSparkleMailCurrentNodeProbeLoop()
    mail.current().startSparkleMailCurrentNodeProbeLoop()

    assert.equal(world.subscriptions, 1)
  })

  it('registers one five-minute timer that does not keep the process alive', () => {
    const timers = spyOnTimer('setInterval')
    try {
      mail.current().startSparkleMailCurrentNodeProbeLoop()
      mail.current().startSparkleMailCurrentNodeProbeLoop()

      assert.deepEqual(timers.delays, [CHECK_INTERVAL_MS])
      assert.equal(timers.unrefs(), 1)
    } finally {
      timers.restore()
    }
  })

  it('checks after exactly five minutes', async () => {
    mailInUse()
    mailGroupOn('台湾-HY2')
    mail.current().startSparkleMailCurrentNodeProbeLoop()

    await advance(CHECK_INTERVAL_MS - 1)
    assert.deepEqual(callsStarting('detail:'), [])

    await advance(1)
    assert.deepEqual(callsStarting('detail:'), [`detail:${MAIL_GROUP}`])
  })
})

describe('sparkleMailCurrentNodeProbe when to check', () => {
  const mail = useMailRig()

  it('stays quiet while the mail group is unused', async () => {
    mailGroupOn('台湾-HY2')
    mail.current().startSparkleMailCurrentNodeProbeLoop()

    await check()

    assert.deepEqual(world.calls, [])
  })

  it('counts unreachable connection data as no activity', async () => {
    world.connectionsFailure = true
    mailGroupOn('台湾-HY2')
    mail.current().startSparkleMailCurrentNodeProbeLoop()

    await check()

    assert.deepEqual(world.calls, [])
  })

  it('probes the current node when a connection runs through the mail group', async () => {
    mailInUse()
    mailGroupOn('台湾-HY2', ['台湾-HY2', '台湾-SS'])
    mail.current().startSparkleMailCurrentNodeProbeLoop()

    await check()

    assert.deepEqual(callsStarting('probe:'), ['probe:台湾-HY2'])
  })

  it('keeps checking for half an hour after the last mail connection, then stops', async () => {
    mailInUse()
    mailGroupOn('台湾-HY2')
    mail.current().startSparkleMailCurrentNodeProbeLoop()
    await check()
    world.connections = undefined

    for (let round = 0; round < 5; round++) {
      await check()
    }
    assert.equal(callsStarting('probe:').length, 6)

    await check()
    assert.equal(callsStarting('probe:').length, 6, 'thirty quiet minutes in, it stands down')
  })

  it('has nothing to probe when the mail group has no usable current node', async () => {
    for (const [now, all] of [
      [undefined, []],
      ['   ', ['   ']],
      ['ghost', ['台湾-HY2']]
    ] as const) {
      world.calls = []
      mailInUse()
      mailGroupOn(now, [...all])
      mail.current().startSparkleMailCurrentNodeProbeLoop()

      await check()

      assert.deepEqual(callsStarting('probe:'), [], String(now))
    }
  })

  it('has nothing to probe when the current node is not in the profile', async () => {
    mailInUse()
    mailGroupOn('ghost', ['ghost'])
    mail.current().startSparkleMailCurrentNodeProbeLoop()

    await check()

    assert.deepEqual(callsStarting('probe:'), [])
    assert.deepEqual(world.logs, [])
  })

  it('has nothing to probe when the current node is not a member of the mail group', async () => {
    mailInUse()
    mailGroupOn('台湾-HY2', ['台湾-SS'])
    mail.current().startSparkleMailCurrentNodeProbeLoop()

    await check()

    assert.deepEqual(callsStarting('probe:'), [])
    assert.deepEqual(world.logs, [])
  })

  it('probes the node under its trimmed name', async () => {
    mailInUse()
    mailGroupOn(' 台湾-HY2 ', ['台湾-HY2'])
    mail.current().startSparkleMailCurrentNodeProbeLoop()

    await check()

    assert.deepEqual(callsStarting('probe:'), ['probe:台湾-HY2'])
  })

  it('never runs two checks at once', async () => {
    mailInUse()
    mailGroupOn('台湾-HY2')
    mail.current().startSparkleMailCurrentNodeProbeLoop()
    let release: () => void = () => undefined
    world.onPortProbe = () =>
      new Promise<void>((resolve) => {
        release = resolve
      })

    await check()
    await check()
    assert.deepEqual(callsStarting('probe:'), ['probe:台湾-HY2'])

    world.onPortProbe = undefined
    release()
    await settle()
    await check()

    assert.equal(callsStarting('probe:').length, 2)
  })

  it('waits its turn behind other mail probing', async () => {
    mailInUse()
    mailGroupOn('台湾-HY2')
    mail.current().startSparkleMailCurrentNodeProbeLoop()
    let release: () => void = () => undefined
    const running = mail.probe().runSparkleMailProbeExclusive(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )

    await check()
    assert.deepEqual(callsStarting('probe:'), [])

    release()
    await running
    await settle()

    assert.deepEqual(callsStarting('probe:'), ['probe:台湾-HY2'])
  })
})

describe('sparkleMailCurrentNodeProbe verdicts', () => {
  const mail = useMailRig()

  function armed(): void {
    mailInUse()
    mailGroupOn('台湾-HY2', ['台湾-HY2', '台湾-SS'])
    mail.current().startSparkleMailCurrentNodeProbeLoop()
  }

  it('publishes the first verdict it takes for the node', async () => {
    armed()

    await check()

    assert.deepEqual(readCache()[cacheKey(HY2_TW)], {
      alive: true,
      rttMs: 50,
      checkedAt: Date.now()
    })
    assert.deepEqual(readProviderMembers(), ['台湾-HY2'])
    assert.deepEqual(callsStarting('update:'), ['update:sparkle-mail'])
    assert.deepEqual(world.logs, [
      '[SparkleMailProbe]: current node 台湾-HY2 recovered (993/465) active_pool=1\n'
    ])
  })

  it('takes a node out of the provider when it stops answering', async () => {
    armed()
    writeCache({
      [cacheKey(HY2_TW)]: cacheRecord(true, 80),
      [cacheKey(SS_TW)]: cacheRecord(true, 90)
    })
    writeProviderMembers(['台湾-HY2', '台湾-SS'])
    world.portVerdictOf = () => ({ alive: false, rttMs: 0 })

    await check()

    assert.equal(readCache()[cacheKey(HY2_TW)].alive, false)
    assert.deepEqual(readProviderMembers(), ['台湾-SS'])
    assert.deepEqual(callsStarting('update:'), ['update:sparkle-mail'])
    assert.deepEqual(world.logs, [
      '[SparkleMailProbe]: current node 台湾-HY2 dead (993/465) active_pool=1\n'
    ])
  })

  it('welcomes a node back once it answers again', async () => {
    armed()
    writeCache({
      [cacheKey(HY2_TW)]: cacheRecord(false),
      [cacheKey(SS_TW)]: cacheRecord(true, 90)
    })
    writeProviderMembers(['台湾-SS'])

    await check()

    assert.deepEqual(readProviderMembers(), ['台湾-HY2', '台湾-SS'])
    assert.deepEqual(world.logs, [
      '[SparkleMailProbe]: current node 台湾-HY2 recovered (993/465) active_pool=2\n'
    ])
  })

  it('leaves the provider alone when the node answers as before', async () => {
    armed()
    writeCache({ [cacheKey(HY2_TW)]: cacheRecord(true, 80) })
    writeProviderMembers(['日本-VLESS'])

    await check()

    assert.deepEqual(readProviderMembers(), ['日本-VLESS'])
    assert.deepEqual(callsStarting('update:'), [])
    assert.deepEqual(world.logs, [])
    assert.deepEqual(readCache()[cacheKey(HY2_TW)], {
      alive: true,
      rttMs: 50,
      checkedAt: Date.now()
    })
  })

  it('still retries a reload that failed earlier when the node answers as before', async () => {
    armed()
    writeCache({ [cacheKey(HY2_TW)]: cacheRecord(true, 80) })
    await mail.probe().writeSparkleMailProviderFromCache(NODES, ['台湾'])

    await check()

    assert.deepEqual(callsStarting('update:'), ['update:sparkle-mail'])
  })

  it('orders the provider by the region priority from the app config', async () => {
    armed()
    writeCache({ [cacheKey(VLESS_JP)]: cacheRecord(true, 90) })

    await check()
    assert.deepEqual(readProviderMembers(), ['台湾-HY2', '日本-VLESS'])

    writeCache({
      [cacheKey(VLESS_JP)]: cacheRecord(true, 90),
      [cacheKey(HY2_TW)]: cacheRecord(false)
    })
    world.appConfig = { proxySwitchPriority: ['日本'] }
    await check()

    assert.deepEqual(readProviderMembers(), ['日本-VLESS', '台湾-HY2'])
  })
})

describe('sparkleMailCurrentNodeProbe failures', () => {
  const mail = useMailRig()

  function armed(): void {
    mailInUse()
    mailGroupOn('台湾-HY2')
    mail.current().startSparkleMailCurrentNodeProbeLoop()
  }

  it('ignores a controller resource that no longer exists', async () => {
    armed()
    world.groupFailure = { reason: new Error('Resource not found') }

    await check()

    assert.deepEqual(world.logs, [])
  })

  it('logs any other failure and checks again next time', async () => {
    armed()
    world.groupFailure = { reason: new Error('controller down') }
    await check()
    assertLog('[SparkleMailProbe]: current node check error=controller down')

    world.groupFailure = undefined
    await check()

    assert.deepEqual(callsStarting('probe:'), ['probe:台湾-HY2'])
  })

  it('reports a failure that is not an Error by its text', async () => {
    armed()
    world.groupFailure = { reason: 'plain failure' }

    await check()

    assertLog('current node check error=plain failure')
  })

  it('does not take a probe channel failure for a dead node', async () => {
    armed()
    world.portProbeFailure = { reason: new Error('listener down') }

    await check()

    assertLog('current node check error=listener down')
    assert.equal(readProviderMembers(), undefined)
    assert.equal(cacheFileExists(), false)
  })
})

describe('sparkleMailCurrentNodeProbe core log activity', () => {
  const mail = useMailRig()

  for (const payload of [
    SUCCESSFUL_MATCH,
    '[TCP] 127.0.0.1 --> smtp.office365.com:587 match using DIRECT',
    '[TCP] x --> googlemail.com:443',
    'using 📧 邮件专用[台湾-HY2]'
  ]) {
    it(`counts "${payload}" as mail being used`, async () => {
      mailGroupOn('台湾-HY2')
      mail.current().startSparkleMailCurrentNodeProbeLoop()
      logLine(payload)

      await check()

      assert.deepEqual(callsStarting('probe:'), ['probe:台湾-HY2'])
    })
  }

  it('ignores log lines that have nothing to do with mail', async () => {
    mailGroupOn('台湾-HY2')
    mail.current().startSparkleMailCurrentNodeProbeLoop()
    logLine('[TCP] x --> github.com:443 match using 自动选择')
    logLine(undefined)

    await check()

    assert.deepEqual(world.calls, [])
  })

  it('ignores what the hidden probe channel itself logs', async () => {
    mailGroupOn('台湾-HY2')
    mail.current().startSparkleMailCurrentNodeProbeLoop()
    logLine(`${SUCCESSFUL_MATCH} __sparkle_mail_probe__ dial error`)

    await advance(EARLY_CHECK_DELAY_MS)
    await check()

    assert.deepEqual(world.calls, [])
  })

  it('brings a check forward half a minute after a failed dial', async () => {
    mailGroupOn('台湾-HY2')
    mail.current().startSparkleMailCurrentNodeProbeLoop()
    logLine(FAILED_DIAL)

    await advance(EARLY_CHECK_DELAY_MS - 1)
    assert.deepEqual(callsStarting('probe:'), [])

    await advance(1)
    assert.deepEqual(callsStarting('probe:'), ['probe:台湾-HY2'])
  })

  it('brings a check forward after any error line, even one that is no dial', async () => {
    mailGroupOn('台湾-HY2')
    mail.current().startSparkleMailCurrentNodeProbeLoop()
    logLine('imap.gmail.com: error EOF')

    await advance(EARLY_CHECK_DELAY_MS)

    assert.deepEqual(callsStarting('probe:'), ['probe:台湾-HY2'])
  })

  it('leaves a successful connection to the regular five-minute check', async () => {
    mailGroupOn('台湾-HY2')
    mail.current().startSparkleMailCurrentNodeProbeLoop()
    logLine(SUCCESSFUL_MATCH)

    await advance(EARLY_CHECK_DELAY_MS)
    assert.deepEqual(callsStarting('probe:'), [])

    await advance(CHECK_INTERVAL_MS - EARLY_CHECK_DELAY_MS)
    assert.deepEqual(callsStarting('probe:'), ['probe:台湾-HY2'])
  })

  it('schedules one early check at a time, and a new one once it has fired', async () => {
    mailGroupOn('台湾-HY2')
    mail.current().startSparkleMailCurrentNodeProbeLoop()
    const timers = spyOnTimer('setTimeout')
    try {
      logLine(FAILED_DIAL)
      logLine(FAILED_DIAL)
      assert.deepEqual(timers.delays, [EARLY_CHECK_DELAY_MS])
      assert.equal(timers.unrefs(), 1)

      await advance(EARLY_CHECK_DELAY_MS)
      logLine(FAILED_DIAL)

      assert.deepEqual(timers.delays, [EARLY_CHECK_DELAY_MS, EARLY_CHECK_DELAY_MS])
    } finally {
      timers.restore()
    }
  })
})
