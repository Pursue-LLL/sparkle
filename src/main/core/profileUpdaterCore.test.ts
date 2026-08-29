import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  calculateDelayToTime,
  calculateUpdateDelay,
  computeScheduleDelayMs,
  isProfileUpdateDueNow,
  wasProfileUpdatedRecently,
} from './profileUpdaterCore'

describe('profileUpdaterCore', () => {
  it('calculateDelayToTime schedules next local occurrence', () => {
    const now = new Date('2026-08-24T09:00:00+08:00')
    const delayMs = calculateDelayToTime('07:00', now)
    assert.equal(delayMs, 22 * 60 * 60 * 1000)
  })

  it('isProfileUpdateDueNow matches daily window once per day', () => {
    const item = {
      id: 'demo',
      name: 'demo',
      type: 'remote',
      autoUpdate: true,
      updateTime: '07:00',
      updated: new Date('2026-08-23T07:05:00+08:00').getTime(),
    } as ProfileItem

    const dueNow = new Date('2026-08-24T07:02:00+08:00')
    assert.equal(isProfileUpdateDueNow(item, dueNow), true)

    const alreadyUpdated = {
      ...item,
      updated: new Date('2026-08-24T07:01:00+08:00').getTime(),
    } as ProfileItem
    assert.equal(isProfileUpdateDueNow(alreadyUpdated, dueNow), false)
  })

  it('interval profile becomes due after interval elapsed', () => {
    const nowMs = Date.parse('2026-08-24T10:00:00+08:00')
    const item = {
      id: 'demo',
      name: 'demo',
      type: 'remote',
      autoUpdate: true,
      interval: 240,
      updated: Date.parse('2026-08-24T05:00:00+08:00'),
    } as ProfileItem

    assert.equal(calculateUpdateDelay(item, nowMs), 0)
    assert.equal(isProfileUpdateDueNow(item, new Date(nowMs)), true)
  })

  it('computeScheduleDelayMs uses repeat interval when overdue', () => {
    const item = {
      id: 'demo',
      name: 'demo',
      type: 'remote',
      autoUpdate: true,
      interval: 60,
      updated: 0,
    } as ProfileItem

    assert.equal(computeScheduleDelayMs(item), 60 * 60 * 1000)
  })

  it('wasProfileUpdatedRecently respects update window', () => {
    const nowMs = Date.parse('2026-08-24T07:04:00+08:00')
    const item = {
      id: 'demo',
      name: 'demo',
      type: 'remote',
      autoUpdate: true,
      updateTime: '07:00',
      updated: Date.parse('2026-08-24T07:01:00+08:00'),
    } as ProfileItem

    assert.equal(wasProfileUpdatedRecently(item, nowMs), true)
  })
})
