import { randomUUID } from 'node:crypto'
import { CLI_BOOLEAN_FLAGS, findCliCommandIndex } from './cli-argument-boundary.js'
import { JavisError } from '../../runtime/error.js'
import { parseArgs, normalizeCommandPositionals, findCommandSpec, validateCommandAndFlags, specPaths, isCommandGroup, resolveHelpPath } from './args.js'
import { BROWSER_BASIC_COMMAND_SPECS } from './browser-basic.js'
import { BROWSER_ADVANCED_COMMAND_SPECS } from './browser-advanced.js'
import { BROWSER_NAV_HANDLERS } from './browser-nav.js'
import { BROWSER_INTERACT_HANDLERS } from './browser-interact.js'
import { BROWSER_TAB_HANDLERS } from './browser-tab.js'
import { BROWSER_PROFILE_HANDLERS } from './browser-profile.js'
import { BROWSER_COOKIE_HANDLERS } from './browser-cookie.js'
import { BROWSER_CAPTURE_HANDLERS } from './browser-capture.js'
import { BROWSER_ENV_HANDLERS } from './browser-env.js'
import { BROWSER_STORAGE_HANDLERS } from './browser-storage.js'
import { BROWSER_IDENTITY_HANDLERS } from './browser-identity.js'
import { BROWSER_EXTENSION_HANDLERS } from './browser-extension.js'
import { browserErrorEnvelope, validateBrowserParams, type BrowserCall, type BrowserTarget } from '../contract/index.js'
import { browserOutput, printResult, writeBrowserOutput, type BrowserOutput } from './format.js'
import type { RuntimeClient } from './runtime-client.js'
import type { CommandSpec } from './command-spec.js'
import { getExplicitBrowserContext, getBrowserWorktreeSelector } from './selectors.js'
import { formatBrowserHelp } from './help.js'

export const browserCliHandlers = { ...BROWSER_NAV_HANDLERS, ...BROWSER_INTERACT_HANDLERS, ...BROWSER_TAB_HANDLERS, ...BROWSER_PROFILE_HANDLERS, ...BROWSER_COOKIE_HANDLERS, ...BROWSER_CAPTURE_HANDLERS, ...BROWSER_ENV_HANDLERS, ...BROWSER_STORAGE_HANDLERS, ...BROWSER_IDENTITY_HANDLERS, ...BROWSER_EXTENSION_HANDLERS }
export const browserCliCommandKeys = Object.keys(browserCliHandlers)
export const browserCliSpecs: CommandSpec[] = [...BROWSER_BASIC_COMMAND_SPECS, ...BROWSER_ADVANCED_COMMAND_SPECS].map(spec => ({
  ...spec, path: spec.path[0] === 'browser' ? spec.path.slice(1) : spec.path,
  ...(spec.aliases ? { aliases: spec.aliases.map(path => path[0] === 'browser' ? path.slice(1) : path) } : {})
}))
export const browserCliLifecycleSpecs: CommandSpec[] = [
  { path: ['open'], summary: 'Show the Javis browser workspace', usage: 'javis browser open [--host <alias>] [--context <namespace> | --session <namespace> | --worktree <selector>] [--json]', allowedFlags: [] },
  { path: ['status'], summary: 'Read Javis browser runtime status without activating its workspace', usage: 'javis browser status [--host <alias>] [--json]', allowedFlags: [] }
]
const allBrowserCliSpecs = [...browserCliSpecs, ...browserCliLifecycleSpecs]
export function browserInvocationArgs(argv: string[]): string[] | null {
  const valueFlags = argv.filter(token => token.startsWith('--')).map(token => token.slice(2).split('=', 1)[0]).filter(name => !CLI_BOOLEAN_FLAGS.has(name))
  const index = findCliCommandIndex(argv, [['browser']], valueFlags)
  return index < 0 ? null : [...argv.slice(0, index), ...argv.slice(index + 1)]
}
export type BrowserCliDependencies = { call: BrowserCall; stdout: BrowserOutput; stderr: BrowserOutput; cwd: string }
export async function runBrowserCli(argv: string[], deps: BrowserCliDependencies): Promise<number> {
  return browserOutput.run(deps.stdout, async () => {
    try {
      const parsed = normalizeCommandPositionals(allBrowserCliSpecs, parseArgs(argv, allBrowserCliSpecs.flatMap(specPaths), allBrowserCliSpecs))
      const helpPath = resolveHelpPath(parsed)
      const bareGroup = parsed.flags.size === 0 && isCommandGroup(allBrowserCliSpecs, parsed.commandPath)
      if (helpPath !== null || parsed.commandPath.length === 0 || bareGroup) {
        writeBrowserOutput(deps.stdout, formatBrowserHelp(allBrowserCliSpecs, helpPath ?? parsed.commandPath) + '\n')
        return 0
      }
      const key = parsed.commandPath.join(' ')
      const flags = parsed.flags
      if (['context', 'session', 'worktree'].filter(name => flags.has(name)).length > 1) throw new JavisError('invalid_argument', 'Choose one of --context, --session, or --worktree')
      const host = flags.get('host')
      const context = getExplicitBrowserContext(flags)
      const target: BrowserTarget = { ...(typeof host === 'string' ? { host } : {}), ...(typeof context === 'string' ? { context } : {}) }
      const client: RuntimeClient = {
        isRemote: typeof host === 'string',
        call: async <T>(method: string, params: Record<string, unknown> = {}) => {
          const value = await deps.call(method, method === 'browser.open' || method === 'browser.status' ? params : validateBrowserParams(method, params), target)
          return { id: randomUUID(), ok: true as const, result: value as T, _meta: { runtimeId: 'javis-browser' } }
        }
      }
      if (key === 'open' || key === 'status') {
        validateCommandAndFlags(browserCliLifecycleSpecs, parsed)
        printResult(await client.call(`browser.${key}`, key === 'open' ? { worktree: await getBrowserWorktreeSelector(flags, deps.cwd, client) } : {}), flags.has('json'), value => JSON.stringify(value, null, 2))
        return 0
      }
      validateCommandAndFlags(browserCliSpecs, parsed)
      const spec = findCommandSpec(browserCliSpecs, parsed.commandPath)!
      await browserCliHandlers[spec.path.join(' ')]!({ flags, client, cwd: deps.cwd, json: flags.has('json') })
      return 0
    } catch (error) {
      writeBrowserOutput(deps.stderr, JSON.stringify(browserErrorEnvelope(error)) + '\n')
      return 1
    }
  })
}
