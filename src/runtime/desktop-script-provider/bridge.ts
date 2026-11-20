import { execFile } from 'node:child_process'
import { isReplayableTool } from './action.js'
import { windowsPowerShellPath } from './windows-policy.js'
import { reportComputerDiagnostic } from './diagnostics.js'
import { JavisError } from '../error.js'
import type { DesktopScriptPlatform } from './paths.js'
import type { BridgeRequest } from './protocol.js'
import {
  FALLBACK_WINDOWS_EXECUTION_POLICY,
  PREFERRED_WINDOWS_EXECUTION_POLICY,
  isExecutionPolicyBlocked,
  windowsPowerShellRuntimeArgs
} from './windows-policy.js'

const REQUEST_TIMEOUT_MS = 30_000
const FORCE_KILL_GRACE_MS = 1_000

type BridgeExecutionOptions = {
  request?: BridgeRequest
  signal?: AbortSignal
  canDeliver?: () => boolean
  execFile?: typeof execFile
}

export async function execBridge(
  platform: DesktopScriptPlatform,
  scriptPath: string,
  operationPath: string,
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
  options: BridgeExecutionOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  if (platform !== 'win32') {
    return await mapped(runBridgeProcess('python3', [scriptPath, operationPath], requestTimeoutMs, options))
  }
  const command = windowsPowerShellPath()
  try {
    return await runBridgeProcess(
      command,
      windowsPowerShellRuntimeArgs(scriptPath, PREFERRED_WINDOWS_EXECUTION_POLICY, [operationPath]),
      requestTimeoutMs,
      options
    )
  } catch (error) {
    if (!isPolicyBlockedStart(error) || !isReadOnlyRequest(options.request)) {
      throw error instanceof BridgeProcessFailure ? error.mapped : error
    }
    reportComputerDiagnostic(
      `bridge start blocked at ${PREFERRED_WINDOWS_EXECUTION_POLICY}; retrying once with ${FALLBACK_WINDOWS_EXECUTION_POLICY}`
    )
    return await mapped(
      runBridgeProcess(
        command,
        windowsPowerShellRuntimeArgs(scriptPath, FALLBACK_WINDOWS_EXECUTION_POLICY, [operationPath]),
        requestTimeoutMs,
        options
      )
    )
  }
}

async function mapped(
  run: Promise<{ stdout: string; stderr: string }>
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await run
  } catch (error) {
    throw error instanceof BridgeProcessFailure ? error.mapped : error
  }
}

function isReadOnlyRequest(request: BridgeRequest | undefined): boolean {
  return request !== undefined && isReplayableTool(request.tool) && request.restoreWindow !== true
}

/** Empty stdout alone cannot prove an action was not delivered. */
function isPolicyBlockedStart(error: unknown): error is BridgeProcessFailure {
  return (
    error instanceof BridgeProcessFailure &&
    !error.stdout.trim() &&
    isExecutionPolicyBlocked(error.stderr)
  )
}

/** Preserve raw streams so policy classification does not depend on a mapped error message. */
class BridgeProcessFailure extends Error {
  constructor(
    readonly stdout: string,
    readonly stderr: string,
    readonly mapped: JavisError
  ) {
    super(mapped.message)
    this.name = 'BridgeProcessFailure'
  }
}

function runBridgeProcess(
  command: string,
  args: readonly string[],
  requestTimeoutMs: number,
  options: BridgeExecutionOptions
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof execFile> | null = null
    let interrupted: JavisError | null = null
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null
    let timeout: ReturnType<typeof setTimeout> | null = null
    const stop = (error: JavisError): void => {
      if (interrupted) return
      interrupted = error
      child?.kill('SIGTERM')
      forceKillTimer = setTimeout(() => {
        child?.kill('SIGKILL')
      }, FORCE_KILL_GRACE_MS)
    }
    const abort = (): void => stop(new JavisError('action_timeout', 'desktop provider operation cancelled during shutdown'))

    try {
      checkDelivery(options)
      child = (options.execFile ?? execFile)(
        command,
        [...args],
        {
          env: process.env,
          shell: false,
          maxBuffer: 20 * 1024 * 1024,
          windowsHide: true
        },
        (error, stdout, stderr) => {
          if (timeout) clearTimeout(timeout)
          if (forceKillTimer) clearTimeout(forceKillTimer)
          options.signal?.removeEventListener('abort', abort)
          if (interrupted) {
            reject(interrupted)
            return
          }
          if (error) {
            const message = stderr.trim() || stdout.trim() || error.message
            const mapped = error.killed
              ? new JavisError('action_timeout', message)
              : mapBridgeError(message)
            reject(new BridgeProcessFailure(stdout, stderr, mapped))
            return
          }
          resolve({ stdout, stderr })
        }
      )
      options.signal?.addEventListener('abort', abort, { once: true })
      if (options.signal?.aborted) abort()
      // Keep the request pending until the child closes, so the next request cannot race it.
      timeout = setTimeout(() => {
        stop(new JavisError('action_timeout', `desktop provider timed out after ${requestTimeoutMs}ms`))
      }, requestTimeoutMs)
    } catch (error) {
      if (timeout) clearTimeout(timeout)
      options.signal?.removeEventListener('abort', abort)
      reject(error instanceof JavisError ? error : mapBridgeError(error instanceof Error ? error.message : String(error)))
    }
  })
}

function checkDelivery(options: BridgeExecutionOptions): void {
  if (options.signal?.aborted || options.canDeliver?.() === false) {
    throw new JavisError('action_timeout', 'Caller disconnected or request deadline expired before delivery')
  }
}

export function mapBridgeError(message: string): JavisError {
  const text = message.trim() || 'desktop provider failed'
  const coded = /^(background_unavailable|element_not_enabled|unsupported_capability):/.exec(text)?.[1]
  if (coded) return new JavisError(coded, text)
  if (/text_input_incomplete|window_not_responding/i.test(text)) return new JavisError('action_timeout', text)
  if (/target_elevated/i.test(text)) return new JavisError('permission_denied', text)
  if (/app_launch_failed/.test(text)) return new JavisError('app_launch_failed', text)
  if (/text_input_incomplete/i.test(text)) {
    return new JavisError('action_timeout', text)
  }
  if (/appNotFound|app not found/i.test(text)) {
    return new JavisError('app_not_found', text)
  }
  if (/appBlocked|app blocked/i.test(text)) {
    return new JavisError('app_blocked', text)
  }
  if (
    /unsupported capability|hotkey.*require|paste_text requires|modified clicks require xdotool|GDK is required for non-character key synthesis/i.test(
      text
    )
  ) {
    return new JavisError('unsupported_capability', text)
  }
  if (
    /unsupported mouse button|unsupported scroll direction|outside the target window|unsupported (?:key|modifier)|windowId is not supported|must be a positive|must be a finite number|\b(?:x|y|from_x|from_y|to_x|to_y|pages|click_count|text|key|direction) is required\b/i.test(
      text
    )
  ) {
    return new JavisError('invalid_argument', text)
  }
  if (/ModuleNotFoundError: No module named 'gi'|PyGObject|python3-gi/i.test(text)) {
    const interpreter = /PyGObject unavailable in interpreter: (.+)/.exec(text)?.[1]?.trim()
    return new JavisError(
      'unsupported_capability',
      interpreter
        ? `Linux Computer Use requires python3-gi and AT-SPI packages, which the python3 it ran (${interpreter}) cannot load. Install python3-gi gir1.2-atspi-2.0 at-spi2-core for that interpreter, or put a python3 that has them (usually /usr/bin/python3) first on PATH, then retry.`
        : 'Linux Computer Use requires python3-gi and AT-SPI packages. Install python3-gi gir1.2-atspi-2.0 at-spi2-core, then retry.'
    )
  }
  if (/spawn python3 ENOENT/.test(text)) {
    return new JavisError(
      'unsupported_capability',
      "Computer use isn't available on this host: Linux Computer Use runs python3, and none is on PATH. Install python3 with python3-gi gir1.2-atspi-2.0 at-spi2-core, then retry."
    )
  }
  if (/not a valid secondary action|action.*not supported/i.test(text)) {
    return new JavisError('action_not_supported', text)
  }
  if (/value is not settable|not settable/i.test(text)) {
    return new JavisError('value_not_settable', text)
  }
  if (/stale element|fresh element index/i.test(text)) {
    return new JavisError('element_not_found', text)
  }
  if (/windowStale|window stale/i.test(text)) {
    return new JavisError('window_stale', text)
  }
  if (
    /window_not_focused|keyboard input requires.*window.*focused|target window.*focused/i.test(text)
  ) {
    return new JavisError('window_not_focused', text)
  }
  if (/screenshot_failed|screenshot.*failed|screen recording|payload cap/i.test(text)) {
    return new JavisError('screenshot_failed', text)
  }
  if (
    /window_not_found|windowNotFound|No top-level(?: AT-SPI| UI Automation)? window|has no (?:on-screen |accessibility )?window|could not match accessibility window|unknown window(?:_index| id)?/i.test(
      text
    )
  ) {
    return new JavisError('window_not_found', text)
  }
  if (/permission|desktop session|DBUS|XDG_RUNTIME_DIR|AT-SPI/i.test(text)) {
    return new JavisError('permission_denied', text)
  }
  if (
    /element_not_found|stale element|fresh element index|unknown element_index|element \d+ is stale|element indexes require|element \d+ changed since|element \d+ is not in the current cached snapshot/i.test(
      text
    )
  ) {
    return new JavisError('element_not_found', text)
  }
  return new JavisError('accessibility_error', text)
}
