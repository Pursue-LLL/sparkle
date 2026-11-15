import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import {
  isUpgradeQuiesceActive,
  UPGRADE_QUIESCE_MARKER_TTL_MS,
  upgradeQuiesceMarkerPath
} from './upgradeQuiesce'

const SCRIPTS = join(__dirname, '../../../scripts')
const MINUTE_MS = 60_000

describe('upgradeQuiesce', () => {
  let scratch = ''
  let marker = ''
  const NOW_MS = Date.parse('2026-11-15T12:00:00.000Z')

  /** 把标记文件的 mtime 设成「距 NOW_MS 多久之前」；负数表示在未来。 */
  const stampAgedBy = (ageMs: number): void => {
    writeFileSync(marker, '')
    const mtime = new Date(NOW_MS - ageMs)
    utimesSync(marker, mtime, mtime)
  }

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'sparkle-quiesce-'))
    marker = join(scratch, 'upgrade-in-progress')
  })

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true })
  })

  describe('isUpgradeQuiesceActive', () => {
    it('is inactive when no installer has written the marker', () => {
      assert.equal(isUpgradeQuiesceActive(marker, NOW_MS), false)
    })

    it('is active while the installer keeps refreshing the marker', () => {
      stampAgedBy(0)
      assert.equal(isUpgradeQuiesceActive(marker, NOW_MS), true)
      stampAgedBy(UPGRADE_QUIESCE_MARKER_TTL_MS - 1_000)
      assert.equal(isUpgradeQuiesceActive(marker, NOW_MS), true)
    })

    it('expires at the TTL so a crashed installer cannot disable the confirm dialog forever', () => {
      stampAgedBy(UPGRADE_QUIESCE_MARKER_TTL_MS)
      assert.equal(isUpgradeQuiesceActive(marker, NOW_MS), false)
      stampAgedBy(UPGRADE_QUIESCE_MARKER_TTL_MS + MINUTE_MS)
      assert.equal(isUpgradeQuiesceActive(marker, NOW_MS), false)
    })

    it('treats a marker stamped slightly in the future (clock skew) as fresh, like the shell side', () => {
      stampAgedBy(-5_000)
      assert.equal(isUpgradeQuiesceActive(marker, NOW_MS), true)
    })

    it('is inactive when the marker path cannot be read at all', () => {
      writeFileSync(join(scratch, 'plain-file'), '')
      assert.equal(
        isUpgradeQuiesceActive(join(scratch, 'plain-file', 'upgrade-in-progress')),
        false
      )
    })
  })

  describe('agreement with the installer and the background workers (shell)', () => {
    const shell = (file: string): string => readFileSync(join(SCRIPTS, file), 'utf8')
    const shellMinutes = (file: string, name: string): number =>
      Number(shell(file).match(new RegExp(`^${name}=(\\d+)$`, 'm'))?.[1])

    it('uses the same TTL as every shell script that honours the marker', () => {
      const minutes = UPGRADE_QUIESCE_MARKER_TTL_MS / MINUTE_MS
      assert.equal(shellMinutes('lib/install-transaction.sh', 'TXN_MARKER_TTL_MIN'), minutes)
      assert.equal(shellMinutes('sparkle-profile-scheduler.sh', 'UPGRADE_MARKER_TTL_MIN'), minutes)
      assert.equal(shellMinutes('sparkle-gui-watchdog.sh', 'UPGRADE_MARKER_TTL_MIN'), minutes)
    })

    it('points at the file the installer writes, under the state directory it derives from HOME', () => {
      const path = upgradeQuiesceMarkerPath('/Users/test')
      assert.equal(path, '/Users/test/.sparkle/upgrade-in-progress')
      assert.match(
        shell('lib/install-transaction.sh'),
        new RegExp(`^TXN_MARKER_FILE="\\$SPARKLE_STATE_DIR/${basename(path)}"$`, 'm')
      )
      assert.match(
        shell('lib/sparkle-paths.sh'),
        new RegExp(
          `^: "\\$\\{SPARKLE_STATE_DIR:=\\$\\{HOME\\}/${basename(dirname(path))}\\}"$`,
          'm'
        )
      )
    })
  })
})
