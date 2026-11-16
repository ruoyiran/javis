import { randomUUID } from 'node:crypto'
import { callJavis, JavisError, type JavisMethod } from '../runtime/public.js'
import { parseCall } from './parse-call.js'
import { prepareCliResult } from './screenshot-output.js'
import { queryComputerTreeText } from './tree-query.js'
import { readJavisPermissionStatus, openJavisPermissions } from '../permissions.js'

type Deps = {
  call?: (method: JavisMethod, params: Record<string, unknown>) => Promise<unknown>
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
      const idAt = argv.indexOf('--id')
      const id = idAt >= 0 ? argv[idAt + 1] : undefined
      if (id !== undefined && id !== 'accessibility' && id !== 'screenshots') {
        throw new Error('--id must be accessibility or screenshots')
      }
      if (subcommand === 'status') {
        const result = await readJavisPermissionStatus()
        stdout(jsonRequested ? JSON.stringify({ ok: true, result }) : display(result))
        return 0
      }
      if (subcommand === 'open') {
        await openJavisPermissions(id)
        const result = { opened: true, permissionId: id ?? null }
        stdout(jsonRequested ? JSON.stringify({ ok: true, result }) : 'Opened Javis permission setup.')
        return 0
      }
      throw new Error('Use javis permissions status or javis permissions open')
    }
    const stdinText = argv.includes('--text-stdin') || argv.includes('--value-stdin')
      ? await (deps.stdin ?? readStdin)()
      : undefined
    const parsed = parseCall(argv, stdinText)
    let result = await (deps.call ?? callJavis)(parsed.method, parsed.params)
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
    if (jsonRequested) stdout(JSON.stringify({ ok: false, error: { code, message } }))
    else stderr(`javis: ${code}: ${message}`)
    return 1
  }
}
