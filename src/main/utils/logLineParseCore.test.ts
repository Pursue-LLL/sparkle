import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createControllerLogFromOutLine } from './logLineParseCore'

const parse = (line: string, fallback: LogLevel = 'info'): ControllerLog =>
  createControllerLogFromOutLine(line, fallback)

const localTime = (iso: string): string => new Date(iso).toLocaleString()

describe('createControllerLogFromOutLine', () => {
  describe('structured lines', () => {
    it('reads level, msg and time and trims the nanoseconds the Date parser rejects', () => {
      const log = parse(
        'time="2026-11-12T10:00:00.123456789+08:00" level=warning msg="hello \\"world\\""'
      )

      assert.deepEqual(log, {
        type: 'warning',
        payload: 'hello "world"',
        time: localTime('2026-11-12T10:00:00.123+08:00')
      })
    })

    it('accepts times with any fraction length, a Z suffix or no fraction at all', () => {
      assert.equal(
        parse('time="2026-11-12T10:00:00.5Z" msg=a').time,
        localTime('2026-11-12T10:00:00.500Z')
      )
      assert.equal(
        parse('time="2026-11-12T10:00:00.123Z" msg=a').time,
        localTime('2026-11-12T10:00:00.123Z')
      )
      assert.equal(
        parse('time="2026-11-12T10:00:00.1234567Z" msg=a').time,
        localTime('2026-11-12T10:00:00.123Z')
      )
      assert.equal(
        parse('time="2026-11-12T10:00:00-05:00" msg=a').time,
        localTime('2026-11-12T10:00:00-05:00')
      )
    })

    it('leaves the time empty when it is missing or unparsable', () => {
      assert.equal(parse('level=info msg=a').time, undefined)
      assert.equal(parse('time=not-a-time msg=a').time, undefined)
      assert.equal(parse('time="" msg=a').time, undefined)
    })

    it('maps level names and falls back to the stream type for anything else', () => {
      const typeOf = (level: string, fallback: LogLevel = 'info'): LogLevel =>
        parse(`level=${level} msg=x`, fallback).type

      assert.equal(typeOf('error'), 'error')
      assert.equal(typeOf('warn'), 'warning')
      assert.equal(typeOf('warning'), 'warning')
      assert.equal(typeOf('info', 'error'), 'info')
      assert.equal(typeOf('debug'), 'debug')
      assert.equal(typeOf('trace', 'debug'), 'debug')
      assert.equal(typeOf('fatal', 'error'), 'error')
      assert.equal(parse('msg=x', 'warning').type, 'warning')
    })

    it('trims the message and falls back to the whole line when it is blank or absent', () => {
      assert.equal(parse('msg="  padded  "').payload, 'padded')
      assert.equal(parse('level=info msg="  "').payload, 'level=info msg="  "')
      assert.equal(parse('level=error').payload, 'level=error')
      assert.equal(
        parse('time="2026-11-12T10:00:00+08:00"').payload,
        'time="2026-11-12T10:00:00+08:00"'
      )
    })

    it('keeps the last value of a repeated key and values that contain "="', () => {
      assert.equal(parse('level=warn level=error msg=x').type, 'error')
      assert.equal(parse('msg=a=b').payload, 'a=b')
      assert.equal(parse('msg="a = b c=d"').payload, 'a = b c=d')
    })

    it('only takes whole key names', () => {
      assert.equal(parse('xlevel=error msg=x', 'debug').type, 'debug')
      assert.equal(parse('level.extra=error msg=x', 'debug').type, 'debug')
      assert.equal(parse('some_key-1.2=v level=error msg=x').type, 'error')
    })
  })

  describe('quoted values', () => {
    it('decodes the escapes logfmt writers use', () => {
      assert.equal(
        parse('msg="tab\\there \\"quoted\\" back\\\\slash cr\\rend line\\nbreak"').payload,
        'tab\there "quoted" back\\slash cr\rend line\nbreak'
      )
    })

    it('decodes an escaped backslash before n, r or t as a backslash, not a control character', () => {
      assert.equal(parse('msg="C:\\\\new\\\\tmp\\\\run"').payload, 'C:\\new\\tmp\\run')
      assert.equal(parse('msg="a\\\\\\\\n"').payload, 'a\\\\n')
    })

    it('leaves unknown escapes and lone quotes as they are', () => {
      assert.equal(parse('msg="caf\\u00e9 \\x"').payload, 'caf\\u00e9 \\x')
      assert.equal(parse('msg="open').payload, '"open')
      assert.equal(parse('msg=close"').payload, 'close"')
      assert.equal(parse('msg=""').payload, 'msg=""')
    })

    it('does not decode unquoted values', () => {
      assert.equal(parse('msg=a\\nb').payload, 'a\\nb')
    })
  })

  describe('unstructured lines', () => {
    it('keeps the whole line under the fallback level', () => {
      assert.deepEqual(parse('panic: runtime error', 'error'), {
        type: 'error',
        payload: 'panic: runtime error',
        time: undefined
      })
    })

    it('keeps a single-character line', () => {
      assert.equal(parse('x').payload, 'x')
    })
  })
})
