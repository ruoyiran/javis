import type {
  BrowserIdentityModeSetResult,
  BrowserIdentityModeStatus,
  BrowserUserAgentMode
} from '../source/shared/browser-user-agent-mode.js'
import type { CommandHandler } from './dispatch.js'
import { getRequiredStringFlag } from './flags.js'
import { printResult } from './format.js'
import { RuntimeClientError } from '../../runtime/error.js'

function parseMode(flags: Map<string, string | boolean>): BrowserUserAgentMode {
  const mode = getRequiredStringFlag(flags, 'mode')
  if (mode !== 'clean' && mode !== 'native') {
    throw new RuntimeClientError('invalid_argument', '--mode must be "clean" or "native"')
  }
  return mode
}

function formatStatus(status: BrowserIdentityModeStatus): string {
  const { identity } = status
  if (identity.configuredMode === null) {
    return `Browser identity: ${identity.state}; Cleaned is applied for this launch. Explicit reset required.`
  }
  return `Browser identity: ${identity.configuredMode} (applied: ${identity.appliedMode}${identity.restartRequired ? ', restart required' : ''})`
}

export const BROWSER_IDENTITY_HANDLERS: Record<string, CommandHandler> = {
  'identity get': async (context) => {
    const result = await context.client.call<BrowserIdentityModeStatus>('browser.identity.get')
    printResult(result, context.json, formatStatus)
  },
  'identity set': async (context) => {
    const mode = parseMode(context.flags)
    // Opt-in only: without it the host refuses to overwrite corrupt or newer-version data.
    const reset = context.flags.get('reset') === true
    const result = await context.client.call<BrowserIdentityModeSetResult>('browser.identity.set', {
      mode,
      ...(reset ? { reset: true } : {})
    })
    if (!result.result.ok) {
      throw new RuntimeClientError(result.result.error.code, result.result.error.message)
    }
    printResult(result, context.json, ({ identity }) =>
      identity.restartRequired
        ? `Browser identity set to ${identity.configuredMode}; restart Javis to apply it.`
        : `Browser identity set to ${identity.configuredMode}.`
    )
  }
}
