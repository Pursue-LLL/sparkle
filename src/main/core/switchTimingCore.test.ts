import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createSwitchTimer,
  formatSwitchTimingLine,
  type SwitchTimingDeps
} from './switchTimingCore'

interface Harness {
  deps: SwitchTimingDeps
  lines: string[]
}

function harness(overrides: Partial<SwitchTimingDeps> = {}, clock: number[] = [0, 0]): Harness {
  const lines: string[] = []
  const times = [...clock]
  const deps: SwitchTimingDeps = {
    now: () => times.shift() ?? 0,
    load1: () => 96.5,
    freeMemMb: () => 410.4,
    log: async (line) => {
      lines.push(line)
    },
    ...overrides
  }
  return { deps, lines }
}

describe('formatSwitchTimingLine', () => {
  it('renders one key=value line with rounded numbers', () => {
    assert.equal(
      formatSwitchTimingLine({
        operation: 'restartCore',
        threw: false,
        elapsedMs: 1234.56,
        load1: 3.14159,
        freeMemMb: 410.4
      }),
      '[SwitchTiming]: op=restartCore threw=0 ms=1235 load1=3.14 free_mem_mb=410\n'
    )
  })

  it('marks a thrown operation with threw=1', () => {
    const line = formatSwitchTimingLine({
      operation: 'triggerSysProxy',
      threw: true,
      elapsedMs: 5,
      load1: 0,
      freeMemMb: 1
    })

    assert.match(
      line,
      /^\[SwitchTiming\]: op=triggerSysProxy threw=1 ms=5 load1=0\.00 free_mem_mb=1\n$/
    )
  })
})

describe('createSwitchTimer', () => {
  it('returns the operation result and logs the elapsed time from the injected clock', async () => {
    const { deps, lines } = harness({}, [100, 1350])
    const time = createSwitchTimer(deps)

    const result = await time('patchControledMihomoConfig', async () => 'done')

    assert.equal(result, 'done')
    assert.deepEqual(lines, [
      '[SwitchTiming]: op=patchControledMihomoConfig threw=0 ms=1250 load1=96.50 free_mem_mb=410\n'
    ])
  })

  it('rethrows the very same error and logs threw=1', async () => {
    const { deps, lines } = harness({}, [0, 40])
    const time = createSwitchTimer(deps)
    const failure = new Error('boom')

    await assert.rejects(
      time('restartCore', async () => {
        throw failure
      }),
      (error: unknown) => error === failure
    )

    assert.deepEqual(lines, [
      '[SwitchTiming]: op=restartCore threw=1 ms=40 load1=96.50 free_mem_mb=410\n'
    ])
  })

  it('logs a synchronous throw from the operation as well', async () => {
    const { deps, lines } = harness()
    const time = createSwitchTimer(deps)

    await assert.rejects(
      time('restartCore', () => {
        throw new Error('sync')
      }),
      /sync/
    )

    assert.equal(lines.length, 1)
    assert.match(lines[0], /threw=1/)
  })

  it('samples exactly once per call', async () => {
    let loadReads = 0
    const { deps, lines } = harness({
      load1: () => {
        loadReads += 1
        return 1
      }
    })
    const time = createSwitchTimer(deps)

    await time('restartCore', async () => undefined)
    await time('restartCore', async () => undefined)

    assert.equal(loadReads, 2)
    assert.equal(lines.length, 2)
  })

  it('keeps the result when writing the log rejects', async () => {
    const { deps } = harness({
      log: async () => {
        throw new Error('disk full')
      }
    })
    const time = createSwitchTimer(deps)

    assert.equal(await time('triggerSysProxy', async () => 7), 7)
  })

  it('keeps the result when writing the log throws synchronously', async () => {
    const { deps } = harness({
      log: () => {
        throw new Error('sync disk error')
      }
    })
    const time = createSwitchTimer(deps)

    assert.equal(await time('triggerSysProxy', async () => 7), 7)
  })

  it('keeps the original error when sampling throws', async () => {
    const { deps } = harness({
      load1: () => {
        throw new Error('sampling')
      }
    })
    const time = createSwitchTimer(deps)

    await assert.rejects(
      time('restartCore', async () => {
        throw new Error('original')
      }),
      /original/
    )
  })
})
