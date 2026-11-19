import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, test } from 'vitest'
import { BrowserProcess } from '../../../src/browser/runtime/browser-process.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

test('starts a private browser peer and shuts down its owned child', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'javis-browser-peer-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const entry = join(directory, 'peer.cjs')
  const marker = join(directory, 'stopped')
  await writeFile(entry, `
const net = require('node:net'); const fs = require('node:fs');
const socket = net.createConnection(process.env.JAVIS_BROWSER_CHANNEL);
socket.on('connect', () => socket.write(JSON.stringify({kind:'ready',token:process.env.JAVIS_BROWSER_TOKEN,pid:process.pid,protocolVersion:1})+'\\n'));
let pending=''; socket.on('data', chunk => { pending+=chunk; const lines=pending.split('\\n'); pending=lines.pop();
for(const line of lines){const request=JSON.parse(line);socket.write(JSON.stringify({kind:'response',id:request.id,ok:true,result:request.method==='browser.status'?{running:true,background:process.env.JAVIS_BROWSER_BACKGROUND==='1'}:{stopped:true}})+'\\n');
if(request.method==='__shutdown'){fs.writeFileSync(process.env.JAVIS_BROWSER_DATA_DIRECTORY+'/stopped','closed');socket.end();}}});
socket.on('close',()=>process.exit(0));
`)
  const browser = new BrowserProcess({ executable: process.execPath, entry, dataDirectory: directory })
  cleanup.push(() => browser.shutdown())
  await expect(Promise.all([browser.call('browser.status', {}), browser.call('browser.status', {})])).resolves.toEqual([
    { running: true, background: true }, { running: true, background: true }
  ])
  await browser.shutdown()
  expect(await readFile(marker, 'utf8')).toBe('closed')
})
