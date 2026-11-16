import { expect, test } from 'vitest'
import { toMcpError, toMcpResult } from '../../src/mcp/result.js'

test('separates image bytes while preserving snapshot diff and screenshot metadata', () => {
  const value = { snapshot: { treeText: '+ button', treeDiff: { baseSnapshotId: 'old' } }, screenshot: { data: 'aGVsbG8=', format: 'png', width: 10 }, screenshotStatus: { state: 'captured' } }
  const result = toMcpResult(value)
  expect(result.content).toEqual([
    { type: 'text', text: JSON.stringify({ ...value, screenshot: { format: 'png', width: 10 } }) },
    { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }
  ])
  expect(value.screenshot.data).toBe('aGVsbG8=')
})

test('preserves skipped screenshot status without emitting an image', () => {
  const value = { screenshot: null, screenshotStatus: { state: 'skipped', reason: 'no_screenshot_flag' } }
  expect(toMcpResult(value)).toEqual({ content: [{ type: 'text', text: JSON.stringify(value) }] })
})

test('includes a concrete recovery step for uncertain action delivery', () => {
  const result = toMcpError({ code: 'action_timeout', message: 'timed out' })
  const details = JSON.parse((result.content[0] as { text: string }).text)
  expect(details.code).toBe('action_timeout')
  expect(details.nextSteps).toEqual([
    'Action delivery may be uncertain. Inspect the current app or destination with a fresh observation; do not automatically repeat the action.'
  ])
})
