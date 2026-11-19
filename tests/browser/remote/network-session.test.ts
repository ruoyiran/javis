import net from 'node:net'
import { expect, test } from 'vitest'
import { BrowserHostNetworkSessions } from '../../../src/browser/remote/network-session.js'
import { encodeBrowserNetworkTunnelFrame, encodeBrowserNetworkTunnelOpen, encodeBrowserNetworkTunnelWindowUpdate, decodeBrowserNetworkTunnelFrame, BrowserNetworkTunnelOpcode } from '../../../src/browser/source/shared/browser/network/tunnels/browser-network-tunnel-protocol.js'

test('executes browser network traffic on the selected host and reports blocked metadata destinations', async () => {
  const sockets = new Set<net.Socket>()
  const destination = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket))
    socket.on('data', () => socket.write('HTTP/1.1 200 OK\r\nContent-Length: 7\r\n\r\nHOST_OK'))
  })
  await new Promise<void>(resolve => destination.listen(0, '127.0.0.1', resolve))
  const address = destination.address() as net.AddressInfo
  const queue: ReturnType<typeof decodeBrowserNetworkTunnelFrame>[] = []
  let wake: (() => void) | undefined
  const sessions = new BrowserHostNetworkSessions(event => {
    if (event.method.endsWith('.binary')) { queue.push(decodeBrowserNetworkTunnelFrame(Buffer.from(String(event.params.bytes), 'base64'))); wake?.() }
    return true
  })
  const next = async () => { while (!queue.length) await new Promise<void>(resolve => wake = resolve); return queue.shift()! }
  const ready = sessions.call({ action: 'open', tunnelGeneration: 1 }) as { subscriptionId: string }
  const send = (streamId: number, opcode: BrowserNetworkTunnelOpcode, payload: Uint8Array) => sessions.call({ action: 'send', subscriptionId: ready.subscriptionId, bytes: Buffer.from(encodeBrowserNetworkTunnelFrame({ opcode, tunnelGeneration: 1, streamId, payload })).toString('base64') })
  try {
    send(1, BrowserNetworkTunnelOpcode.Open, encodeBrowserNetworkTunnelOpen({ host: '127.0.0.1', port: address.port }))
    expect(await next()).toMatchObject({ opcode: BrowserNetworkTunnelOpcode.Opened, streamId: 1, tunnelGeneration: 1 })
    send(1, BrowserNetworkTunnelOpcode.WindowUpdate, encodeBrowserNetworkTunnelWindowUpdate(262144))
    send(1, BrowserNetworkTunnelOpcode.Data, Buffer.from('GET / HTTP/1.1\r\nHost: fixture\r\n\r\n'))
    let reply = await next()
    while (reply?.opcode !== BrowserNetworkTunnelOpcode.Data) reply = await next()
    expect(Buffer.from(reply.payload).toString()).toBe('HTTP/1.1 200 OK\r\nContent-Length: 7\r\n\r\nHOST_OK')
    send(2, BrowserNetworkTunnelOpcode.Open, encodeBrowserNetworkTunnelOpen({ host: '169.254.169.254', port: 80 }))
    let blocked = await next()
    while (blocked?.streamId !== 2) blocked = await next()
    expect(blocked?.opcode).toBe(BrowserNetworkTunnelOpcode.Error)
    expect(Buffer.from(blocked!.payload).toString()).toBe('destination_blocked')
  } finally {
    sessions.close()
    for (const socket of sockets) socket.destroy()
    await new Promise<void>(resolve => destination.close(() => resolve()))
  }
})
