import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  ComputerActionResult,
  ComputerLaunchAppResult,
  ComputerListAppsResult,
  ComputerListWindowsResult,
  ComputerProviderCapabilities,
  ComputerSnapshotResult
} from '../../contract/computer-use-runtime-types.js'
import {
  actionCapabilityKey,
  bridgeTool,
  cacheParamsForActionResult,
  desktopActionMetadataFromResponse,
  desktopActionWindowTarget,
  elementParam,
  isWindowChangedAction,
  isReplayableTool,
  verifyDesktopAction
} from './action.js'
import { validateComputerProviderActionParams } from '../computer-provider-action-validation.js'
import { execBridge, mapBridgeError } from './bridge.js'
import {
  screenshotRequestParams,
  optionalNumberParam,
  optionalStringParam,
  stringParam
} from './params.js'
import {
  resolveDesktopScriptProviderPath,
  type DesktopScriptPlatform
} from './paths.js'
import type {
  BridgeRequest,
  BridgeResponse,
  NativeActionMethod
} from './protocol.js'
import { DesktopScriptRuntimeHost, isRuntimeHostUnavailable } from './windows-host.js'
import { DesktopScriptSnapshotStore } from './snapshot-store.js'
import { normalizeBridgeApp, renderSnapshot } from './snapshot-rendering.js'
import { normalizeComputerActionResult } from '../computer-action-verification-normalization.js'
import { JavisError } from '../error.js'
import { launchBridgeApp } from './apps.js'
import { readSubtreeSnapshot } from './subtree-snapshot.js'
import type { JavisProvider } from '../provider.js'
import type { ProviderReadOptions } from '../computer-read-options.js'

export function shouldUseDesktopScriptProvider(): boolean {
  if (process.platform !== 'linux' && process.platform !== 'win32') return false
  try { resolveDesktopScriptProviderPath(process.platform); return true } catch { return false }
}

export function createDesktopScriptProvider(
  platform: 'linux' | 'win32',
  options: { canDeliver?: () => boolean } = {}
): JavisProvider {
  return new DesktopScriptProviderClient(platform, undefined, undefined, options.canDeliver)
}

export class DesktopScriptProviderClient implements JavisProvider {
  private readonly snapshotStore = new DesktopScriptSnapshotStore()
  readonly snapshots = this.snapshotStore.snapshots
  private providerCapabilities: ComputerProviderCapabilities | null = null
  private readonly runtimeHost: DesktopScriptRuntimeHost | null
  private readonly oneShotControllers = new Set<AbortController>()
  private readonly oneShotCalls = new Set<Promise<BridgeResponse>>()
  private stopped = false

  constructor(
    private readonly platform: DesktopScriptPlatform,
    private readonly scriptPath: string = resolveDesktopScriptProviderPath(platform),
    runtimeHost?: DesktopScriptRuntimeHost | null,
    private readonly canDeliver: () => boolean = () => true
  ) {
    this.runtimeHost = runtimeHost === undefined
      ? defaultRuntimeHost(platform, scriptPath, () => this.deliveryAllowed())
      : runtimeHost
  }

  async shutdown(): Promise<void> {
    this.stopped = true
    for (const controller of this.oneShotControllers) controller.abort()
    await this.runtimeHost?.dispose()
    await Promise.allSettled([...this.oneShotCalls])
    this.snapshotStore.clear()
    this.providerCapabilities = null
  }

  async call(method: string, params: Record<string, unknown>, options: ProviderReadOptions = {}): Promise<unknown> {
    switch (method) {
      case 'handshake':
      case 'capabilities': return this.capabilities(options)
      case 'listApps': return this.listApps(options)
      case 'launchApp': return this.launchApp(params)
      case 'listWindows': return this.listWindows(params, options)
      case 'getAppState': return this.snapshot(params, params.restoreWindow === true ? {} : options)
      case 'click':
      case 'performSecondaryAction':
      case 'scroll':
      case 'drag':
      case 'typeText':
      case 'pressKey':
      case 'hotkey':
      case 'pasteText':
      case 'setValue': return this.action(method, params)
      default: throw new JavisError('invalid_argument', `Unknown desktop provider method: ${method}`)
    }
  }

  async listApps(options: ProviderReadOptions = {}): Promise<ComputerListAppsResult> {
    const capabilities = await this.readCapabilities(options)
    if (!capabilities.supports.apps.list) {
      throw new JavisError('unsupported_capability', `${capabilities.provider} does not support apps.list`)
    }
    const response = await this.callBridge({ tool: 'list_apps' }, options)
    return {
      apps: (response.apps ?? []).map((app) => ({
        name: app.name,
        bundleId: app.bundleId ?? app.bundleIdentifier ?? null,
        pid: app.pid,
        isRunning: true,
        lastUsedAt: null,
        useCount: null
      }))
    }
  }

  async capabilities(options: ProviderReadOptions = {}): Promise<ComputerProviderCapabilities> {
    return await this.readCapabilities(options)
  }

  async launchApp(params: Record<string, unknown>): Promise<ComputerLaunchAppResult> {
    return launchBridgeApp(await this.readCapabilities(), request => this.callBridge(request), params)
  }

  async listWindows(params: Record<string, unknown>, options: ProviderReadOptions = {}): Promise<ComputerListWindowsResult> {
    const capabilities = await this.readCapabilities(options)
    if (!capabilities.supports.windows.list) {
      throw new JavisError(
        'unsupported_capability',
        `${capabilities.provider} does not support windows.list`
      )
    }
    const response = await this.callBridge({
      tool: 'list_windows',
      app: stringParam(params, 'app')
    }, options)
    return {
      app: normalizeBridgeApp(response.app),
      windows: (response.windows ?? []).map((window) => ({
        index: window.index,
        app: normalizeBridgeApp(window.app),
        id: window.id ?? null,
        title: window.title,
        x: window.x ?? null,
        y: window.y ?? null,
        width: window.width,
        height: window.height,
        isMinimized: window.isMinimized ?? null,
        isOffscreen: window.isOffscreen ?? null,
        screenIndex: window.screenIndex ?? null,
        platform: window.platform
      }))
    }
  }

  async snapshot(params: Record<string, unknown>, options: ProviderReadOptions = {}): Promise<ComputerSnapshotResult> {
    const app = stringParam(params, 'app')
    await this.ensureWindowTargetSupported(params, options)
    const rootElementIndex = optionalNumberParam(params, 'rootElementIndex')
    if (rootElementIndex !== undefined) return readSubtreeSnapshot(this.snapshotStore, request => this.callBridge(request, options), { app, rootElementIndex, params })
    const response = await this.callBridge({
      tool: 'get_app_state',
      app,
      windowId: optionalNumberParam(params, 'windowId'),
      windowIndex: optionalNumberParam(params, 'windowIndex'),
      ...screenshotRequestParams(params),
      restoreWindow: params.restoreWindow === true
    }, options)
    return this.rememberAndRender(app, response, params.noScreenshot === true, params)
  }

  async action(
    method: NativeActionMethod,
    params: Record<string, unknown>
  ): Promise<ComputerActionResult> {
    const app = await validateComputerProviderActionParams(method, params)
    await this.ensureWindowTargetSupported(params)
    await this.ensureActionSupported(method)
    if (method === 'typeText' && params.elementIndex !== undefined && (await this.readCapabilities()).supports.actions.typeTextElement !== true) throw new JavisError('unsupported_capability', 'The provider cannot type into a specific element')
    const explicitWindowId = optionalNumberParam(params, 'windowId')
    const explicitWindowIndex = optionalNumberParam(params, 'windowIndex')
    const current = this.snapshotStore.current(app, explicitWindowId, params)
    const actionWindowTarget = desktopActionWindowTarget(
      explicitWindowId,
      explicitWindowIndex,
      current
    )
    const element = elementParam(current, optionalNumberParam(params, 'elementIndex'))
    const fromElement = elementParam(current, optionalNumberParam(params, 'fromElementIndex'))
    const toElement = elementParam(current, optionalNumberParam(params, 'toElementIndex'))
    const response = await this.callBridge({
      tool: bridgeTool(method),
      app,
      element,
      fromElement,
      toElement,
      x: optionalNumberParam(params, 'x'),
      y: optionalNumberParam(params, 'y'),
      from_x: optionalNumberParam(params, 'fromX'),
      from_y: optionalNumberParam(params, 'fromY'),
      to_x: optionalNumberParam(params, 'toX'),
      to_y: optionalNumberParam(params, 'toY'),
      click_count: optionalNumberParam(params, 'clickCount'),
      mouse_button: optionalStringParam(params, 'mouseButton'),
      modifiers: optionalStringParam(params, 'modifiers'),
      action: optionalStringParam(params, 'action'),
      direction: optionalStringParam(params, 'direction'),
      pages: optionalNumberParam(params, 'pages'),
      text: optionalStringParam(params, 'text'),
      key: optionalStringParam(params, 'key'),
      value: optionalStringParam(params, 'value'),
      windowBounds: null,
      ...actionWindowTarget,
      ...screenshotRequestParams(params),
      restoreWindow: params.restoreWindow === true
    })
    const action = verifyDesktopAction(
      desktopActionMetadataFromResponse(
        response.action,
        method,
        response.snapshot?.windowId ?? current?.windowId ?? null,
        response.snapshot?.windowIndex ?? current?.windowIndex ?? null
      ),
      method,
      params,
      response.action,
      response.snapshot,
      element
    )
    if (isWindowChangedAction(action)) {
      this.snapshotStore.forgetWindowTarget(app, params, current)
    }
    if (response.observationError || !response.snapshot) {
      this.snapshotStore.clear()
      return normalizeComputerActionResult({
        action,
        observationError: response.observationError ?? {
          code: 'accessibility_error',
          message: 'desktop provider returned no post-action snapshot'
        },
        snapshot: null,
        screenshot: null
      })
    }
    return normalizeComputerActionResult({
      ...this.rememberAndRender(
        app,
        response,
        params.noScreenshot === true,
        cacheParamsForActionResult(params, action)
      ),
      action
    })
  }

  private async ensureActionSupported(method: NativeActionMethod): Promise<void> {
    const capabilities = await this.readCapabilities()
    const actionKey = actionCapabilityKey(method)
    if (!capabilities.supports.actions[actionKey]) {
      throw new JavisError(
        'unsupported_capability',
        `${capabilities.provider} does not support actions.${actionKey}`
      )
    }
  }

  private async ensureWindowTargetSupported(params: Record<string, unknown>, options: ProviderReadOptions = {}): Promise<void> {
    if (params.windowId !== undefined && params.windowIndex !== undefined) {
      throw new JavisError('invalid_argument', 'Window targeting accepts either windowId or windowIndex')
    }
    for (const key of ['windowId', 'windowIndex'] as const) {
      const value = params[key]
      if (value !== undefined && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)) {
        throw new JavisError('invalid_argument', `${key} must be a non-negative integer`)
      }
    }
    const capabilities = await this.readCapabilities(options)
    if (params.windowId !== undefined && !capabilities.supports.windows.targetById) {
      throw new JavisError('unsupported_capability', `${capabilities.provider} does not support windows.targetById`)
    }
    if (params.windowIndex !== undefined && !capabilities.supports.windows.targetByIndex) {
      throw new JavisError('unsupported_capability', `${capabilities.provider} does not support windows.targetByIndex`)
    }
  }

  private async callBridge(request: BridgeRequest, options: ProviderReadOptions = {}): Promise<BridgeResponse> {
    this.checkDelivery()
    const readOptions = isReplayableTool(request.tool) && request.restoreWindow !== true ? options : {}
    const host = this.runtimeHost
    if (host) {
      try {
        return checkedBridgeResponse(await host.request(request, readOptions), '')
      } catch (error) {
        // Fall back only for unavailable hosts; retain the host so its cooldown can restore service.
        if (!isRuntimeHostUnavailable(error)) {
          throw error
        }
        this.checkDelivery()
      }
    }
    return await this.callOneShotBridge(request, readOptions)
  }

  private callOneShotBridge(request: BridgeRequest, options: ProviderReadOptions): Promise<BridgeResponse> {
    const controller = new AbortController()
    const operation = (async () => {
      const operationDirectory = await mkdtemp(join(tmpdir(), 'javis-computer-use-'))
      const operationPath = join(operationDirectory, 'operation.json')
      try {
        await writeFile(operationPath, JSON.stringify(request), { encoding: 'utf8', mode: 0o600 })
        const { stdout, stderr } = await execBridge(this.platform, this.scriptPath, operationPath, undefined, {
          ...options,
          request,
          signal: controller.signal,
          canDeliver: () => this.deliveryAllowed()
        })
        let response: BridgeResponse
        try {
          response = JSON.parse(stdout) as BridgeResponse
        } catch (error) {
          throw new JavisError(
            'accessibility_error',
            `desktop provider returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`
          )
        }
        return checkedBridgeResponse(response, stderr)
      } finally {
        await rm(operationDirectory, { force: true, recursive: true })
      }
    })()
    this.oneShotControllers.add(controller)
    this.oneShotCalls.add(operation)
    void operation.then(
      () => this.finishOneShot(controller, operation),
      () => this.finishOneShot(controller, operation)
    )
    return operation
  }

  private finishOneShot(controller: AbortController, operation: Promise<BridgeResponse>): void {
    this.oneShotControllers.delete(controller)
    this.oneShotCalls.delete(operation)
  }

  private deliveryAllowed(): boolean {
    return !this.stopped && this.canDeliver()
  }

  private checkDelivery(): void {
    if (!this.deliveryAllowed()) {
      throw new JavisError('action_timeout', 'Caller disconnected or request deadline expired before delivery')
    }
  }

  private async readCapabilities(options: ProviderReadOptions = {}): Promise<ComputerProviderCapabilities> {
    if (this.providerCapabilities) {
      return this.providerCapabilities
    }
    const response = await this.callBridge({ tool: 'handshake' }, options)
    if (!response.capabilities) {
      throw new JavisError(
        'accessibility_error',
        'desktop provider returned no capabilities'
      )
    }
    if (response.capabilities.protocolVersion !== 1) {
      throw new JavisError('provider_incompatible', 'Expected desktop provider protocol version 1')
    }
    this.providerCapabilities = response.capabilities
    return response.capabilities
  }

  private rememberAndRender(
    app: string,
    response: BridgeResponse,
    noScreenshot: boolean,
    params: Record<string, unknown>
  ): ComputerSnapshotResult {
    if (!response.snapshot) {
      throw new JavisError('accessibility_error', 'desktop provider returned no snapshot')
    }
    this.snapshotStore.remember(app, response.snapshot, params)
    return renderSnapshot(response.snapshot, noScreenshot)
  }
}

function checkedBridgeResponse(response: BridgeResponse, stderr: string): BridgeResponse {
  if (!response.ok) {
    throw mapBridgeError(response.error ?? stderr)
  }
  return response
}

// Linux supports one-shot Python calls only; Windows also supports persistent serve mode.
function defaultRuntimeHost(
  platform: DesktopScriptPlatform,
  scriptPath: string,
  canDeliver: () => boolean
): DesktopScriptRuntimeHost | null {
  return platform === 'win32' ? new DesktopScriptRuntimeHost(scriptPath, { canDeliver }) : null
}
