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

it('distinguishes a delivered action from a failed follow-up observation', async () => {
  const lines: string[] = []
  const status = await runCli(
    ['click', '--app', 'Finder', '--session', 'session-1', '--element-index', '3'],
    {
      call: async () => ({
        sessionId: 'session-1',
        action: { path: 'accessibility', delivery: 'background', verification: { state: 'unverified', reason: 'window_changed' } },
        observationError: { code: 'window_not_found', message: 'window closed' },
        snapshot: null,
        screenshot: null
      }),
      stdout: (line) => lines.push(line),
      stderr: () => {}
    }
  )
  expect(status).toBe(0)
  expect(lines[0]).toMatch(/action delivered/i)
  expect(lines[0]).toMatch(/observation failed.*window closed/i)
  expect(lines[0]).toMatch(/do not retry/i)
})
