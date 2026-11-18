import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'

/**
 * 重启闸门只有在「所有重启都经过它」时才成立：渲染进程里唯一允许直接 invoke('restartCore') 的地方
 * 是 utils/ipc.ts 的 restartCore()，且它必须经 coreRestartGate.run。
 * 新入口绕过 restartCore() 会重新出现并发重启、也不会触发「内核重启中」状态。
 */

const RENDERER_SRC = path.resolve(__dirname, '..')
const IPC_FILE = path.join(RENDERER_SRC, 'utils', 'ipc.ts')

function rendererSources(): string[] {
  return readdirSync(RENDERER_SRC, { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    .map((name) => path.join(RENDERER_SRC, name))
}

describe('core restart gate wiring', () => {
  it('only utils/ipc.ts invokes the restartCore channel directly', () => {
    const offenders = rendererSources().filter(
      (file) =>
        file !== IPC_FILE && /invoke\(\s*['"]restartCore['"]/.test(readFileSync(file, 'utf8'))
    )

    assert.deepEqual(offenders, [])
  })

  it('routes the restartCore channel through coreRestartGate.run', () => {
    const source = readFileSync(IPC_FILE, 'utf8')
    const body = /export async function restartCore\(\)[\s\S]*?\n\}/.exec(source)?.[0] ?? ''

    assert.match(body, /coreRestartGate\.run\(/)
    assert.match(body, /invoke\('restartCore'\)/)
  })
})
