import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { BrowserHostBridge } from '../../../src/browser/main/host-bridge'
import { BrowserHostCatalog } from '../../../src/browser/main/host-catalog'
import { callRuntimeRpcResponse } from '../../../src/browser/source/renderer/src/runtime/rpc/calls/runtime-rpc-call'
import { replaceRuntimeEnvironmentRevisions } from '../../../src/browser/source/renderer/src/runtime/rpc/environment-revisions/runtime-environment-revision'
import { captureRuntimeEnvironmentCall } from '../../../src/browser/source/renderer/src/runtime/web-session-tabs-sync/identity/web-runtime-session-environment'

vi.mock('../../../src/browser/source/main/browser/client-hosts/lifecycle/paired-runtime-browser-client-host-runtime', () => ({
  closePairedRuntimeBrowserClientHostEnvironment: async () => {},
  invokePairedRuntimeBrowser: () => null,
  startPairedRuntimeBrowserClientHost: async () => { throw new Error('Unused desktop composition') }
}))

type Invocation = {
  selector: string
  method: string
  params?: unknown
  expectedEnvironmentPairingRevision?: number
}
const fixtures: { directory: string; bridge: BrowserHostBridge }[] = []
afterEach(() => {
  for (const { directory, bridge } of fixtures.splice(0)) {
    bridge.close()
    rmSync(directory, { recursive: true, force: true })
  }
  replaceRuntimeEnvironmentRevisions([])
  vi.unstubAllGlobals()
})

function pairingFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'javis-pairing-delivery-'))
  writeFileSync(join(directory, 'hosts.json'), JSON.stringify([{
    id: 'host-b', alias: 'old-host', name: 'Old host', revision: 7,
    context: 'context-b', nativeContext: 'cwd:/old', contexts: [], root: '/old'
  }]))
  const deliveries: { target: unknown; method: unknown; params: unknown }[] = []
  const probes: unknown[] = []
  let beforeProbe: ((target: unknown) => Promise<void>) | undefined
  const bridge = new BrowserHostBridge(event => {
    if (event.method !== 'browser.host.request') throw new Error('Unexpected transport operation')
    const { id, target, method, params } = event.params
    if (method === 'browser.status') {
      probes.push(target)
      void Promise.resolve(beforeProbe?.(target)).then(() => bridge.reply({ id, response: {
        ok: true, result: {
          running: true, hostInstanceId: target, runtimeId: `runtime-${target}`,
          startedAt: 1, protocolVersion: 1, capabilities: []
        }
      } }))
    } else {
      if (method !== 'browser.tabCreate') throw new Error('Unexpected browser method')
      deliveries.push({ target, method, params })
      bridge.reply({ id, response: { ok: true, result: { createdOn: target } } })
    }
  })
  fixtures.push({ directory, bridge })
  const catalog = new BrowserHostCatalog(directory, bridge, () => {})
  replaceRuntimeEnvironmentRevisions(catalog.environments())
  let beforeInvoke: ((args: Invocation) => Promise<void>) | undefined
  let afterInvoke: ((args: Invocation) => Promise<void>) | undefined
  vi.stubGlobal('window', { api: { javisBrowser: {}, runtimeEnvironments: {
    invoke: async (args: Invocation) => {
      await beforeInvoke?.(args)
      const result = await catalog.call(args.selector, args.method, args.params, args.expectedEnvironmentPairingRevision)
      await afterInvoke?.(args)
      return result
    }
  } } })
  return {
    catalog, deliveries, probes,
    replaceHost: () => catalog.register({ id: 'host-b', alias: 'new-host', name: 'New host', context: 'context-b', root: '/new' }),
    beforeInvoke: (hook: typeof beforeInvoke) => { beforeInvoke = hook },
    afterInvoke: (hook: typeof afterInvoke) => { afterInvoke = hook },
    pauseNextProbe: () => {
      let entered!: () => void
      let resume!: () => void
      const started = new Promise<void>(resolve => { entered = resolve })
      const paused = new Promise<void>(resolve => { resume = resolve })
      beforeProbe = async () => { beforeProbe = undefined; entered(); await paused }
      return { started, resume }
    }
  }
}

const params = { worktree: 'id:runtime:host-b::context-b', url: 'about:blank' }
const target = { kind: 'environment', environmentId: 'host-b' } as const

for (const wrapper of ['captured', 'generic'] as const) {
  for (const replacement of ['before main delivery', 'during the main probe'] as const) {
    it(`refuses ${wrapper} browser delivery after host replacement ${replacement}`, async () => {
      const fixture = pairingFixture()
      const capturedCall = captureRuntimeEnvironmentCall('host-b')
      const probe = replacement === 'during the main probe' ? fixture.pauseNextProbe() : null
      if (!probe) fixture.beforeInvoke(async args => {
        if (args.method === 'browser.tabCreate') await fixture.replaceHost()
      })
      const request = wrapper === 'captured'
        ? capturedCall({ method: 'browser.tabCreate', params })
        : callRuntimeRpcResponse(target, 'browser.tabCreate', params, { skipCompatibilityCheck: true })
      if (probe) {
        await probe.started
        await fixture.replaceHost()
        probe.resume()
      }
      if (wrapper === 'captured') {
        await expect(request).resolves.toMatchObject({ ok: false, error: { code: 'runtime_environment_changed' } })
      } else {
        await expect(request).rejects.toMatchObject({ code: 'runtime_environment_changed' })
      }
      expect(fixture.deliveries).toEqual([])
    })
  }
}

it('captures a generic call pairing before its compatibility await can publish a replacement', async () => {
  const fixture = pairingFixture()
  fixture.afterInvoke(async args => {
    if (args.method === 'browser.status') {
      await fixture.replaceHost()
      replaceRuntimeEnvironmentRevisions(fixture.catalog.environments())
    }
  })
  await expect(callRuntimeRpcResponse(target, 'browser.tabCreate', params)).rejects.toMatchObject({ code: 'runtime_environment_changed' })
  expect(fixture.deliveries).toEqual([])
})

it('preserves an explicitly captured generic pairing after the renderer learns its replacement', async () => {
  const fixture = pairingFixture()
  await fixture.replaceHost()
  replaceRuntimeEnvironmentRevisions(fixture.catalog.environments())
  await expect(callRuntimeRpcResponse(target, 'browser.tabCreate', params, {
    expectedEnvironmentPairingRevision: 7, skipCompatibilityCheck: true
  })).rejects.toMatchObject({ code: 'runtime_environment_changed' })
  expect(fixture.deliveries).toEqual([])
})

it('refuses a pinned generic compatibility read before probing a replacement host', async () => {
  const fixture = pairingFixture()
  await fixture.replaceHost()
  replaceRuntimeEnvironmentRevisions(fixture.catalog.environments())
  fixture.probes.splice(0)
  await expect(callRuntimeRpcResponse(target, 'browser.tabCreate', params, {
    expectedEnvironmentPairingRevision: 7
  })).rejects.toMatchObject({ code: 'runtime_environment_changed' })
  expect(fixture.probes).toEqual([])
  expect(fixture.deliveries).toEqual([])
})

it('delivers stable captured and generic calls only to their original host and mapped folder', async () => {
  const fixture = pairingFixture()
  await expect(captureRuntimeEnvironmentCall('host-b')({ method: 'browser.tabCreate', params })).resolves.toMatchObject({ ok: true, result: { createdOn: 'old-host' } })
  await expect(callRuntimeRpcResponse(target, 'browser.tabCreate', params)).resolves.toMatchObject({ ok: true, result: { createdOn: 'old-host' } })
  expect(fixture.deliveries).toEqual([
    { target: 'old-host', method: 'browser.tabCreate', params: { worktree: 'id:cwd:/old', url: 'about:blank' } },
    { target: 'old-host', method: 'browser.tabCreate', params: { worktree: 'id:cwd:/old', url: 'about:blank' } }
  ])
})

it('keeps local calls independent of remote pairing revisions', async () => {
  const fixture = pairingFixture()
  await expect(callRuntimeRpcResponse({ kind: 'local' }, 'browser.tabCreate', { worktree: 'id:cwd:/local', url: 'about:blank' }, { expectedEnvironmentPairingRevision: 7 })).resolves.toMatchObject({ ok: true, result: { createdOn: 'local' } })
  expect(fixture.deliveries).toEqual([
    { target: 'local', method: 'browser.tabCreate', params: { worktree: 'id:cwd:/local', url: 'about:blank' } }
  ])
})

it('cancels a generic call waiting for compatibility before browser delivery', async () => {
  const fixture = pairingFixture()
  const probe = fixture.pauseNextProbe()
  const controller = new AbortController()
  const request = callRuntimeRpcResponse(target, 'browser.tabCreate', params, { signal: controller.signal })
  await probe.started
  controller.abort()
  await expect(request).rejects.toMatchObject({ name: 'AbortError' })
  probe.resume()
  expect(fixture.deliveries).toEqual([])
})
