import { beforeEach, expect, test, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
vi.mock('../../src/runtime/target-router.js', () => ({ callTarget: vi.fn() }))
vi.mock('../../src/runtime/public.js', () => ({ callJavis: vi.fn() }))
vi.mock('../../src/runtime/remote-stdio.js', () => ({ callRemoteJavis: vi.fn() }))
import { callTarget } from '../../src/runtime/target-router.js'
import { callJavis } from '../../src/runtime/public.js'
import { callRemoteJavis } from '../../src/runtime/remote-stdio.js'
import { createJavisMcpServer } from '../../src/mcp/server.js'
import { readFileSync } from 'node:fs'

beforeEach(() => { vi.clearAllMocks() })

const observation = {
  snapshot: {
    id: 'fresh', app: { name: 'TextEdit', bundleId: 'com.apple.TextEdit', pid: 100 },
    window: { id: 10, index: 0, title: 'Untitled', width: 640, height: 480 },
    coordinateSpace: 'window', treeText: '0 AXWindow Untitled', elementCount: 1, focusedElementId: null
  },
  screenshot: null,
  screenshotStatus: { state: 'skipped', reason: 'no_screenshot_flag' }
}

const actions = [
  ['click', { elementIndex: 2 }],
  ['set_value', { elementIndex: 2, value: '' }],
  ['type_text', { text: 'hello' }],
  ['press_key', { key: 'Return' }],
  ['hotkey', { key: 'CmdOrCtrl+A' }],
  ['paste_text', { text: 'hello' }],
  ['scroll', { elementIndex: 2, direction: 'down', pages: 0.5 }],
  ['drag', { fromElementIndex: 2, toElementIndex: 3 }],
  ['perform_secondary_action', { elementIndex: 2, action: 'AXShowMenu' }]
] as const

async function connect() {
  const server = createJavisMcpServer()
  const client = new Client({ name: 'test', version: '1' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(a)
  await client.connect(b)
  return { client, close: async () => { await client.close(); await server.close() } }
}

test('advertises the same release version as the package manifest', async () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  const { client, close } = await connect()
  try { expect(client.getServerVersion()?.version).toBe(manifest.version) }
  finally { await close() }
})

test('delivers string key chords to runtime for hotkey and click', async () => {
  vi.mocked(callTarget).mockResolvedValue({ screenshot: null })
  const { client, close } = await connect()
  try {
    const hotkey = await client.callTool({ name: 'javis_hotkey', arguments: { app: 'TextEdit', key: 'CMD+A' } })
    expect(hotkey.isError).not.toBe(true)
    expect(callTarget).toHaveBeenCalledWith('hotkey', expect.objectContaining({ key: 'CMD+A' }), {})
    const click = await client.callTool({ name: 'javis_click', arguments: { app: 'TextEdit', elementIndex: 2, modifiers: 'CMD+SHIFT' } })
    expect(click.isError).not.toBe(true)
    expect(callTarget).toHaveBeenCalledWith('click', expect.objectContaining({ modifiers: 'CMD+SHIFT' }), {})
  } finally { await close() }
})

test('filters returned tree without changing cached result or sending output options to runtime', async () => {
  const raw = { snapshot: { treeText: '1 AXButton Save\n2 AXButton Cancel' }, screenshot: null }
  vi.mocked(callTarget).mockResolvedValue(raw)
  const { client, close } = await connect()
  try {
    const result = await client.callTool({ name: 'javis_get_app_state', arguments: { app: 'TextEdit', query: 'Save', maxElements: 1 } })
    const content = result.content as { type: string; text: string }[]
    const parsed = JSON.parse(content[0]!.text)
    expect(parsed.snapshot.treeText).toContain('Save')
    expect(parsed.snapshot.treeText).not.toContain('Cancel')
    expect(raw.snapshot.treeText).toBe('1 AXButton Save\n2 AXButton Cancel')
    const params = vi.mocked(callTarget).mock.calls.at(-1)![1]
    expect(params).not.toHaveProperty('query')
    expect(params).not.toHaveProperty('maxElements')
  } finally { await close() }
})

test('requests a tree diff for actions by default', async () => {
  vi.mocked(callTarget).mockResolvedValue({ snapshot: { treeText: '0 window' }, screenshot: null })
  const { client, close } = await connect()
  try {
    const result = await client.callTool({ name: 'javis_click', arguments: { app: 'TextEdit', elementIndex: 2 } })
    expect(result.isError).not.toBe(true)
    expect(callTarget).toHaveBeenCalledWith('click', expect.objectContaining({ treeDiff: true }), {})
  } finally { await close() }
})

test.each(actions)('supports fullTree for %s without sending the adapter flag to runtime', async (name, args) => {
  vi.mocked(callTarget).mockResolvedValue(observation)
  const { client, close } = await connect()
  try {
    const result = await client.callTool({ name: `javis_${name}`, arguments: { app: 'TextEdit', ...args, fullTree: true } })
    expect(result.isError).not.toBe(true)
    const params = vi.mocked(callTarget).mock.calls.at(-1)![1]
    expect(params.treeDiff).toBe(false)
    expect(params).not.toHaveProperty('fullTree')
  } finally { await close() }
})

test('supports explicit treeDiff false and preserves observation controls', async () => {
  vi.mocked(callTarget).mockResolvedValue(observation)
  const { client, close } = await connect()
  try {
    const result = await client.callTool({ name: 'javis_click', arguments: { app: 'TextEdit', x: 20, y: 30, treeDiff: false, noScreenshot: true, restoreWindow: true } })
    expect(result.isError).not.toBe(true)
    expect(callTarget).toHaveBeenCalledWith('click', expect.objectContaining({ treeDiff: false, noScreenshot: true, restoreWindow: true, x: 20, y: 30 }), {})
  } finally { await close() }
})

test('rejects contradictory fullTree and treeDiff before routing', async () => {
  const { client, close } = await connect()
  try {
    const result = await client.callTool({ name: 'javis_click', arguments: { app: 'TextEdit', elementIndex: 2, fullTree: true, treeDiff: true } })
    expect(result.isError).toBe(true)
    const details = JSON.parse((result.content as { text: string }[])[0]!.text)
    expect(details.code).toBe('invalid_argument')
    expect(details.nextSteps.length).toBeGreaterThan(0)
    expect(callTarget).not.toHaveBeenCalled()
  } finally { await close() }
})

test.each([
  ['javis_click', { app: 'TextEdit', elementIndex: 2, clickCount: 0 }],
  ['javis_click', { app: 'TextEdit', elementIndex: 2, windowId: -1 }],
  ['javis_click', { app: 'TextEdit', elementIndex: 'two' }],
  ['javis_type_text', { app: 'TextEdit', text: ['private-input-marker'] }],
  ['javis_list_windows', { app: 'TextEdit', windowId: 10 }]
] as const)('formats invalid primitive inputs to %s as sanitized Javis JSON', async (name, args) => {
  const { client, close } = await connect()
  try {
    const result = await client.callTool({ name, arguments: args })
    expect(result.isError).toBe(true)
    const text = (result.content as { text: string }[])[0]!.text
    expect(text).toMatch(/^\{/)
    expect(text).not.toContain('private-input-marker')
    const details = JSON.parse(text)
    expect(details.code).toBe('invalid_argument')
    expect(details.message).toBe('Invalid tool arguments; check the tool input schema')
    expect(details.nextSteps.length).toBeGreaterThan(0)
    expect(callTarget).not.toHaveBeenCalled()
  } finally { await close() }
})

test('formats unknown tools as Javis JSON without echoing the supplied name', async () => {
  const { client, close } = await connect()
  try {
    const result = await client.callTool({ name: 'private-input-marker', arguments: {} })
    expect(result.isError).toBe(true)
    const text = (result.content as { text: string }[])[0]!.text
    expect(text).toMatch(/^\{/)
    expect(text).not.toContain('private-input-marker')
    const details = JSON.parse(text)
    expect(details.code).toBe('invalid_argument')
    expect(details.message).toBe('Unknown Javis tool')
    expect(callTarget).not.toHaveBeenCalled()
  } finally { await close() }
})

test('permits positive click counts above three as supported by the provider contract', async () => {
  vi.mocked(callTarget).mockResolvedValue(observation)
  const { client, close } = await connect()
  try {
    const result = await client.callTool({ name: 'javis_click', arguments: { app: 'TextEdit', elementIndex: 2, clickCount: 4 } })
    expect(result.isError).not.toBe(true)
    expect(callTarget).toHaveBeenCalledWith('click', expect.objectContaining({ clickCount: 4 }), {})
  } finally { await close() }
})

test.each([
  ['click', { elementIndex: 2, x: 20, y: 30 }],
  ['click', { x: 20 }],
  ['click', { elementIndex: 2, modifiers: 'Cmd+A' }],
  ['scroll', { direction: 'down' }],
  ['scroll', { elementIndex: 2, x: 20, y: 30, direction: 'down' }],
  ['drag', { fromElementIndex: 2, toElementIndex: 3, fromX: 20 }],
  ['drag', { fromX: 20, fromY: 30, toX: 40 }],
  ['press_key', { key: 'CMD+A' }],
  ['hotkey', { key: 'Return' }],
  ['type_text', { text: '' }],
  ['paste_text', { text: '' }]
] as const)('rejects invalid %s arguments before any host request', async (name, args) => {
  vi.mocked(callTarget).mockResolvedValue(observation)
  const { client, close } = await connect()
  try {
    const result = await client.callTool({ name: `javis_${name}`, arguments: { app: 'TextEdit', host: 'devbox', ...args } })
    expect(result.isError).toBe(true)
    expect(callTarget).not.toHaveBeenCalled()
  } finally { await close() }
})

test('exposes only supported list-window selectors and accurate read-only hints', async () => {
  const { client, close } = await connect()
  try {
    const { tools } = await client.listTools()
    const windows = tools.find(tool => tool.name === 'javis_list_windows')!
    expect(Object.keys(windows.inputSchema.properties ?? {}).sort()).toEqual(['app', 'host'])
    expect(windows.annotations?.readOnlyHint).toBe(true)
    expect(tools.find(tool => tool.name === 'javis_click')?.annotations?.readOnlyHint).toBe(false)
    expect(tools.find(tool => tool.name === 'javis_get_app_state')?.annotations?.readOnlyHint).toBe(false)
    expect(tools.find(tool => tool.name === 'javis_permissions_status')?.annotations?.readOnlyHint).toBe(true)
  } finally { await close() }
})

test('rejects conflicting window selectors before an observation', async () => {
  vi.mocked(callTarget).mockClear()
  const { client, close } = await connect()
  try {
    const result = await client.callTool({ name: 'javis_get_app_state', arguments: { app: 'TextEdit', windowId: 1, windowIndex: 0 } })
    expect(result.isError).toBe(true)
    expect(callTarget).not.toHaveBeenCalled()
  } finally { await close() }
})

test('keeps remote hosts in separate MCP sessions', async () => {
  vi.mocked(callTarget).mockResolvedValue({ snapshot: { treeText: '0 window' }, screenshot: null })
  const { client, close } = await connect()
  try {
    await client.callTool({ name: 'javis_get_app_state', arguments: { app: 'Finder', host: 'devbox' } })
    await client.callTool({ name: 'javis_get_app_state', arguments: { app: 'Finder', host: 'laptop' } })
    const calls = vi.mocked(callTarget).mock.calls.slice(-2)
    expect(calls[0]![2]).toEqual({ host: 'devbox' })
    expect(calls[1]![2]).toEqual({ host: 'laptop' })
    expect(calls[0]![1].sessionId).not.toBe(calls[1]![1].sessionId)
  } finally { await close() }
})

test('uses a worktree context without also sending a session ID', async () => {
  vi.mocked(callTarget).mockResolvedValue({ snapshot: { treeText: '0 window' }, screenshot: null })
  const { client, close } = await connect()
  try {
    await client.callTool({ name: 'javis_click', arguments: { app: 'Finder', worktree: 'feature-a', elementIndex: 1 } })
    const call = vi.mocked(callTarget).mock.calls.at(-1)!
    expect(call[1]).not.toHaveProperty('sessionId')
    expect(call[2]).toEqual({ context: 'worktree:feature-a' })
  } finally { await close() }
})

test('reads permission status on an explicit remote host', async () => {
  vi.mocked(callRemoteJavis).mockResolvedValue({ platform: 'darwin', permissions: [{ id: 'accessibility', status: 'granted' }] })
  const { client, close } = await connect()
  try {
    const result = await client.callTool({ name: 'javis_permissions_status', arguments: { host: 'devbox' } })
    expect(result.isError).not.toBe(true)
    expect(callRemoteJavis).toHaveBeenCalledWith('permissionsStatus', {}, 'devbox')
  } finally { await close() }
})

test('reads local permission status through the shared daemon', async () => {
  vi.mocked(callJavis).mockResolvedValue({ platform: 'darwin', permissions: [{ id: 'screenshots', status: 'granted' }] })
  const { client, close } = await connect()
  try {
    const result = await client.callTool({ name: 'javis_permissions_status', arguments: {} })
    expect(result.isError).not.toBe(true)
    expect(callJavis).toHaveBeenCalledWith('permissionsStatus', {})
  } finally { await close() }
})
