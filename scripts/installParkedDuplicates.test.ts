import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { basename, join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { assertExit, assertOrder, assertRunning, EXIT } from './testing/installAssertions'
import { InstallSandbox } from './testing/installSandbox'
import { NEW_BUNDLE, serviceWorld, type WorldSpec } from './testing/installWorld'

/** 备份目录里带一个 Helper 子包，形状与 Electron 包一致：LaunchServices 登记的正是这些子包。 */
function parkBackup(applications: string, tag: string): string {
  const dir = join(applications, `Sparkle.app.bak.${tag}`)
  mkdirSync(join(dir, 'Contents', 'Frameworks', 'Sparkle Helper.app'), { recursive: true })
  return dir
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

describe('install-sparkle-local.sh duplicate per-user install (sandboxed)', () => {
  let sandbox: InstallSandbox | undefined

  afterEach(() => {
    sandbox?.dispose()
    sandbox = undefined
  })

  const create = (spec: WorldSpec): InstallSandbox => {
    sandbox = new InstallSandbox(spec)
    return sandbox
  }

  it('parks a duplicate per-user install so the service and the GUI cannot split', async () => {
    const sb = create(serviceWorld())
    const applications = join(sb.home, 'Applications')
    mkdirSync(join(applications, 'Sparkle.app', 'Contents'), { recursive: true })
    writeFileSync(join(applications, 'Sparkle.app', 'Contents', 'note'), 'stale user copy')
    const result = await sb.run()
    assertExit(result, EXIT.ok)
    assert.match(result.output, /Moved duplicate user install/)
    assert.equal(existsSync(join(applications, 'Sparkle.app')), false)
    const parked = readdirSync(applications).filter((name) => name.startsWith('Sparkle.app.bak.'))
    assert.equal(parked.length, 1, 'the copy is kept, not deleted')
    assert.equal(
      readFileSync(join(applications, parked[0], 'Contents', 'note'), 'utf8'),
      'stale user copy'
    )
  })

  it('only warns when the duplicate per-user install cannot be parked', async () => {
    const sb = create(serviceWorld())
    const userCopy = join(sb.home, 'Applications', 'Sparkle.app')
    mkdirSync(userCopy, { recursive: true })
    const older = parkBackup(join(sb.home, 'Applications'), '20260101T000000Z')
    const result = await sb.run({ SIM_FAIL_MV: 'mv_user_copy' })
    assertExit(result, EXIT.ok)
    assert.match(result.output, /WARN: could not move duplicate user install/)
    assert.equal(existsSync(userCopy), true)
    assert.equal(existsSync(older), true, 'nothing is deleted when no newer copy was parked')
    assertRunning(sb, NEW_BUNDLE.version)
  })

  it('keeps only the latest parked duplicate, unregistering older ones from LaunchServices before deleting them', async () => {
    const sb = create(serviceWorld())
    const applications = join(sb.home, 'Applications')
    const stamps = ['20260101T000000Z', '20260102T030405Z']
    const older = stamps.map((stamp) => parkBackup(applications, stamp))
    const handNamed = ['gatekeeper-blocked', '20260721T1016'].map((tag) =>
      parkBackup(applications, tag)
    )
    const linked = 'Sparkle.app.bak.20260103T000000Z'
    const elsewhere = join(sb.root, 'elsewhere')
    mkdirSync(elsewhere)
    symlinkSync(elsewhere, join(applications, linked))
    mkdirSync(join(applications, 'Sparkle.app', 'Contents'), { recursive: true })

    const result = await sb.run()

    assertExit(result, EXIT.ok)
    const names = readdirSync(applications)
    const fresh = names.filter(
      (name) =>
        /^Sparkle\.app\.bak\.\d{8}T\d{6}Z$/.test(name) &&
        name !== linked &&
        !stamps.some((stamp) => name.endsWith(stamp))
    )
    assert.equal(fresh.length, 1, 'the copy parked by this run is the one that stays')
    for (const dir of older) {
      const name = escapeRegExp(basename(dir))
      assert.equal(existsSync(dir), false, `${basename(dir)} is replaced by the newer copy`)
      assertOrder(
        sb.calls(),
        new RegExp(`^lsregister -u .*${name}/Contents/Frameworks/Sparkle Helper\\.app$`),
        new RegExp(`^rm -rf .*${name}$`),
        'the Helper bundles are unregistered before the backup is deleted'
      )
    }
    for (const dir of handNamed) {
      assert.equal(existsSync(dir), true, `${basename(dir)} was not made by the installer`)
    }
    assert.ok(names.includes(linked) && existsSync(elsewhere), 'a symlink is never followed')
    assert.equal(
      sb.callsOf('lsregister').some((line) => line.includes(fresh[0])),
      false,
      'the copy parked by this run is left alone'
    )
  })

  it('still prunes when LaunchServices never had the Helper bundles registered', async () => {
    // 真实的 lsregister -u 对没登记过的路径返回 1 并报 -10814；这不是失败，不能让备份留下来。
    const sb = create(serviceWorld())
    const applications = join(sb.home, 'Applications')
    const older = parkBackup(applications, '20260101T000000Z')
    mkdirSync(join(applications, 'Sparkle.app', 'Contents'), { recursive: true })
    const result = await sb.run({ SIM_LSREGISTER: 'unregistered' })
    assertExit(result, EXIT.ok)
    assert.equal(existsSync(older), false)
    assert.doesNotMatch(result.output, /WARN: could not unregister/)
  })

  it('keeps an older parked duplicate when the unregistration itself fails, so the next install retries', async () => {
    // 删了却没注销，登记就会指向不存在的路径（Dock 出现幽灵图标）；宁可多留一份备份。
    const sb = create(serviceWorld())
    const applications = join(sb.home, 'Applications')
    const older = parkBackup(applications, '20260101T000000Z')
    mkdirSync(join(applications, 'Sparkle.app', 'Contents'), { recursive: true })
    const result = await sb.run({ SIM_LSREGISTER: 'broken' })
    assertExit(result, EXIT.ok)
    assert.match(result.output, /WARN: could not unregister .* from LaunchServices/)
    assert.equal(existsSync(older), true)
    assert.equal(
      sb.callsOf('rm').some((line) => line.includes(basename(older))),
      false
    )
    assertRunning(sb, NEW_BUNDLE.version)
  })
})
