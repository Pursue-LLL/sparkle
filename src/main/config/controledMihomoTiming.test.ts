import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, describe, it, mock } from 'node:test'
import { parseYaml } from '../utils/yaml'

/**
 * 真实的 patchControledMihomoConfig：补丁照常合并落盘，并且每次调用恰好留下一行 `[SwitchTiming]`。
 * 只替换边缘依赖（目录、配置生成、应用配置、日志落盘）。
 */

const TIMING_LINE =
  /^\[SwitchTiming\]: op=patchControledMihomoConfig threw=(\d) ms=\d+ load1=\d+\.\d{2} free_mem_mb=\d+\n$/

describe('patchControledMihomoConfig switch timing', () => {
  let dir: string
  let patchControledMihomoConfig: typeof import('./controledMihomo').patchControledMihomoConfig
  let generateProfileError: Error | null
  const logged: string[] = []

  before(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'sparkle-controled-timing-'))
    mock.module('../utils/dirs', {
      exports: { controledMihomoConfigPath: (): string => path.join(dir, 'mihomo.yaml') }
    })
    mock.module('../utils/log', {
      exports: {
        appendAppLog: async (line: string): Promise<void> => {
          logged.push(line)
        }
      }
    })
    mock.module('../core/factory', {
      exports: {
        generateProfile: async (): Promise<void> => {
          if (generateProfileError) throw generateProfileError
        }
      }
    })
    mock.module('./app', {
      exports: { getAppConfig: async () => ({ controlDns: true, controlSniff: true }) }
    })
    ;({ patchControledMihomoConfig } = await import('./controledMihomo'))
  })

  beforeEach(() => {
    logged.length = 0
    generateProfileError = null
  })

  after(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('applies the patch and logs exactly one successful timing line', async () => {
    await patchControledMihomoConfig({ tun: { enable: true } })

    const saved = parseYaml<{ tun: { enable: boolean } }>(
      readFileSync(path.join(dir, 'mihomo.yaml'), 'utf8')
    )
    assert.equal(saved.tun.enable, true)
    assert.equal(logged.length, 1)
    assert.equal(TIMING_LINE.exec(logged[0])?.[1], '0')
  })

  it('rethrows the failure and logs it as threw=1', async () => {
    generateProfileError = new Error('generate failed')

    await assert.rejects(patchControledMihomoConfig({ tun: { enable: false } }), /generate failed/)

    assert.equal(logged.length, 1)
    assert.equal(TIMING_LINE.exec(logged[0])?.[1], '1')
  })
})
