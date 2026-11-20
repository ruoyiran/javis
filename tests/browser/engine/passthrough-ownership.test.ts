import { expect, test } from 'vitest'
import { assertAgentBrowserPassthroughStaysOnPage } from '../../../src/browser/source/main/browser/agent-browser/protocol/agent-browser-passthrough-arguments'

test.each([
  ['--cdp', 'http://other.test', 'snapshot'],
  ['--auto-connect', 'snapshot'],
  ['--session=other', 'click', '@e1'],
  ['tab', 'new', 'https://other.test'],
  ['close']
])('rejects passthrough that escapes the managed page: %j', (...argv) => {
  expect(() => assertAgentBrowserPassthroughStaysOnPage(argv)).toThrowError(expect.objectContaining({ code: 'invalid_argument' }))
})

test('allows an action on the current page', () => {
  expect(() => assertAgentBrowserPassthroughStaysOnPage(['click', '@e1'])).not.toThrow()
})
