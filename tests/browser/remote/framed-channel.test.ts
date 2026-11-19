import { expect, test } from 'vitest'
import { PassThrough } from 'node:stream'
import { BrowserFrameDecoder, createBrowserStreamClient } from '../../../src/browser/remote/framed-channel.js'

function frame(text: string): Buffer { const body = Buffer.from(text); const header = Buffer.alloc(4); header.writeUInt32BE(body.length); return Buffer.concat([header, body]) }

test('decodes fragmented control and file chunks without combining request ownership', () => {
  const decoder = new BrowserFrameDecoder()
  const bytes = Buffer.concat([frame('{"id":7,"method":"browser.clientHost.fileChannel.write","params":{"offset":0,"contentBase64":"aGVsbG8="}}'), frame('{"id":8,"ok":true,"result":{"accepted":true}}')])
  expect(decoder.push(bytes.subarray(0, 6))).toEqual([])
  expect(decoder.push(bytes.subarray(6))).toEqual([
    { id: 7, method: 'browser.clientHost.fileChannel.write', params: { offset: 0, contentBase64: 'aGVsbG8=' } },
    { id: 8, ok: true, result: { accepted: true } }
  ])
  decoder.finish()
})

test('refuses oversized frames and incomplete action delivery', () => {
  expect(() => new BrowserFrameDecoder().push(Buffer.from([2, 0, 0, 1]))).toThrow('size limit')
  const decoder = new BrowserFrameDecoder()
  decoder.push(frame('{"id":4}').subarray(0, 5))
  expect(() => decoder.finish()).toThrow('action delivery may be uncertain')
})

test('disconnect rejects pending action without replay and a new channel accepts fresh observation', async () => {
  const input = new PassThrough(); const output = new PassThrough()
  const connection = createBrowserStreamClient(input, output, { identity: { pairedDeviceId: 'phone-1', clientKind: 'mobile' }, onEvent: () => {} }, request => ({ ...request, token: 'private-token' }))
  const action = connection.call('browser.click', { page: 'page-a', element: '@e2' })
  const requestBytes = output.read() as Buffer
  expect(new BrowserFrameDecoder().push(requestBytes)).toEqual([{ id: 1, method: 'browser.click', params: { page: 'page-a', element: '@e2' }, token: 'private-token' }])
  connection.close()
  await expect(action).rejects.toThrow('action delivery may be uncertain')
  const nextInput = new PassThrough(); const nextOutput = new PassThrough()
  const next = createBrowserStreamClient(nextInput, nextOutput, { identity: { pairedDeviceId: 'phone-1', clientKind: 'mobile' }, onEvent: () => {} })
  const observation = next.call('browser.snapshot', { page: 'page-a' })
  nextInput.write(frame('{"id":1,"ok":true,"result":{"url":"https://fixture.test/","snapshot":"button Go"}}'))
  await expect(observation).resolves.toEqual({ url: 'https://fixture.test/', snapshot: 'button Go' })
  next.close()
})
