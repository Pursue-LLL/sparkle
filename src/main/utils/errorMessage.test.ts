import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import vm from 'node:vm'
import { describeError } from './errorMessage'

describe('describeError', () => {
  it('reads the message of an Error', () => {
    assert.equal(describeError(new Error('boom')), 'boom')
  })

  it('reads the message of an Error created in another realm', () => {
    const foreign = vm.runInNewContext('new Error("from the sandbox")') as unknown

    assert.equal(foreign instanceof Error, false)
    assert.equal(describeError(foreign), 'from the sandbox')
  })

  it('reads the message of a controller rejection object', () => {
    assert.equal(
      describeError({ message: 'Selector update error: proxy not exist' }),
      'Selector update error: proxy not exist'
    )
  })

  it('stringifies everything else', () => {
    assert.equal(describeError('plain'), 'plain')
    assert.equal(describeError(42), '42')
    assert.equal(describeError(undefined), 'undefined')
    assert.equal(describeError({ code: 1 }), '[object Object]')
    assert.equal(describeError({ message: 7 }), '[object Object]')
  })

  it('never throws, even for values that cannot be converted to a string', () => {
    const unprintable = Object.create(null) as object
    const hostile = {
      toString() {
        throw new Error('no string for you')
      }
    }

    assert.equal(describeError(unprintable), '[object Object]')
    assert.equal(describeError(hostile), '[object Object]')
  })
})
