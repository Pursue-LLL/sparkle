import assert from 'node:assert/strict'
import { beforeEach, describe, it, mock } from 'node:test'
import { promisify } from 'node:util'

interface ExecCall {
  command: string
  args: readonly string[]
  options: { timeout?: number }
}

const state: { calls: ExecCall[]; stdout: string; failure: Error | undefined } = {
  calls: [],
  stdout: '',
  failure: undefined
}

/** `readDefaultInterface` 经 promisify 调用 execFile；真实 execFile 靠 custom 符号返回 { stdout, stderr }。 */
function fakeExecFile(): never {
  throw new Error('execFile must be reached through promisify')
}
Object.defineProperty(fakeExecFile, promisify.custom, {
  value: async (
    command: string,
    args: readonly string[],
    options: { timeout?: number }
  ): Promise<{ stdout: string; stderr: string }> => {
    state.calls.push({ command, args, options })
    if (state.failure) {
      throw state.failure
    }
    return { stdout: state.stdout, stderr: '' }
  }
})

let moduleMocked = false

function loadModule(): typeof import('./corporateDefaultInterface') {
  if (!moduleMocked) {
    mock.module('node:child_process', {
      exports: { ...require('node:child_process'), execFile: fakeExecFile }
    })
    moduleMocked = true
  }
  delete require.cache[require.resolve('./corporateDefaultInterface')]
  return require('./corporateDefaultInterface')
}

const ROUTE_OUTPUT = [
  '   route to: default',
  'destination: default',
  '       mask: default',
  '    gateway: 10.0.0.1',
  '  interface: en0',
  '      flags: <UP,GATEWAY,DONE,STATIC,PRCLONING,GLOBAL>',
  ''
].join('\n')

describe('readDefaultInterface', () => {
  beforeEach(() => {
    state.calls = []
    state.stdout = ''
    state.failure = undefined
  })

  it('asks the routing table for the default route within 3 seconds', async () => {
    state.stdout = ROUTE_OUTPUT

    assert.equal(await loadModule().readDefaultInterface(), 'en0')
    assert.deepEqual(state.calls, [
      { command: 'route', args: ['-n', 'get', 'default'], options: { timeout: 3000 } }
    ])
  })

  it('has no interface when the output does not name one', async () => {
    state.stdout = 'route: writing to routing socket: not in table\n'

    assert.equal(await loadModule().readDefaultInterface(), undefined)
  })

  it('has no interface when the command fails or times out', async () => {
    state.failure = new Error('Command failed: route -n get default')

    assert.equal(await loadModule().readDefaultInterface(), undefined)
  })
})
