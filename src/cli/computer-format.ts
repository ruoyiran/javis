import type { JavisMethod } from '../runtime/public.js'

type FollowUpTarget = {
  app?: unknown
  host?: string
  sessionId?: unknown
  worktree?: unknown
  windowId?: unknown
  windowIndex?: unknown
  restoreWindow?: unknown
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function origin(window: Record<string, unknown>): string {
  return window.x == null || window.y == null ? '' : ` @ ${window.x},${window.y}`
}

function quote(value: unknown): string {
  const text = String(value)
  return /^[a-zA-Z0-9_./:@%+=,-]+$/u.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`
}

function appendValueFlag(args: string[], flag: string, value: unknown): void {
  if (String(value).startsWith('--')) args.push(`${flag}=${quote(value)}`)
  else args.push(flag, quote(value))
}

function followUp(result: Record<string, unknown>, target: FollowUpTarget): string {
  const snapshot = object(result.snapshot)
  const app = object(snapshot.app)
  const action = object(result.action)
  const verification = object(action.verification)
  const observationError = object(result.observationError)
  const window = object(snapshot.window)
  const args = ['javis', 'computer', 'get-app-state']
  appendValueFlag(args, '--app', app.bundleId ?? app.name ?? target.app ?? '<app>')
  if (target.host) appendValueFlag(args, '--host', target.host)
  if (target.worktree !== undefined) appendValueFlag(args, '--worktree', target.worktree)
  else if (result.sessionId ?? target.sessionId) appendValueFlag(args, '--session', result.sessionId ?? target.sessionId)
  // A changed or missing window cannot provide a fresh indexed target. Do not
  // send the caller back to the stale window ID after a failed observation.
  const staleWindow = verification.reason === 'window_changed' ||
    observationError.code === 'window_not_found' || observationError.code === 'window_stale'
  if (!staleWindow) {
    const windowId = target.windowId ?? action.targetWindowId ?? window.id
    const windowIndex = target.windowIndex ?? action.targetWindowIndex ?? window.index
    if (target.windowId !== undefined) args.push('--window-id', String(target.windowId))
    else if (target.windowIndex !== undefined) args.push('--window-index', String(target.windowIndex))
    else if (windowId != null) args.push('--window-id', String(windowId))
    else if (windowIndex != null) args.push('--window-index', String(windowIndex))
  }
  if (target.restoreWindow) args.push('--restore-window')
  return args.join(' ')
}

function screenshotStatus(result: Record<string, unknown>): string {
  const status = object(result.screenshotStatus)
  const screenshot = object(result.screenshot)
  if (status.state === 'captured' && result.screenshot) {
    const location = typeof screenshot.path === 'string'
      ? `saved to ${screenshot.path}`
      : typeof screenshot.data === 'string' ? `${Buffer.byteLength(screenshot.data, 'base64')} bytes` : 'image available'
    const scale = Number(screenshot.scale)
    const scaleDetail = Number.isFinite(scale) && scale > 0 && scale !== 1
      ? `, scale ${scale}; coordinate x/y = screenshot pixels / ${scale}` : ''
    const engine = object(status.metadata).engine
    const warning = screenshot.storageWarning ? ` ${screenshot.storageWarning}.` : ''
    return `Screenshot captured (${screenshot.format}, ${location}, ${screenshot.width}x${screenshot.height}${scaleDetail}${engine ? `, ${engine}` : ''})${warning}`
  }
  if (status.state === 'skipped') return 'Screenshot skipped (--no-screenshot)'
  if (status.state === 'failed') return `Screenshot failed (${status.code}): ${status.message}`
  return 'Screenshot was not captured'
}

function snapshotText(result: Record<string, unknown>): string {
  const snapshot = object(result.snapshot)
  const session = typeof result.sessionId === 'string' ? [`Session: ${result.sessionId}`] : []
  const app = object(snapshot.app)
  const window = object(snapshot.window)
  if (typeof app.name !== 'string' || typeof window.title !== 'string') {
    return [...session, String(snapshot.treeText ?? ''), screenshotStatus(result)].join('\n')
  }
  const truncation = object(snapshot.truncation)
  return [
    ...session,
    `${app.name} (pid ${app.pid}${app.bundleId ? `, ${app.bundleId}` : ''})`,
    `  Window:${window.id == null ? '' : ` id:${window.id}`}${window.index == null ? '' : ` index:${window.index}`} "${window.title}" (${window.width}x${window.height}${origin(window)})`,
    `  Visible elements: ${snapshot.elementCount}  Focused: ${snapshot.focusedElementId == null ? 'none' : `#${snapshot.focusedElementId}`}  Coordinates: ${snapshot.coordinateSpace}`,
    truncation.truncated ? `  Truncated: yes (max nodes ${truncation.maxNodes ?? 'unknown'}, max depth ${truncation.maxDepth ?? 'unknown'})` : '  Truncated: no',
    `  ${screenshotStatus(result)}`, '', String(snapshot.treeText ?? '')
  ].join('\n')
}

function actionVerification(action: Record<string, unknown>): string {
  const verification = object(action.verification)
  if (verification.state === 'verified') return `, verified ${verification.property}`
  if (typeof verification.reason === 'string') return `, unverified (${verification.reason.replaceAll('_', ' ')})`
  const reasons: Record<string, string> = { accessibility: 'accessibility action unasserted', clipboard: 'clipboard paste', synthetic: 'synthetic input' }
  return `, unverified (${reasons[String(action.path)] ?? 'verification metadata unavailable'})`
}

const actionVerbs: Record<string, string> = {
  click: 'Click', performSecondaryAction: 'Perform Secondary Action', scroll: 'Scroll', drag: 'Drag',
  typeText: 'Type Text', pressKey: 'Press Key', hotkey: 'Hotkey', pasteText: 'Paste Text', setValue: 'Set Value'
}

export function formatComputerResult(method: JavisMethod, input: unknown, target: FollowUpTarget = {}): string {
  const result = object(input)
  if (method === 'launchApp') {
    const app = object(result.app)
    return `${result.launched ? 'Started' : 'Already running'}: ${app.name} (pid ${app.pid}, ${result.delivery})`
  }
  if (method === 'capabilities') {
    const supports = object(result.supports)
    const apps = object(supports.apps)
    const windows = object(supports.windows)
    const observation = object(supports.observation)
    return [
      `${result.provider} (${result.platform}, protocol ${result.protocolVersion})`,
      `  Apps: list=${apps.list} bundleIds=${apps.bundleIds} pids=${apps.pids}`,
      `  Windows: list=${windows.list} targetById=${windows.targetById} targetByIndex=${windows.targetByIndex}`,
      `  Observation: screenshot=${observation.screenshot} elementFrames=${observation.elementFrames} annotatedScreenshot=${observation.annotatedScreenshot}`,
      `  Actions: ${Object.entries(object(supports.actions)).filter(([, enabled]) => enabled === true).map(([name]) => name).join(', ')}`,
      ...(supports.input ? [`  Input: background=${object(supports.input).background}`] : [])
    ].join('\n')
  }
  if (method === 'listApps' && Array.isArray(result.apps)) {
    return result.apps.length === 0 ? 'No apps found.' : result.apps.map(value => {
      const app = object(value)
      return `${app.name}  pid:${app.pid}${app.bundleId ? `  ${app.bundleId}` : ''}`
    }).join('\n')
  }
  if (method === 'listWindows' && Array.isArray(result.windows)) {
    return result.windows.length === 0 ? `No windows found for ${object(result.app).name}.` : result.windows.map(value => {
      const window = object(value)
      const state = [window.isMinimized ? 'minimized' : null, window.isOffscreen ? 'offscreen' : null].filter(Boolean)
      return `[${window.index}] id:${window.id ?? 'none'} "${window.title}" (${window.width}x${window.height}${origin(window)})${window.screenIndex == null ? '' : ` screen:${window.screenIndex}`}${state.length ? ` ${state.join(',')}` : ''}`
    }).join('\n')
  }
  if (method === 'getAppState') return snapshotText(result)
  const action = object(result.action)
  const observationError = object(result.observationError)
  if (typeof observationError.code === 'string') {
    const delivery = typeof action.delivery === 'string' ? ` (${action.delivery})` : ''
    return `Action delivered${delivery}; observation failed (${observationError.code}): ${String(observationError.message ?? '')}. Do not retry the action; inspect current state first with \`${followUp(result, target)}\`.`
  }
  const verified = object(action.verification).state === 'verified'
  const path = action.path ? ` via ${action.path}` : ''
  const delivery = action.delivery === 'background' || action.delivery === 'foreground' ? ` Delivery: ${action.delivery}.` : ''
  const snapshot = object(result.snapshot)
  const screenshotFailure = object(result.screenshotStatus).state === 'failed' ? ` ${screenshotStatus(result)}.` : ''
  const inspect = verified ? 'Use the --json result or rerun state before choosing the next element index.' : 'Inspect with the command above or use the --json result before assuming it worked.'
  return `${actionVerbs[method] ?? method} ${verified ? 'completed' : 'attempted'}${path}${actionVerification(action)};${delivery} ${snapshot.elementCount ?? 'unknown'} visible elements in current window.${screenshotFailure} Use \`${followUp(result, target)}\` to inspect. ${inspect}${snapshot.treeText ? `\n\n${snapshot.treeText}` : ''}`
}

export function formatPermissionResult(input: unknown, setup = false): string {
  const result = object(input)
  if (setup) {
    if (result.platform && result.platform !== 'darwin') {
      return ['Javis permission setup is only required on macOS.', ...(result.nextStep ? [`Next: ${result.nextStep}`] : [])].join('\n')
    }
    const headline = result.launchSuperseded ? 'Javis permission setup was replaced by a newer request.'
      : result.launchQueued ? 'Queued Javis permission setup; a newer request or a reset may replace it.'
        : result.launchedHelper === false ? 'Javis permissions checked.' : 'Opened Javis permission setup.'
    return [headline,
      ...(result.helperAppPath ? [`Helper app: ${result.helperAppPath}`] : []),
      ...(Array.isArray(result.permissions) ? [`Permissions: ${result.permissions.map(value => { const permission = object(value); return `${permission.id}=${permission.status}` }).join(', ') || 'unknown'}`] : []),
      ...(result.nextStep ? [`Next: ${result.nextStep}`] : [])
    ].join('\n')
  }
  if (!Array.isArray(result.permissions)) return JSON.stringify(input, null, 2)
  return [`Javis permissions (${result.platform})`, ...result.permissions.map(value => {
    const permission = object(value)
    return `  ${permission.id}: ${permission.status}`
  }), ...(result.nextStep ? [`Next: ${result.nextStep}`] : [])].join('\n')
}
