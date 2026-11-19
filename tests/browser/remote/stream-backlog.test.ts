import { expect, test } from 'vitest'
import { PassThrough } from 'node:stream'
import { BrowserFrameDecoder, createBrowserStreamClient, writeBrowserFrame } from '../../../src/browser/remote/framed-channel.js'
import { BrowserStreamDelivery } from '../../../src/browser/main/stream-delivery.js'
import { deliverScreencastSubscriberFrame, cancelScreencastSubscriberFrameRetry } from '../../../src/browser/source/main/runtime/browser/screencast/browser-screencast-subscriber-frame-delivery.js'
import type { ActiveBrowserScreencastSubscriber } from '../../../src/browser/source/main/runtime/browser/screencast/browser-screencast-contracts.js'
import { encodeBrowserScreencastFrame, decodeBrowserScreencastFrame, BrowserScreencastOpcode } from '../../../src/browser/source/shared/browser/screencast/browser-screencast-protocol.js'

const frame = (seq: number) => encodeBrowserScreencastFrame({ opcode: BrowserScreencastOpcode.Frame, seq, format: 'png', metadata: {}, image: new Uint8Array([seq]) })

test('lossy writer reports backlog without enqueueing another frame and consumer feedback remains distinct from drain', async () => {
  const output = new PassThrough({ highWaterMark: 1 })
  expect(writeBrowserFrame(output, { page: 'a', seq: 1 }, { dropWhenBacklogged: true })).toBe(true)
  expect(writeBrowserFrame(output, { page: 'a', seq: 2 }, { dropWhenBacklogged: true })).toBe('backlogged')
  expect(new BrowserFrameDecoder().push(output.read())).toEqual([{ page: 'a', seq: 1 }])
  const input = new PassThrough(); const replies = new PassThrough()
  const stream = createBrowserStreamClient(input, replies, { identity: { pairedDeviceId: 'device-a', clientKind: 'mobile' }, onEvent: () => ({ outcome: 'backlogged', backlogged: true }) })
  writeBrowserFrame(input, { type: 'event', method: 'browser.stream.binary', params: { packetId: 'packet-a', bytes: 'AQ==' } })
  expect(new BrowserFrameDecoder().push(replies.read())).toEqual([{ id: 1, method: '__browserDelivery', params: { packetId: 'packet-a', outcome: 'backlogged', backlogged: true } }])
  writeBrowserFrame(input, { id: 1, ok: true, result: { accepted: true } })
  stream.setBacklogged?.(false)
  expect(new BrowserFrameDecoder().push(replies.read())).toEqual([{ id: 2, method: '__browserFlow', params: { backlogged: false } }])
  writeBrowserFrame(input, { id: 2, ok: true, result: { accepted: true } })
  stream.close()
})

test('slow viewer retains the admitted packet and source retries only its newest rejected frame without blocking another viewer', async () => {
  const received: { viewer: string; seq: number }[] = []
  let blocked = true
  let finished!: () => void
  const newest = new Promise<void>(resolve => finished = resolve)
  const delivery = new BrowserStreamDelivery(event => {
    const connectionId = String(event.params.__javisConnectionId)
    const packetId = String(event.params.packetId)
    if (connectionId === 'slow' && blocked) { delivery.acknowledge({ connectionId, packetId, outcome: 'backlogged', backlogged: true }); return }
    const image = decodeBrowserScreencastFrame(Buffer.from(String(event.params.bytes), 'base64'))!
    received.push({ viewer: connectionId, seq: image.seq })
    delivery.acknowledge({ connectionId, packetId, outcome: true })
    if (connectionId === 'slow' && image.seq === 3) finished()
  })
  const subscriber = { sendBinary: (bytes: Uint8Array) => delivery.send('slow', 'stream-slow', 'browser.screencast', bytes, true), pendingFrame: null, pendingFrameRetry: null, frameCredit: null, delivery: { refusalStreak: 0, hasDeliveredFrame: false } } as unknown as ActiveBrowserScreencastSubscriber
  try {
    deliverScreencastSubscriberFrame(subscriber, frame(1))
    deliverScreencastSubscriberFrame(subscriber, frame(2))
    deliverScreencastSubscriberFrame(subscriber, frame(3))
    delivery.send('other', 'stream-other', 'browser.screencast', frame(4), true)
    blocked = false; delivery.flow('slow', false)
    await newest
    expect(received).toEqual([{ viewer: 'other', seq: 4 }, { viewer: 'slow', seq: 1 }, { viewer: 'slow', seq: 3 }])
  } finally { cancelScreencastSubscriberFrameRetry(subscriber); delivery.close('slow'); delivery.close('other') }
})
