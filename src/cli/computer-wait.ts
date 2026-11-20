import { JavisError } from '../runtime/error.js'
import { randomUUID } from 'node:crypto'
import { callTarget, type JavisTarget, type JavisCallOptions } from '../runtime/target-router.js'
import { validateComputerRequestParams } from '../runtime/computer-request-validation.js'
import { parseComputerTreeText } from '../contract/computer-use-tree-text.js'
import { computerTreeElementsMatching, isComputerTreeElementDisabled, queryComputerTreeText } from './tree-query.js'

export type ComputerWaitCondition = { kind: 'text' | 'enabled' | 'window-title'; value: string }
export type ComputerWaitRequest = {
  app: string; condition: ComputerWaitCondition; timeoutMs?: number;
  sessionId?: string; windowId?: number; windowIndex?: number
}
type WaitRead = (method: 'capabilities' | 'getAppState' | 'listWindows', params: Record<string, unknown>, target: JavisTarget, options: JavisCallOptions) => Promise<unknown>

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export async function waitForComputer(request: ComputerWaitRequest, target: JavisTarget = {}, call: WaitRead = callTarget): Promise<Record<string, unknown>> {
  const { app, condition, timeoutMs = 10_000, ...window } = request
  if (!condition || !['text', 'enabled', 'window-title'].includes(condition.kind) || typeof condition.value !== 'string' || !condition.value) throw new JavisError('invalid_argument', 'Choose one non-empty text, enabled, or window-title condition')
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) throw new JavisError('invalid_argument', 'timeout must be a positive integer at most 120000 ms')
  validateComputerRequestParams('getAppState', { app, ...window })
  if (condition.kind === 'window-title' && (window.windowId !== undefined || window.windowIndex !== undefined)) throw new JavisError('invalid_argument', 'window-title waits across all windows; drop window-id and window-index')
  const hostOnly = target.host ? { host: target.host } : {}
  const started = Date.now()
  if (condition.kind !== 'window-title') {
    const capabilities = record(await call('capabilities', {}, hostOnly, { timeoutMs: Math.max(timeoutMs, 2000) }))
    if (condition.kind === 'enabled' && record(record(capabilities.supports).observation).disabledState !== true) throw new JavisError('unsupported_capability', 'This provider does not report disabled controls; use a text wait or update that host')
    if (capabilities.observationStaging !== true) throw new JavisError('provider_incompatible', 'The selected host cannot isolate passive wait observations; update Javis on that host')
  }
  let lastSeen = 'No matching observation'
  const observationParams = { app, ...window, noScreenshot: true, treeDiff: false }
  for (;;) {
    try {
      const options = { timeoutMs: Math.max(timeoutMs - (Date.now() - started), 2000) }
      const token = randomUUID()
      const result = record(condition.kind === 'window-title'
        ? await call('listWindows', { app }, hostOnly, options)
        : await call('getAppState', observationParams, target, { ...options, observation: { mode: 'stage', token } }))
      if (condition.kind !== 'window-title' && result.provisionalToken !== token) throw new JavisError('provider_incompatible', 'The selected host cannot isolate passive wait observations; update Javis on that host')
      if (condition.kind !== 'window-title' && target.context === undefined && observationParams.sessionId === undefined && typeof result.sessionId === 'string') observationParams.sessionId = result.sessionId
      const wait = { ...condition, elapsedMs: Date.now() - started }
      if (condition.kind === 'window-title') {
        if (!Array.isArray(result.windows)) throw new JavisError('provider_incompatible', 'Provider returned no window list')
        const matches = result.windows.filter(value => typeof record(value).title === 'string' && String(record(value).title).toLowerCase().includes(condition.value.toLowerCase()))
        if (matches.length) return { ...result, windows: matches, wait }
        lastSeen = 'No window title matches'
      } else {
        const snapshot = record(result.snapshot)
        if (typeof snapshot.treeText !== 'string') throw new JavisError('provider_incompatible', 'Provider returned no fresh accessibility tree')
        const matches = computerTreeElementsMatching(parseComputerTreeText(snapshot.treeText).elements, condition.value)
        const disabled = Array.isArray(snapshot.disabledElementIndexes) ? new Set(snapshot.disabledElementIndexes as number[]) : undefined
        if (matches.length && (condition.kind === 'text' || matches.every(element => !isComputerTreeElementDisabled(element, disabled)))) {
          const published = record(await call('getAppState', observationParams, target, { timeoutMs: Math.max(timeoutMs - (Date.now() - started), 2000), observation: { mode: 'publish', token } }))
          const publishedSnapshot = record(published.snapshot)
          return { ...published, snapshot: { ...publishedSnapshot, treeText: queryComputerTreeText(String(publishedSnapshot.treeText), { query: condition.value }) }, wait: { ...wait, elapsedMs: Date.now() - started } }
        }
        lastSeen = matches.length ? 'Matching controls are still disabled' : 'No matching element'
      }
    } catch (error) {
      const code = record(error).code
      if (['app_not_found', 'window_not_found', 'window_stale'].includes(String(code))) lastSeen = String(code)
      else if (['action_timeout', 'runtime_timeout', 'transport_error'].includes(String(code)) && Date.now() - started >= timeoutMs) lastSeen = 'The last read did not answer before the deadline'
      else throw error
    }
    const remaining = timeoutMs - (Date.now() - started)
    if (remaining <= 0) throw new JavisError('wait_timeout', `Timed out waiting for ${condition.kind} ${JSON.stringify(condition.value)}; ${lastSeen}`)
    await new Promise(resolve => setTimeout(resolve, Math.min(250, remaining)))
  }
}
