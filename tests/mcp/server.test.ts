import { expect, test, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
vi.mock('../../src/runtime/public.js', () => ({ callJavis: vi.fn() }))
import { callJavis } from '../../src/runtime/public.js'
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
  vi.mocked(callJavis).mockResolvedValue({ screenshot: null })
  const { client, close } = await connect()
  try {
    const hotkey = await client.callTool({ name: 'javis_hotkey', arguments: { app: 'TextEdit', key: 'CMD+A' } })
    expect(hotkey.isError).not.toBe(true)
    expect(callJavis).toHaveBeenCalledWith('hotkey', expect.objectContaining({ key: 'CMD+A' }))
    const click = await client.callTool({ name: 'javis_click', arguments: { app: 'TextEdit', elementIndex: 2, modifiers: 'CMD+SHIFT' } })
    expect(click.isError).not.toBe(true)
    expect(callJavis).toHaveBeenCalledWith('click', expect.objectContaining({ modifiers: 'CMD+SHIFT' }))
  } finally { await close() }
})

test('filters returned tree without changing cached result or sending output options to runtime', async () => {
  const raw = { snapshot: { treeText: '1 AXButton Save\n2 AXButton Cancel' }, screenshot: null }
  vi.mocked(callJavis).mockResolvedValue(raw)
  const { client, close } = await connect()
  try {
    const result = await client.callTool({ name: 'javis_get_app_state', arguments: { app: 'TextEdit', query: 'Save', maxElements: 1 } })
    const content = result.content as { type: string; text: string }[]
    const parsed = JSON.parse(content[0]!.text)
    expect(parsed.snapshot.treeText).toContain('Save')
    expect(parsed.snapshot.treeText).not.toContain('Cancel')
    expect(raw.snapshot.treeText).toBe('1 AXButton Save\n2 AXButton Cancel')
    const params = vi.mocked(callJavis).mock.calls.at(-1)![1]
    expect(params).not.toHaveProperty('query')
    expect(params).not.toHaveProperty('maxElements')
  } finally { await close() }
})
