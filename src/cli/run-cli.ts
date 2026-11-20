import { randomUUID } from 'node:crypto'
import { callJavis, JavisError, type JavisMethod } from '../runtime/public.js'
import { callTarget, type JavisTarget } from '../runtime/target-router.js'
import { contextFromCwd, normalizeWorktreeContext } from '../runtime/workspace-context.js'
import { parseCall } from './parse-call.js'
import { prepareCliResult } from './screenshot-output.js'
import { queryComputerTreeText } from './tree-query.js'
import { computerUseNextSteps } from '../contract/computer-use-error-recovery.js'
import { callRemoteJavis } from '../runtime/remote-stdio.js'
import { computerHelp } from './help.js'
import { formatComputerResult, formatPermissionResult } from './computer-format.js'
import { splitCliArguments } from './arguments.js'
import { browserInvocationArgs, runBrowserCli } from '../browser/cli/index.js'
import type { BrowserCall } from '../browser/contract/index.js'
import { waitForComputer, type ComputerWaitRequest } from './computer-wait.js'

type Deps = {
  call?: (method: JavisMethod, params: Record<string, unknown>, target: JavisTarget) => Promise<unknown>
  browserCall?: BrowserCall
  cwd?: string
  remotePermissionsStatus?: (host: string) => Promise<unknown>
  permissionCall?: (method: 'permissionsStatus' | 'permissionsOpen' | 'permissionsReset', params: Record<string, unknown>) => Promise<unknown>
  stdout?: (line: string) => void
  stderr?: (line: string) => void
  stdin?: () => Promise<string>
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) throw new Error('stdin payload requested but stdin is a TTY')
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

export async function runCli(argv: string[], deps: Deps = {}): Promise<number> {
  const stdout = deps.stdout ?? console.log
  const stderr = deps.stderr ?? console.error
  let jsonRequested = argv.some(token => token === '--json' || token.startsWith('--json='))
  try {
    const browserArgs = browserInvocationArgs(argv)
    if (browserArgs !== null) return runBrowserCli(browserArgs, {
      call: deps.browserCall ?? ((method, params, target) => callTarget(method as Parameters<typeof callTarget>[0], params, target)),
      stdout, stderr, cwd: deps.cwd ?? process.cwd(), stdin: deps.stdin
    })
    const args = splitCliArguments(argv)
    jsonRequested = args.flags.has('json')
    const help = computerHelp(args)
    if (help !== undefined) { stdout(help); return 0 }
    const command = args.command[0] === 'computer' ? args.command.slice(1) : args.command
    if (command[0] === 'permissions') {
      if (command.length > 2) throw new Error('Use javis permissions status, open, or reset')
      const subcommand = command[1] ?? 'open'
      const allowed = new Set(['json', ...(subcommand === 'status' ? ['host'] : []), ...(subcommand === 'open' ? ['id'] : [])])
      for (const flag of args.flags.keys()) if (!allowed.has(flag)) throw new Error(`Unknown permissions argument: --${flag}`)
      const rawId = args.flags.get('id')
      const id = typeof rawId === 'string' ? rawId : undefined
      const rawHost = args.flags.get('host')
      const host = typeof rawHost === 'string' ? rawHost : undefined
      if (args.flags.has('host') && !host) throw new Error('--host requires an SSH alias')
      if (id !== undefined && id !== 'accessibility' && id !== 'screenshots') {
        throw new Error('--id must be accessibility or screenshots')
      }
      if (subcommand === 'status') {
        const result = host
          ? await (deps.remotePermissionsStatus ?? ((name: string) => callRemoteJavis('permissionsStatus', {}, name)))(host)
          : await (deps.permissionCall ?? callJavis)('permissionsStatus', {})
        stdout(jsonRequested ? JSON.stringify({ ok: true, result }) : formatPermissionResult(result))
        return 0
      }
      if (subcommand === 'open') {
        const result = await (deps.permissionCall ?? callJavis)('permissionsOpen', id ? { id } : {})
        stdout(jsonRequested ? JSON.stringify({ ok: true, result }) : formatPermissionResult(result, true))
        return 0
      }
      if (subcommand === 'reset') {
        const result = await (deps.permissionCall ?? callJavis)('permissionsReset', {})
        stdout(jsonRequested ? JSON.stringify({ ok: true, result }) : formatPermissionResult(result))
        return 0
      }
      throw new Error('Use javis permissions status, open, or reset')
    }
    const needsStdin = args.flags.has('text-stdin') || args.flags.has('value-stdin')
    // Validate the complete command before waiting for a stdin payload. The placeholder
    // is never dispatched; payload validation runs again after stdin is available.
    let parsed = parseCall(argv, needsStdin ? 'stdin payload pending' : undefined)
    if (needsStdin) parsed = parseCall(argv, await (deps.stdin ?? readStdin)())
    const { worktree, ...nativeParams } = parsed.params
    const actionOrObservation = !['capabilities', 'listApps', 'listWindows', 'launchApp'].includes(parsed.method)
    const context = typeof worktree === 'string'
      ? normalizeWorktreeContext(worktree)
      : actionOrObservation && nativeParams.sessionId === undefined
        ? contextFromCwd(deps.cwd)
        : undefined
    const target: JavisTarget = { ...(parsed.host ? { host: parsed.host } : {}), ...(context ? { context } : {}) }
    if (parsed.method === 'wait') {
      const result = await waitForComputer(nativeParams as ComputerWaitRequest, target, (method, params, destination, options) => deps.call ? deps.call(method, params, destination) : callTarget(method, params, destination, options))
      stdout(parsed.json ? JSON.stringify({ ok: true, result }) : `Condition --${object(result.wait).kind} held after ${object(result.wait).elapsedMs} ms\n${formatComputerResult(object(result.wait).kind === 'window-title' ? 'listWindows' : 'getAppState', result, parsed.params)}`)
      return 0
    }
    let result = await (deps.call ?? callTarget)(parsed.method, nativeParams, target)
    if (parsed.method === 'getAppState' && (parsed.query !== undefined || parsed.maxElements !== undefined)) {
      const value = object(result)
      const snapshot = object(value.snapshot)
      if (typeof snapshot.treeText === 'string') {
        result = {
          ...value,
          snapshot: {
            ...snapshot,
            treeText: queryComputerTreeText(snapshot.treeText, {
              query: parsed.query,
              maxElements: parsed.maxElements
            })
          }
        }
      }
    }
    const prepared = prepareCliResult(object(result), { requestId: randomUUID() })
    stdout(parsed.json ? JSON.stringify({ ok: true, result: prepared }) : formatComputerResult(parsed.method, prepared, { ...parsed.params, ...(parsed.host ? { host: parsed.host } : {}) }))
    return 0
  } catch (error) {
    const code = error instanceof JavisError
      ? error.code
      : typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
        ? error.code
        : 'invalid_argument'
    const message = error instanceof Error ? error.message : String(error)
    const nextSteps = computerUseNextSteps(code, message)
    if (jsonRequested) stdout(JSON.stringify({ ok: false, error: { code, message, nextSteps } }))
    else stderr([`javis: ${code}: ${message}`, ...nextSteps.map(step => `Next: ${step}`)].join('\n'))
    return 1
  }
}
