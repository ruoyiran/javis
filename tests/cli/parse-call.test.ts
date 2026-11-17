import { describe, expect, it } from 'vitest'
import { parseCall } from '../../src/cli/parse-call.js'

describe('parseCall', () => {
  it('accepts flags before and between command words and inline values', () => {
    expect(parseCall(['--json', 'computer', '--host=devbox', 'click', '--app=Finder', '--element-index=7', '--click-count=2', '--modifiers=CmdOrCtrl+Shift'])).toEqual({
      method: 'click', json: true, host: 'devbox', params: { app: 'Finder', elementIndex: 7, clickCount: 2, modifiers: 'CmdOrCtrl+Shift', treeDiff: true }
    })
  })

  it('preserves inline payloads beginning with flags and an empty value', () => {
    expect(parseCall(['computer', 'type-text', '--app=Finder', '--text=--literal=payload']).params).toMatchObject({ text: '--literal=payload' })
    expect(parseCall(['--json', 'computer', 'set-value', '--app=Finder', '--element-index=0', '--value=']).params).toMatchObject({ value: '', elementIndex: 0 })
  })

  it('rejects empty numeric flags and missing values before the command path', () => {
    expect(() => parseCall(['computer', 'click', '--app=Finder', '--x=', '--y=2'])).toThrow(/finite number/)
    expect(() => parseCall(['--host', 'computer', 'list-apps'])).toThrow(/Missing value.*host/)
  })
  it.each([
    ['capabilities', [], 'capabilities', {}],
    ['list-apps', [], 'listApps', {}],
    ['list-windows', ['--app', 'Finder'], 'listWindows', { app: 'Finder' }],
    ['get-app-state', ['--app', 'Finder'], 'getAppState', { app: 'Finder' }],
    ['click', ['--app', 'Finder', '--x', '1', '--y', '2'], 'click', { app: 'Finder', x: 1, y: 2, treeDiff: true }],
    ['perform-secondary-action', ['--app', 'Finder', '--element-index', '1', '--action', 'show-menu'], 'performSecondaryAction', { app: 'Finder', elementIndex: 1, action: 'show-menu', treeDiff: true }],
    ['scroll', ['--app', 'Finder', '--element-index', '1', '--direction', 'down'], 'scroll', { app: 'Finder', elementIndex: 1, direction: 'down', treeDiff: true }],
    ['drag', ['--app', 'Finder', '--from-element-index', '1', '--to-element-index', '2'], 'drag', { app: 'Finder', fromElementIndex: 1, toElementIndex: 2, treeDiff: true }],
    ['type-text', ['--app', 'Finder', '--text', 'sample'], 'typeText', { app: 'Finder', text: 'sample', treeDiff: true }],
    ['press-key', ['--app', 'Finder', '--key', 'Return'], 'pressKey', { app: 'Finder', key: 'Return', treeDiff: true }],
    ['hotkey', ['--app', 'Finder', '--key', 'CmdOrCtrl+A'], 'hotkey', { app: 'Finder', key: 'CmdOrCtrl+A', treeDiff: true }],
    ['paste-text', ['--app', 'Finder', '--text', 'sample'], 'pasteText', { app: 'Finder', text: 'sample', treeDiff: true }],
    ['set-value', ['--app', 'Finder', '--element-index', '1', '--value', ''], 'setValue', { app: 'Finder', elementIndex: 1, value: '', treeDiff: true }]
  ])('accepts the computer %s command with the flat-command contract', (command, flags, method, params) => {
    const args = flags as string[]
    expect(parseCall(['computer', command as string, ...args, '--json'])).toEqual({ method, params, json: true })
    expect(parseCall([command as string, ...args, '--json'])).toEqual({ method, params, json: true })
  })

  it.each([
    ['click', ['--element-index', '1', '--click-count', '0'], /positive integer/],
    ['click', ['--element-index', '1', '--mouse-button', 'back'], /mouse-button/],
    ['click', ['--element-index', '1', '--modifiers', 'Cmd+A'], /modifier keys only/],
    ['scroll', ['--element-index', '1', '--direction', 'down', '--pages', '0'], /positive number/],
    ['scroll', ['--element-index', '1', '--direction', 'diagonal'], /direction/],
    ['press-key', ['--key', 'Cmd+A'], /one key only/],
    ['hotkey', ['--key', 'A'], /modifier and one key/],
    ['hotkey', ['--key', 'Ctrl+Shift'], /modifier and one key/]
  ])('rejects invalid %s flags before dispatch', (command, flags, message) => {
    expect(() => parseCall([command as string, '--app', 'Finder', ...flags as string[]])).toThrow(message as RegExp)
  })

  it('accepts fractional positive scroll pages and the literal plus key', () => {
    expect(parseCall(['scroll', '--app', 'Finder', '--x', '-2.5', '--y', '0', '--direction', 'left', '--pages', '0.5']).params).toMatchObject({ x: -2.5, y: 0, pages: 0.5 })
    expect(parseCall(['press-key', '--app', 'Finder', '--key', '+']).params).toMatchObject({ key: '+' })
  })
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

  it('accepts a worktree context in place of an explicit session', () => {
    expect(parseCall(['click', '--app', 'Finder', '--worktree', 'feature-a', '--element-index', '1'])).toMatchObject({
      method: 'click',
      params: { app: 'Finder', worktree: 'feature-a', elementIndex: 1, treeDiff: true }
    })
  })

  it('keeps the host selector outside provider parameters', () => {
    expect(parseCall(['get-app-state', '--host', 'devbox', '--app', 'Finder'])).toMatchObject({
      method: 'getAppState',
      host: 'devbox',
      params: { app: 'Finder' }
    })
  })

  it('rejects simultaneous session and worktree contexts', () => {
    expect(() => parseCall(['click', '--app', 'Finder', '--session', 's1', '--worktree', 'feature-a', '--element-index', '1'])).toThrow(/either.*session.*worktree/i)
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
