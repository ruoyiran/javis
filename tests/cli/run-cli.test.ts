import { expect, it } from 'vitest'
import { runCli } from '../../src/cli/run-cli.js'
import { JavisError } from '../../src/runtime/public.js'

it.each([
  ['help', 'computer', 'drag'],
  ['computer', 'help', 'drag'],
  ['--help', 'computer', 'drag'],
  ['computer', 'drag', '--help=true']
])('resolves a command help path from %j', async (...argv) => {
  const lines: string[] = []
  expect(await runCli(argv as string[], { stdout: line => lines.push(line), stderr: () => {} })).toBe(0)
  expect(lines[0]).toContain('javis computer drag')
  expect(lines[0]).toContain('--from-element-index')
})

it('uses JSON envelopes with inline global flags before a command', async () => {
  const lines: string[] = []
  expect(await runCli(['--json=true', 'computer', 'list-apps'], { call: async () => ({ apps: [] }), stdout: line => lines.push(line), stderr: () => {} })).toBe(0)
  expect(JSON.parse(lines[0])).toEqual({ ok: true, result: { apps: [] } })
})

it('rejects malformed stdin commands before consuming the payload', async () => {
  let read = false
  const lines: string[] = []
  expect(await runCli(['computer', 'click', '--app', 'Finder', '--text-stdin', '--json'], {
    stdin: async () => { read = true; return 'private input' }, stdout: line => lines.push(line), stderr: () => {}
  })).toBe(1)
  expect(read).toBe(false)
  expect(JSON.parse(lines[0])).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
})

it('shows computer command help without contacting a desktop provider or reading stdin', async () => {
  const lines: string[] = []
  expect(await runCli(['computer', 'click', '--help'], { stdout: line => lines.push(line), stderr: () => {} })).toBe(0)
  expect(lines[0]).toContain('javis computer click')
  expect(lines[0]).toContain('--element-index')
  expect(lines[0]).toContain('--modifiers')
  expect(lines[0]).toContain('--session')
  expect(lines[0]).toContain('--full-tree')
})

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
    error: {
      code: 'element_not_found',
      message: 'refresh snapshot',
      nextSteps: ['Run javis get-app-state --app <app> --json in the same host and context, then select an element index from the fresh tree.']
    }
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

it('routes a worktree action to the selected host while keeping host and context out of native parameters', async () => {
  const calls: { method: string; params: Record<string, unknown>; target: unknown }[] = []
  const status = await runCli(
    ['click', '--host', 'devbox', '--worktree', 'feature-a', '--app', 'Finder', '--element-index', '3', '--json'],
    {
      call: async (method, params, target) => {
        calls.push({ method, params, target })
        return { snapshot: { treeText: '0 window Finder' }, screenshot: null }
      },
      stdout: () => {}, stderr: () => {}
    }
  )
  expect(status).toBe(0)
  expect(calls).toEqual([{
    method: 'click',
    params: { app: 'Finder', elementIndex: 3, treeDiff: true },
    target: { host: 'devbox', context: 'worktree:feature-a' }
  }])
})
