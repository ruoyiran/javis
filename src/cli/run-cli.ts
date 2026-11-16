import { randomUUID } from 'node:crypto'
import { callJavis, JavisError, type JavisMethod } from '../runtime/public.js'
import { callTarget, type JavisTarget } from '../runtime/target-router.js'
import { contextFromCwd, normalizeWorktreeContext } from '../runtime/workspace-context.js'
import { parseCall } from './parse-call.js'
import { prepareCliResult } from './screenshot-output.js'
import { queryComputerTreeText } from './tree-query.js'
import { computerUseNextSteps } from '../contract/computer-use-error-recovery.js'
import { callRemoteJavis } from '../runtime/remote-stdio.js'

type Deps = {
  call?: (method: JavisMethod, params: Record<string, unknown>, target: JavisTarget) => Promise<unknown>
  cwd?: string
  remotePermissionsStatus?: (host: string) => Promise<unknown>
  permissionCall?: (method: 'permissionsStatus' | 'permissionsOpen' | 'permissionsReset', params: Record<string, unknown>) => Promise<unknown>
  stdout?: (line: string) => void
  stderr?: (line: string) => void
  stdin?: () => Promise<string>
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function display(result: unknown): string {
  const data = object(result)
  const observationError = object(data.observationError)
  if (typeof observationError.code === 'string') {
    const action = object(data.action)
    const delivery = typeof action.delivery === 'string' ? ` (${action.delivery})` : ''
    return `Action delivered${delivery}; observation failed (${observationError.code}): ${String(observationError.message ?? '')}. Do not retry the action; inspect current state first.`
  }
  const snapshot = object(data.snapshot)
  if (typeof snapshot.treeText === 'string') {
    const session = typeof data.sessionId === 'string' ? `Session: ${data.sessionId}\n` : ''
    const screenshot = object(data.screenshot)
    const image = typeof screenshot.path === 'string' ? `\nScreenshot: ${screenshot.path}` : ''
    const verification = object(object(data.action).verification)
    const status = verification.state ? `\nVerification: ${verification.state}${verification.reason ? ` (${verification.reason})` : ''}` : ''
    return `${session}${snapshot.treeText}${image}${status}`
  }
  return JSON.stringify(result, null, 2)
}

export async function runCli(argv: string[], deps: Deps = {}): Promise<number> {
  const stdout = deps.stdout ?? console.log
  const stderr = deps.stderr ?? console.error
  const jsonRequested = argv.includes('--json')
  try {
    if (argv[0] === 'permissions') {
      const subcommand = argv[1]
      let id: string | undefined
      let host: string | undefined
      let seenJson = false
      for (let index = 2; index < argv.length; index++) {
        if (argv[index] === '--json' && !seenJson) { seenJson = true; continue }
        if (argv[index] === '--host' && subcommand === 'status' && host === undefined) {
          host = argv[++index]
          if (!host) throw new Error('--host requires an SSH alias')
          continue
        }
        if (argv[index] === '--id' && subcommand === 'open' && id === undefined) {
          id = argv[++index]
          if (id === undefined) throw new Error('--id requires a value')
          continue
        }
        throw new Error(`Unknown permissions argument: ${argv[index]}`)
      }
      if (id !== undefined && id !== 'accessibility' && id !== 'screenshots') {
        throw new Error('--id must be accessibility or screenshots')
      }
      if (subcommand === 'status') {
        const result = host
          ? await (deps.remotePermissionsStatus ?? ((name: string) => callRemoteJavis('permissionsStatus', {}, name)))(host)
          : await (deps.permissionCall ?? callJavis)('permissionsStatus', {})
        stdout(jsonRequested ? JSON.stringify({ ok: true, result }) : display(result))
        return 0
      }
      if (subcommand === 'open') {
        const result = await (deps.permissionCall ?? callJavis)('permissionsOpen', id ? { id } : {})
        stdout(jsonRequested ? JSON.stringify({ ok: true, result }) : 'Opened Javis permission setup.')
        return 0
      }
      if (subcommand === 'reset') {
        const result = await (deps.permissionCall ?? callJavis)('permissionsReset', {})
        stdout(jsonRequested ? JSON.stringify({ ok: true, result }) : display(result))
        return 0
      }
      throw new Error('Use javis permissions status, open, or reset')
    }
    const stdinText = argv.includes('--text-stdin') || argv.includes('--value-stdin')
      ? await (deps.stdin ?? readStdin)()
      : undefined
    const parsed = parseCall(argv, stdinText)
    const { worktree, ...nativeParams } = parsed.params
    const actionOrObservation = !['capabilities', 'listApps', 'listWindows'].includes(parsed.method)
    const context = typeof worktree === 'string'
      ? normalizeWorktreeContext(worktree)
      : actionOrObservation && nativeParams.sessionId === undefined
        ? contextFromCwd(deps.cwd)
        : undefined
    const target: JavisTarget = { ...(parsed.host ? { host: parsed.host } : {}), ...(context ? { context } : {}) }
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
    stdout(parsed.json ? JSON.stringify({ ok: true, result: prepared }) : display(prepared))
    return 0
  } catch (error) {
    const code = error instanceof JavisError
      ? error.code
      : typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
        ? error.code
        : 'invalid_argument'
    const message = error instanceof Error ? error.message : String(error)
    const nextSteps = computerUseNextSteps(code)
    if (jsonRequested) stdout(JSON.stringify({ ok: false, error: { code, message, nextSteps } }))
    else stderr([`javis: ${code}: ${message}`, ...nextSteps.map(step => `Next: ${step}`)].join('\n'))
    return 1
  }
}
