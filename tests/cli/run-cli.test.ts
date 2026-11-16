import { expect, it } from 'vitest'
import { runCli } from '../../src/cli/run-cli.js'
import { JavisError } from '../../src/runtime/public.js'

it('returns a session and a snapshot in the JSON command result', async () => {
  const lines: string[] = []
  const status = await runCli(
    ['get-app-state', '--app', 'com.apple.finder', '--no-screenshot', '--json'],
    {
      call: async () => ({ sessionId: 'session-1', snapshot: { treeText: '0 window Finder' }, screenshot: null }),
      stdout: (line) => lines.push(line),
      stderr: () => {}
    }
  )
  expect(status).toBe(0)
  expect(JSON.parse(lines[0])).toEqual({
    ok: true,
    result: { sessionId: 'session-1', snapshot: { treeText: '0 window Finder' }, screenshot: null }
  })
})

it('returns a structured error and a nonzero status for failed actions', async () => {
  const lines: string[] = []
  const status = await runCli(
    ['click', '--app', 'Finder', '--session', 'session-1', '--element-index', '3', '--json'],
    {
      call: async () => { throw new JavisError('element_not_found', 'refresh snapshot') },
      stdout: (line) => lines.push(line),
      stderr: () => {}
    }
  )
  expect(status).toBe(1)
  expect(JSON.parse(lines[0])).toEqual({
    ok: false,
    error: { code: 'element_not_found', message: 'refresh snapshot' }
  })
})
