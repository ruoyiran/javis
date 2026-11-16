import { expect, test, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
vi.mock('../../src/runtime/target-router.js', () => ({ callTarget: vi.fn() }))
vi.mock('../../src/runtime/public.js', () => ({ callJavis: vi.fn() }))
vi.mock('../../src/runtime/remote-stdio.js', () => ({ callRemoteJavis: vi.fn() }))
import { callTarget } from '../../src/runtime/target-router.js'
import { callJavis } from '../../src/runtime/public.js'
import { callRemoteJavis } from '../../src/runtime/remote-stdio.js'
import { createJavisMcpServer } from '../../src/mcp/server.js'

async function connect() {
  const server = createJavisMcpServer()
  const client = new Client({ name: 'test', version: '1' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(a)
  await client.connect(b)
  return { client, close: async () => { await client.close(); await server.close() } }
}

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
