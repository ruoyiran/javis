import { expect, it } from 'vitest'
import { BrowserStreamDelivery } from '../../../src/browser/main/stream-delivery'
it('holds a refused frame through backlog and keeps viewer delivery independent', () => {
  const packets: { method: string; params: Record<string, unknown> }[] = []
  const stream = new BrowserStreamDelivery(event => packets.push(event))
  expect(stream.send('phone', 'subscription-a', 'browser.screencast', Buffer.from('A'), true)).toBe(true)
  const first = packets[0]!
  expect(stream.send('phone', 'subscription-a', 'browser.screencast', Buffer.from('B'), true)).toBe('backlogged')
  expect(stream.send('desktop', 'subscription-b', 'browser.screencast', Buffer.from('D'), true)).toBe(true)
  expect(stream.acknowledge({ connectionId: 'phone', packetId: String(first.params.packetId), outcome: 'backlogged' })).toBe(true)
  stream.flow('phone', false)
  expect(packets.at(-1)?.params).toMatchObject({ bytes: 'QQ==', __javisConnectionId: 'phone', subscriptionId: 'subscription-a' })
  expect(stream.acknowledge({ connectionId: 'desktop', packetId: String(first.params.packetId), outcome: true })).toBe(false)
  expect(stream.acknowledge({ connectionId: 'phone', packetId: String(first.params.packetId), outcome: true })).toBe(true)
  expect(stream.send('phone', 'subscription-a', 'browser.screencast', Buffer.from('C'), true)).toBe(true)
  expect(packets.at(-1)?.params.bytes).toBe('Qw==')
})
it('ignores a late acknowledgment after replacing a subscription', () => {
  const packets: { method: string; params: Record<string, unknown> }[] = []
  const stream = new BrowserStreamDelivery(event => packets.push(event))
  stream.send('phone', 'old', 'browser.screencast', Buffer.from('old'), true)
  const packetId = String(packets[0]!.params.packetId)
  stream.replace('phone', 'new')
  stream.send('phone', 'new', 'browser.screencast', Buffer.from('new'), true)
  expect(stream.acknowledge({ connectionId: 'phone', packetId, outcome: false })).toBe(false)
  expect(stream.send('phone', 'new', 'browser.screencast', Buffer.from('latest'), true)).toBe('backlogged')
})
