import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdtemp, rm, cp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

process.env.ORCA_BACKGROUND_LAUNCH = '1'
const directory = await mkdtemp(join(tmpdir(), 'javis-stdio-acceptance-'))
const copied = join(directory, 'independent', 'dist')
await cp(resolve('dist'), copied, { recursive: true, verbatimSymlinks: true })
const entry = join(copied, 'cli.cjs')
const remoteState = join(directory, 'remote-state')
const wrapper = join(directory, 'local-stdio-as-ssh.cjs')
await writeFile(wrapper, `const {spawn}=require('node:child_process'); const args=process.argv.slice(2); const mode=args.at(-1); if(!['--stdio','--stream-stdio'].includes(mode)||!args.includes('fixture-host'))process.exit(2); const child=spawn(process.execPath,[${JSON.stringify(entry)},'rpc',mode],{stdio:'inherit',windowsHide:true,env:{...process.env,ORCA_BACKGROUND_LAUNCH:'1',JAVIS_STATE_DIR:${JSON.stringify(remoteState)},JAVIS_CLI_ENTRY:${JSON.stringify(entry)}}});process.on('SIGTERM',()=>child.kill());child.on('exit',code=>process.exit(code??1));`)
const library = join(directory, 'client.cjs')
await build({ stdin: { contents: `export {callRemoteJavis,connectRemoteJavisBrowserStream} from './src/runtime/remote-stdio.ts'; export {MobileBrowserSession} from './src/mobile/browser-session.ts'; export {startMobileGateway} from './src/mobile/gateway.ts'; export {decodeBrowserScreencastFrame} from './src/browser/source/shared/browser/screencast/browser-screencast-protocol.ts';`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: library, external: ['electron', 'node-pty'], loader: { '.svg': 'text' }, logLevel: 'silent' })
const { callRemoteJavis, connectRemoteJavisBrowserStream, MobileBrowserSession, decodeBrowserScreencastFrame, startMobileGateway } = createRequire(library)(library)
const transport = { sshExecutable: process.execPath, sshPrefixArgs: [wrapper], timeoutMs: 60000 }
const server = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<!doctype html><meta name="viewport" content="width=device-width"><title>Stream fixture</title><input id="value"><button id="save" onclick="document.querySelector(\'#result\').textContent=document.querySelector(\'#value\').value">Save</button><p id="result"></p>') })
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}/`
const context = 'id:independent-remote'
const outcomes = []
const sessions = []
const observers = []
async function check(name, run) {
  try { await run(); outcomes.push({ name, status: 'passed' }) }
  catch (error) { outcomes.push({ name, status: 'failed', code: error.code ?? 'assertion', reason: String(error.message).split('\n')[0].slice(0, 200) }) }
  console.log(JSON.stringify(outcomes.at(-1)))
}
const call = (method, params = {}) => callRemoteJavis(method, params, 'fixture-host', transport)
function nextFrame(session) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { dispose(); reject(new Error('No actual source frame received')) }, 15000)
    const dispose = session.attachViewer(event => {
      if (event.method !== 'browser.stream.binary') return { outcome: true }
      const frame = decodeBrowserScreencastFrame(Buffer.from(event.params.bytes, 'base64'))
      if (!frame || frame.image.length < 4) { clearTimeout(timer); reject(new Error('Invalid source image frame')); return { outcome: false } }
      clearTimeout(timer); resolve(frame)
      return { outcome: true }
    })
    observers.push(dispose)
  })
}
let pageA, pageB
try {
  await check('copied CLI routes one-shot stdio browser actions without sibling checkout', async () => {
    pageA = (await call('browser.tabCreate', { worktree: context, url })).browserPageId
    await call('browser.wait', { page: pageA, selector: '#value', timeout: 8000 })
    await call('browser.fill', { page: pageA, element: '#value', value: 'remote-value', expectUrl: url })
    await call('browser.click', { page: pageA, element: '#save', expectUrl: url })
    assert.equal((await call('browser.eval', { page: pageA, expression: 'document.querySelector("#result").textContent' })).result, 'remote-value')
    assert.equal((await call('browser.status')).visible, false)
    pageB = (await call('browser.tabCreate', { worktree: context, url })).browserPageId
    await call('browser.wait', { page: pageB, selector: '#value', timeout: 8000 })
  })
  await check('two device streams deliver actual frames and reject cross-device acknowledgement', async () => {
    for (const id of [pageA, pageB]) {
      const session = new MobileBrowserSession(options => connectRemoteJavisBrowserStream('fixture-host', options, transport))
      await session.select({ page: id, worktree: context, sessionId: `fixture-${id}`, profileId: 'default', url: '', width: 0, height: 0, observedAt: 0 })
      sessions.push(session)
    }
    const [a, b] = sessions
    const firstA = nextFrame(a), firstB = nextFrame(b)
    firstA.catch(() => {}); firstB.catch(() => {})
    await Promise.all([a.startStream({ width: 400, height: 800, deviceScaleFactor: 1 }), b.startStream({ width: 400, height: 800, deviceScaleFactor: 1 })])
    const [frameA, frameB] = await Promise.all([firstA, firstB])
    assert.equal(frameA.format, 'jpeg')
    assert.equal(frameB.format, 'jpeg')
    assert.equal(frameA.metadata.deviceWidth, 400)
    assert.equal(frameA.metadata.deviceHeight, 800)
    assert.notEqual(a.subscriptionId, b.subscriptionId)
    const foreignAck = await b.call('browser.screencast.ack', { subscriptionId: a.subscriptionId, seq: frameA.seq })
    assert.equal(foreignAck.credited, false)
    const ownAck = await Promise.all([a.ack(frameA.seq), b.ack(frameB.seq)])
    assert.equal(ownAck[0].credited, true)
    assert.equal(ownAck[1].credited, true)
    const next = nextFrame(a)
    next.catch(() => {})
    await call('browser.eval', { page: pageA, expression: 'document.querySelector("#result").textContent="frame-updated"' })
    const advanced = await next
    assert.ok(advanced.seq > frameA.seq, 'Acknowledged stream must deliver another real frame')
    assert.equal((await a.ack(advanced.seq)).credited, true)
  })
  await check('device input changes its selected page and leaves the other page isolated', async () => {
    const [a, b] = sessions
    await Promise.all([a.observe(), b.observe()])
    await a.act('browser.fill', { element: '#value', value: 'device-a-value' })
    assert.equal((await call('browser.eval', { page: pageA, expression: 'document.querySelector("#value").value' })).result, 'device-a-value')
    assert.equal((await call('browser.eval', { page: pageB, expression: 'document.querySelector("#value").value' })).result, '')
    await assert.rejects(() => a.act('browser.fill', { page: pageB, element: '#value', value: 'wrong-page' }))
    a.close()
    await assert.rejects(() => a.act('browser.type', { input: 'closed-input' }))
    await b.act('browser.fill', { element: '#value', value: 'device-b-value' })
    assert.equal((await call('browser.eval', { page: pageB, expression: 'document.querySelector("#value").value' })).result, 'device-b-value')
  })
  await check('stdio file channel reads and writes only granted temporary context', async () => {
    const connection = await connectRemoteJavisBrowserStream('fixture-host', { identity: { pairedDeviceId: 'file-runtime', clientKind: 'runtime' }, onEvent: () => ({ outcome: true }) }, transport)
    try {
      const file = join(directory, 'owned.txt')
      await writeFile(file, 'remote-file-value')
      const result = await connection.call('__browserHost', { method: 'files.readChunk', params: { worktree: `cwd:${directory}`, relativePath: 'owned.txt', offset: 0, length: 1024 } })
      assert.equal(Buffer.from(result.contentBase64, 'base64').toString(), 'remote-file-value')
      await assert.rejects(() => connection.call('__browserHost', { method: 'files.readChunk', params: { worktree: `cwd:${directory}`, relativePath: '../outside.txt', offset: 0, length: 1024 } }))
    } finally { connection.close() }
  })
  await check('paired phone UI decodes actual source JPEG through gateway SSE and clears old page on switch', async () => {
    for (const session of sessions) session.close()
    const gateway = await startMobileGateway({ bind: '127.0.0.1', port: 0, call: async () => ({ apps: [] }), browserConnect: options => connectRemoteJavisBrowserStream('fixture-host', options, transport) })
    let viewer
    try {
      viewer = await chromium.launch({ executablePath: process.env.JAVIS_TEST_CHROMIUM ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
      const phone = await viewer.newPage({ viewport: { width: 390, height: 844 } })
      phone.setDefaultTimeout(15000)
      await phone.goto(gateway.url)
      await phone.locator('#pair-code').fill(gateway.pairingCode)
      await phone.locator('#pair-form').evaluate(form => form.requestSubmit())
      await phone.locator('#workspace').waitFor({ state: 'visible' })
      await phone.locator('#browser-pages-refresh').click()
      await phone.waitForFunction(page => [...document.querySelector('#browser-pages').options].some(option => option.value === page), pageA)
      await phone.locator('#browser-pages').selectOption(pageA)
      await phone.locator('#browser-stream').click()
      await phone.waitForFunction(() => { const image = document.querySelector('#browser-frame'); return image.complete && image.naturalWidth > 0 && !image.hidden })
      assert.equal(await phone.locator('#browser-frame').evaluate(image => image.complete && image.naturalWidth > 0), true)
      await phone.locator('#browser-pages').selectOption(pageB)
      await phone.waitForFunction(() => { const image = document.querySelector('#browser-frame'); return image.hidden && image.getAttribute('src') === null })
      await phone.locator('#browser-stream').click()
      await phone.waitForFunction(() => { const image = document.querySelector('#browser-frame'); return image.complete && image.naturalWidth > 0 && !image.hidden })
    } finally { await viewer?.close(); await gateway.close() }
  })
} finally {
  for (const close of observers) close()
  for (const session of sessions) session.close()
  await new Promise(resolve => {
    const stop = spawn(process.execPath, [entry, 'daemon', 'stop'], { windowsHide: true, stdio: 'ignore', env: { ...process.env, JAVIS_STATE_DIR: remoteState, JAVIS_CLI_ENTRY: entry } })
    stop.once('exit', resolve)
  })
  await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
console.log(JSON.stringify({ summary: outcomes }))
if (outcomes.some(outcome => outcome.status === 'failed')) process.exitCode = 1
