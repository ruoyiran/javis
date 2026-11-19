import net from 'node:net'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { createBrowserChannel } from '../../../src/browser/runtime/browser-channel.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'javis-browser-channel-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const address = process.platform === 'win32'
    ? `\\\\.\\pipe\\javis-browser-test-${directory.split(/[\\/]/).at(-1)}`
    : join(directory, 'channel.sock')
  const channel = await createBrowserChannel({ address, token: 'fixture-token', expectedPid: () => process.pid })
  cleanup.push(() => channel.close())
  return { channel, address }
}

async function peer(address: string, token = 'fixture-token') {
  const socket = net.createConnection(address)
  await once(socket, 'connect')
  cleanup.push(async () => { socket.destroy() })
  socket.write(JSON.stringify({ kind: 'ready', token, pid: process.pid, protocolVersion: 1 }) + '\n')
  return socket
}

test('rejects an unauthenticated peer while allowing the browser owner to answer requests', async () => {
  const { channel, address } = await fixture()
  const denied = await peer(address, 'different-token')
  await once(denied, 'close')
  const browser = await peer(address)
  await channel.ready()
  browser.once('data', chunk => {
    const request = JSON.parse(chunk.toString())
    expect(request.method).toBe('browser.status')
    expect(request.params).toEqual({ page: 'page-one' })
    browser.write(JSON.stringify({ kind: 'response', id: request.id, ok: true, result: { running: true } }) + '\n')
  })
  await expect(channel.request('browser.status', { page: 'page-one' })).resolves.toEqual({ running: true })
})

test('preserves browser URL-guard error metadata across the channel', async () => {
  const { channel, address } = await fixture()
  const browser = await peer(address)
  await channel.ready()
  browser.once('data', chunk => {
    const request = JSON.parse(chunk.toString())
    browser.write(JSON.stringify({ kind: 'response', id: request.id, ok: false, error: {
      code: 'browser_expected_url_mismatch', message: 'The page changed',
      data: { expectedUrl: 'https://example.com/a', actualUrl: 'https://example.com/b', mayHaveStarted: false }
    } }) + '\n')
  })
  await expect(channel.request('browser.click', { page: 'page-one', element: '@e3' })).rejects.toMatchObject({
    code: 'browser_expected_url_mismatch',
    data: { expectedUrl: 'https://example.com/a', actualUrl: 'https://example.com/b', mayHaveStarted: false }
  })
})

test('requires a new browser generation after an ambiguous disconnect', async () => {
  const { channel, address } = await fixture()
  const browser = await peer(address)
  await channel.ready()
  browser.once('data', () => browser.destroy())
  await expect(channel.request('browser.type', { page: 'page-one', input: 'fixture value' })).rejects.toMatchObject({ code: 'browser_host_unavailable' })
  await expect(channel.request('browser.type', { page: 'page-one', input: 'fixture value' })).rejects.toMatchObject({ code: 'browser_host_unavailable' })
})
