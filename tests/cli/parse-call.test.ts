import { describe, expect, it } from 'vitest'
import { parseCall } from '../../src/cli/parse-call.js'

describe('parseCall', () => {
  it('creates an observation without borrowing another agent session', () => {
    expect(parseCall(['get-app-state', '--app', 'com.apple.finder', '--json'])).toEqual({
      method: 'getAppState',
      params: { app: 'com.apple.finder' },
      json: true
    })
  })

  it('passes the observed session to an indexed click and requests a tree diff', () => {
    expect(
      parseCall([
        'click', '--app', 'com.apple.finder', '--session', 'session-1',
        '--element-index', '42', '--no-screenshot', '--json'
      ])
    ).toEqual({
      method: 'click',
      params: {
        app: 'com.apple.finder',
        sessionId: 'session-1',
        elementIndex: 42,
        noScreenshot: true,
        treeDiff: true
      },
      json: true
    })
  })

  it('accepts an empty value from stdin for clearing a field', () => {
    expect(parseCall([
      'set-value', '--app', 'com.apple.TextEdit', '--session', 'session-2',
      '--element-index', '5', '--value-stdin'
    ], '')).toMatchObject({
      method: 'setValue',
      params: { value: '', elementIndex: 5, sessionId: 'session-2' }
    })
  })

  it('rejects an action without its observation session', () => {
    expect(() => parseCall(['click', '--app', 'Finder', '--element-index', '1'])).toThrow(
      /session/
    )
  })

  it('rejects conflicting element and coordinate click targets', () => {
    expect(() => parseCall([
      'click', '--app', 'Finder', '--session', 'session-1',
      '--element-index', '1', '--x', '10', '--y', '20'
    ])).toThrow(/either.*element.*coordinates/i)
  })

  it('rejects a zero element limit instead of hiding the entire tree', () => {
    expect(() => parseCall([
      'get-app-state', '--app', 'Finder', '--max-elements', '0'
    ])).toThrow(/positive/)
  })
})
