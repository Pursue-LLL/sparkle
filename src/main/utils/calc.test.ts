import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { calcTraffic } from './calc'

describe('calcTraffic', () => {
  it('prints raw bytes below 1 KiB', () => {
    assert.equal(calcTraffic(0), '0 B')
    assert.equal(calcTraffic(1023), '1023 B')
  })

  it('switches to the next unit exactly at 1024', () => {
    assert.equal(calcTraffic(1024), '1.00 KB')
    assert.equal(calcTraffic(1024 ** 2), '1.00 MB')
    assert.equal(calcTraffic(1024 ** 3), '1.00 GB')
    assert.equal(calcTraffic(1024 ** 4), '1.00 TB')
    assert.equal(calcTraffic(1024 ** 5), '1.00 PB')
    assert.equal(calcTraffic(1024 ** 6), '1.00 EB')
    assert.equal(calcTraffic(1024 ** 7), '1.00 ZB')
    assert.equal(calcTraffic(1024 ** 8), '1.00 YB')
  })

  it('keeps the printed number at most five characters wide', () => {
    assert.equal(calcTraffic(1536), '1.50 KB')
    assert.equal(calcTraffic(10 * 1024), '10.00 KB')
    assert.equal(calcTraffic(100 * 1024), '100.0 KB')
    assert.equal(calcTraffic(1000 * 1024), '1000 KB')
  })

  it('has no unit above YB: larger values keep counting in YB', () => {
    assert.equal(calcTraffic(1024 ** 9), '1024 YB')
  })
})
