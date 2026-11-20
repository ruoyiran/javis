import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { JavisError } from './error.js'
import { validateComputerProviderActionParams } from './computer-provider-action-validation.js'
import { validateComputerRequestParams } from './computer-request-validation.js'
import { ComputerTreeBaselines, MAX_COMPUTER_OBSERVATIONS } from './computer-snapshot-tree-diff.js'
import { normalizeComputerActionResult, rejectContradictedComputerAction } from './computer-action-verification-normalization.js'
import type { JavisProvider } from './provider.js'
import { validateComputerReadOptions, type ComputerReadOptions, type ProviderReadOptions } from './computer-read-options.js'
import type { ComputerActionResult, ComputerSnapshotResult, ComputerProviderCapabilities } from '../contract/computer-use-runtime-types.js'
export type JavisMethod = 'capabilities' | 'listApps' | 'launchApp' | 'listWindows' | 'getAppState' | 'click' | 'performSecondaryAction' | 'scroll' | 'drag' | 'typeText' | 'pressKey' | 'hotkey' | 'pasteText' | 'setValue'
type SessionTarget = { observedAt: number; app: string; windowId?: number | null; windowIndex?: number | null }
type ProvisionalObservation = { token: string; params: Record<string, unknown>; target: SessionTarget; result: ComputerSnapshotResult }
export class SessionRuntime {
  private sessions = new Map<string, SessionTarget>()
  private provisional = new Map<string, ProvisionalObservation>()
  private baselines = new ComputerTreeBaselines()
  constructor(private native: JavisProvider | ((method: string, params: Record<string, unknown>, options?: ProviderReadOptions) => Promise<unknown>)) {}
  invalidateObservation(params: Record<string, unknown>): void {
    const sessionId = typeof params.worktree === 'string' ? `worktree:${params.worktree}` : params.sessionId
    if (typeof sessionId !== 'string' || !sessionId) return
    this.sessions.delete(sessionId)
    this.provisional.delete(sessionId)
    this.baselines.forget({ ...params, session: sessionId })
  }
  async call(method: JavisMethod, params: Record<string, unknown>, options: ComputerReadOptions & ProviderReadOptions = {}): Promise<unknown> {
    if (!['capabilities','listApps','launchApp','listWindows','getAppState','click','performSecondaryAction','scroll','drag','typeText','pressKey','hotkey','pasteText','setValue'].includes(method)) throw new JavisError('invalid_argument','Unknown method')
    validateComputerRequestParams(method, params)
    validateComputerReadOptions(method, params, options)
    for (const [id, observation] of this.provisional) if (Date.now() - observation.target.observedAt > 120_000) this.provisional.delete(id)
    const action = !['capabilities','listApps','launchApp','listWindows','getAppState'].includes(method)
    let sessionId = params.sessionId
    const worktree=params.worktree
    if (worktree !== undefined) {
      if (typeof worktree !== 'string' || !worktree) throw new JavisError('invalid_argument','worktree must be a non-empty string')
      if (sessionId !== undefined) throw new JavisError('invalid_argument','sessionId and worktree are mutually exclusive')
      sessionId=`worktree:${worktree}`
    }
    if (action || method === 'getAppState') {
      if (sessionId !== undefined && (typeof sessionId !== 'string' || !sessionId)) throw new JavisError('invalid_argument','sessionId must be a non-empty string')
      if (action && typeof sessionId !== 'string') throw new JavisError('invalid_argument','Actions require sessionId from getAppState')
      const observed=action ? this.sessions.get(sessionId as string) : undefined
      if (action && (!observed || Date.now() - observed.observedAt > 120_000)) throw new JavisError('stale_snapshot','Refresh getAppState before acting')
      if (action && observed && (params.app !== observed.app ||
        (params.windowId !== undefined && params.windowId !== observed.windowId) ||
        (params.windowIndex !== undefined && params.windowIndex !== observed.windowIndex))) {
        throw new JavisError('stale_snapshot','Action target differs from the observed app or window')
      }
      sessionId ??= randomUUID()
    }
    if (action) await validateComputerProviderActionParams(method as Parameters<typeof validateComputerProviderActionParams>[0], params)
    const nativeParams: Record<string, unknown> = { ...params, ...(sessionId ? {session:sessionId} : {}) }
    delete nativeParams.sessionId
    if (options.observation?.mode === 'publish') {
      const observation = this.provisional.get(sessionId as string)
      if (!observation || observation.token !== options.observation.token || !isDeepStrictEqual(observation.params, nativeParams)) throw new JavisError('stale_snapshot', 'The provisional observation was replaced or its target changed; refresh getAppState')
      this.provisional.delete(sessionId as string)
      this.sessions.set(sessionId as string, observation.target)
      return { ...this.baselines.apply(nativeParams, observation.result), sessionId }
    }
    if (method === 'getAppState') {
      this.sessions.delete(sessionId as string)
      this.provisional.delete(sessionId as string)
      if (options.observation?.mode === 'stage') this.baselines.forget(nativeParams)
    }
    const nativeCall=typeof this.native==='function' ? this.native : this.native.call.bind(this.native)
    try {
    if (method === 'typeText' && params.elementIndex !== undefined) {
      const capabilities = await nativeCall('handshake', {}) as ComputerProviderCapabilities
      if (capabilities?.supports?.actions?.typeTextElement !== true) throw new JavisError('unsupported_capability', 'The provider cannot type into a specific element; observe and choose a supported action')
    }
    const result = await nativeCall(method === 'capabilities' ? 'handshake' : method, nativeParams, options.deadline === undefined ? undefined : { deadline: options.deadline })
    if (sessionId && (!result || typeof result !== 'object' || Array.isArray(result))) {
      throw new JavisError('provider_incompatible','Computer provider returned an invalid observation result')
    }
    if (method === 'capabilities') {
      const capabilities=result as ComputerProviderCapabilities
      return {...capabilities,observationStaging:true,supports:{...capabilities.supports,observation:{...capabilities.supports.observation,treeDiff:true}}}
    }
    if (sessionId && result && typeof result === 'object') {
      let normalized = result as ComputerSnapshotResult | ComputerActionResult
      if (method === 'getAppState' && params.rootElementIndex !== undefined && normalized.snapshot?.rootElementIndex !== params.rootElementIndex) throw new JavisError('unsupported_capability', 'The provider did not return the requested element subtree')
      if (action) {
        const actionResult=normalizeComputerActionResult(result as ComputerActionResult)
        normalized=actionResult.observationError ? actionResult : rejectContradictedComputerAction(actionResult)
      }
      if (normalized.snapshot) {
        const target = {
          observedAt:Date.now(),
          app:String(params.app),
          windowId:normalized.snapshot.window.id,
          windowIndex:normalized.snapshot.window.index ?? params.windowIndex as number | undefined
        }
        if (options.observation?.mode === 'stage') {
          this.provisional.set(sessionId as string, { token: options.observation.token, params: nativeParams, target, result: normalized as ComputerSnapshotResult })
          while (this.provisional.size > MAX_COMPUTER_OBSERVATIONS) this.provisional.delete(this.provisional.keys().next().value!)
        } else {
          this.sessions.set(sessionId as string, target)
          normalized = this.baselines.apply(nativeParams,normalized)
        }
      } else {
        this.sessions.delete(sessionId as string)
        this.provisional.delete(sessionId as string)
        this.baselines.forget(nativeParams)
      }
      for (const [id,target] of this.sessions) if (Date.now()-target.observedAt > 120_000) this.sessions.delete(id)
      return {...normalized, sessionId, ...(options.observation?.mode === 'stage' ? { provisionalToken: options.observation.token } : {})}
    }
    return result
    } catch (error) {
      if ((action || method === 'getAppState') && sessionId) {
        this.sessions.delete(sessionId as string)
        this.provisional.delete(sessionId as string)
        this.baselines.forget(nativeParams)
      }
      throw error
    }
  }
}
