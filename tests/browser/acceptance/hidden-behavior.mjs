import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import net from 'node:net'
import { chromium } from 'playwright-core'

process.env.ORCA_BACKGROUND_LAUNCH = '1'
const directory = await mkdtemp(join(tmpdir(), 'javis-parity-acceptance-'))
process.env.JAVIS_STATE_DIR = join(directory, 'state')
const outcomes = []
const requests = new Set()
const server = createServer((request, response) => {
  requests.add(request.url)
  if (request.url === '/download') {
    response.writeHead(200, { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="fixture.txt"' })
    return response.end('accepted-download\n')
  }
  if (request.url === '/frame') {
    response.writeHead(200, { 'content-type': 'text/html' })
    return response.end('<!doctype html><label>Frame upload<input type="file" id="frame-file"></label><input id="frame-name">')
  }
  response.writeHead(200, { 'content-type': 'text/html' })
  response.end(`<!doctype html><meta name="viewport" content="width=device-width"><title>Acceptance fixture</title><label>Fixture name<input id="name"></label><button id="save" onclick="document.getElementById('result').textContent=document.getElementById('name').value">Save fixture</button><p id="result"></p><input type="file" id="upload"><button id="confirm" onclick="document.getElementById('result').textContent=confirm('Fixture confirm')">Confirm fixture</button><button id="prompt" onclick="document.getElementById('result').textContent=prompt('Fixture prompt', 'fixture-default')">Prompt fixture</button><a id="download" href="/download">Download fixture</a><iframe id="child" src="/frame"></iframe>`)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}/`
const context = `cwd:${directory}`
let engine
let browser
let page
let pageId
let isolatedProfile
const rendererErrors = []
const require = createRequire(resolve('package.json'))
const portServer = net.createServer()
await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve))
const port = portServer.address().port
await new Promise(resolve => portServer.close(resolve))
const runtime = join(directory, 'runtime.cjs')
await build({ stdin: { contents: "export {BrowserProcess} from './src/browser/runtime/browser-process.ts'; export {dispatchBrowserHostRequest} from './src/browser/remote/host-dispatch.ts';", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: runtime, external: ['electron', 'node-pty'], logLevel: 'silent' })
const { BrowserProcess, dispatchBrowserHostRequest } = createRequire(runtime)(runtime)
function start() {
  engine = new BrowserProcess({ executable: require('electron'), entry: resolve('dist/browser/main/main.cjs'), applicationDirectory: resolve('dist/browser'), dataDirectory: join(directory, 'state', 'browser'), launchArguments: [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], onEvent: event => {
    if (event.method !== 'browser.host.request') return
    const owner = engine
    void dispatchBrowserHostRequest(event.params).then(response => owner.call('browser.host.reply', { id: event.params.id, response })).catch(() => {})
  } })
}
async function check(name, run) {
  try { await run(); outcomes.push({ name, status: 'passed' }) }
  catch (error) { outcomes.push({ name, status: 'failed', code: error.code ?? 'assertion', reason: String(error.message).split('\n')[0].slice(0, 250) }) }
  console.log(JSON.stringify(outcomes.at(-1)))
}
const call = (method, params = {}) => engine.call(method, params)
async function evaluate(expression, id = pageId) {
  const result = await call('browser.eval', { page: id, expression })
  return result.result
}
async function guestReady(id = pageId) {
  await call('browser.wait', { page: id, selector: '#name', timeout: 8000 })
}

try {
  start()
  await check('offscreen page input and expected URL rejection', async () => {
    const created = await call('browser.tabCreate', { worktree: context, url })
    pageId = created.browserPageId
    assert.ok(pageId)
    await guestReady()
    await call('browser.fill', { page: pageId, element: '#name', value: 'accepted-value', expectUrl: url })
    await call('browser.click', { page: pageId, element: '#save', expectUrl: url })
    assert.equal(await evaluate('document.querySelector("#result").textContent'), 'accepted-value')
    await assert.rejects(() => call('browser.fill', { page: pageId, element: '#name', value: 'rejected-value', expectUrl: `${url}wrong` }))
    assert.equal(await evaluate('document.querySelector("#name").value'), 'accepted-value')
  })
  await check('default profile cookies and local/session storage reach the page', async () => {
    await call('browser.cookie.set', { page: pageId, name: 'acceptance', value: 'cookie-value', path: '/', expires: Math.floor(Date.now() / 1000) + 86400 })
    assert.equal(await evaluate('document.cookie'), 'acceptance=cookie-value')
    await call('browser.storage.local.set', { page: pageId, key: 'acceptance', value: 'local-value', expectUrl: url })
    await call('browser.storage.session.set', { page: pageId, key: 'acceptance', value: 'session-value', expectUrl: url })
    assert.equal(await evaluate('localStorage.getItem("acceptance")'), 'local-value')
    assert.equal(await evaluate('sessionStorage.getItem("acceptance")'), 'session-value')
    await call('browser.reload', { page: pageId, expectUrl: url })
    await guestReady()
    assert.equal(await evaluate('localStorage.getItem("acceptance")'), 'local-value')
    assert.equal(await evaluate('sessionStorage.getItem("acceptance")'), 'session-value')
  })
  await check('isolated profile switch separates real cookie and origin storage', async () => {
    const created = await call('browser.profileCreate', { label: 'Acceptance isolated', scope: 'isolated' })
    isolatedProfile = created.profile.id
    await call('browser.tabSetProfile', { page: pageId, profileId: isolatedProfile })
    await guestReady()
    assert.equal(await evaluate('document.cookie'), '')
    assert.equal(await evaluate('localStorage.getItem("acceptance")'), 'null')
    await call('browser.tabSetProfile', { page: pageId, profileId: 'default' })
    await guestReady()
    assert.equal(await evaluate('document.cookie'), 'acceptance=cookie-value')
    assert.equal(await evaluate('localStorage.getItem("acceptance")'), 'local-value')
  })
  await check('local file upload populates the real input', async () => {
    const file = join(directory, 'upload.txt')
    await writeFile(file, 'accepted-upload\n')
    await call('browser.upload', { page: pageId, element: '#upload', files: [file], expectUrl: url })
    assert.equal(await evaluate('document.querySelector("#upload").files[0].name'), 'upload.txt')
    assert.equal(await evaluate('document.querySelector("#upload").files[0].size'), '16')
    assert.equal(await evaluate('document.querySelector("#upload").files[0].text()'), 'accepted-upload\n')
  })
  await check('cross-frame upload uses the real iframe input', async () => {
    const file = join(directory, 'upload.txt')
    const snapshot = await call('browser.snapshot', { page: pageId, interactive: true })
    const refs = Array.isArray(snapshot.refs) ? snapshot.refs : Object.entries(snapshot.refs).map(([ref, value]) => ({ ref: `@${ref}`, ...value }))
    const target = refs.find(ref => ref.name === 'Frame upload')
    assert.ok(target, 'Snapshot must expose the frame upload input')
    await call('browser.upload', { page: pageId, element: target.ref, files: [file], expectUrl: url })
    assert.equal(await evaluate('document.querySelector("#child").contentDocument.querySelector("#frame-file").files[0].name'), 'upload.txt')
    assert.equal(await evaluate('document.querySelector("#child").contentDocument.querySelector("#frame-file").files[0].text()'), 'accepted-upload\n')
  })
  await check('confirm accept completes suspended page JavaScript', async () => {
    await assert.rejects(() => call('browser.click', { page: pageId, element: '#confirm', expectUrl: url }), error => error.code === 'browser_dialog_opened')
    await call('browser.dialogAccept', { page: pageId, expectUrl: url })
    assert.equal(await evaluate('document.querySelector("#result").textContent'), 'true')
  })
  await check('download writes controlled fixture bytes into temporary destination', async () => {
    const destination = join(directory, 'download.txt')
    await call('browser.download', { page: pageId, selector: '#download', path: destination, expectUrl: url })
    assert.equal(await readFile(destination, 'utf8'), 'accepted-download\n')
  })
  await check('viewport changes real page geometry', async () => {
    await call('browser.viewport', { page: pageId, width: 720, height: 480, deviceScaleFactor: 1, mobile: false })
    assert.equal(await evaluate('JSON.stringify({width:innerWidth,height:innerHeight})'), '{"width":720,"height":480}')
  })
  await check('screenshot and PDF capture return actual image and document bytes', async () => {
    const shot = await call('browser.screenshot', { page: pageId, annotate: true })
    const image = Buffer.from(shot.data, 'base64')
    assert.equal(image.subarray(1, 4).toString(), 'PNG')
    assert.equal(image.readUInt32BE(16), 720)
    assert.equal(image.readUInt32BE(20), 480)
    const full = await call('browser.fullScreenshot', { page: pageId, format: 'png' })
    assert.equal(Buffer.from(full.data, 'base64').subarray(1, 4).toString(), 'PNG')
    const pdf = await call('browser.pdf', { page: pageId })
    assert.equal(Buffer.from(pdf.data, 'base64').subarray(0, 5).toString(), '%PDF-')
  })
  await check('restart restores rows lazily and reopens persistent default profile data', async () => {
    const neverVisited = `${url}lazy-restore`
    const lazy = await call('browser.tabCreate', { worktree: 'id:lazy', url: neverVisited })
    await call('browser.wait', { page: lazy.browserPageId, selector: '#name', timeout: 8000 })
    await engine.shutdown()
    requests.delete('/lazy-restore')
    start()
    await call('browser.status')
    const listed = await call('browser.tabList', { worktree: 'id:lazy' })
    assert.ok(listed.tabs.some(tab => tab.browserPageId === lazy.browserPageId))
    assert.equal(requests.has('/lazy-restore'), false)
    await call('browser.tabClose', { page: lazy.browserPageId })
    assert.equal(requests.has('/lazy-restore'), false)
    await guestReady()
    assert.equal(await evaluate('document.cookie'), 'acceptance=cookie-value')
    assert.equal(await evaluate('localStorage.getItem("acceptance")'), 'local-value')
  })
  await check('annotation receipt survives restart and isolates context', async () => {
    const receipt = await call('browser.annotations.enqueue', { context, deliveryId: 'acceptance-notes', annotations: [{ comment: 'controlled fixture note' }] })
    await engine.shutdown()
    start()
    const repeated = await call('browser.annotations.enqueue', { context, deliveryId: 'acceptance-notes', annotations: [{ comment: 'controlled fixture note' }] })
    assert.equal(receipt.id, repeated.id)
    await call('browser.annotations.ack', { id: receipt.id })
    assert.ok(!(await call('browser.annotations.list', { context })).some(row => row.id === receipt.id))
    assert.ok((await call('browser.annotations.list', { context, includeAcknowledged: true })).some(row => row.id === receipt.id && row.status === 'acknowledged'))
    assert.deepEqual(await call('browser.annotations.list', { context: 'id:other', includeAcknowledged: true }), [])
  })
  await check('restored folder workspace initially mounts browser chrome', async () => {
    await call('browser.status')
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    browser.contexts()[0].on('page', opened => {
      opened.on('pageerror', error => rendererErrors.push(error.message.split('\n')[0]))
      opened.on('console', message => { if (message.type() === 'error') rendererErrors.push(message.text().split('\n')[0].slice(0, 200)) })
    })
    await call('browser.open', { worktree: context })
    page = browser.contexts()[0].pages().find(page => page.url().includes('/renderer/index.html'))
    assert.ok(page)
    page.setDefaultTimeout(8000)
    await page.evaluate(() => window.api.settings.set({ uiLanguage: 'en' }))
    await page.reload()
    page.on('pageerror', error => rendererErrors.push(error.message.split('\n')[0]))
    try { await page.waitForFunction(() => document.querySelector('input') !== null, null, { timeout: 12000 }) }
    catch { throw new Error(`Workspace did not mount address input: ${rendererErrors[0] ?? 'no renderer exception observed'}`) }
  })
  await check('real workspace renderer creates and controls a hidden guest', async () => {
    const created = await call('browser.tabCreate', { worktree: context, url, activate: true })
    pageId = created.browserPageId
    await guestReady()
    await call('browser.fill', { page: pageId, element: '#name', value: 'rendered-value', expectUrl: url })
    await call('browser.click', { page: pageId, element: '#save', expectUrl: url })
    assert.equal(await evaluate('document.querySelector("#result").textContent'), 'rendered-value')
    assert.equal((await call('browser.status')).visible, false)
  })
  await check('rendered guest profile switch remounts with isolated storage and restores default data', async () => {
    await call('browser.tabSetProfile', { page: pageId, profileId: isolatedProfile })
    await guestReady()
    assert.equal(await evaluate('document.cookie'), '')
    assert.equal(await evaluate('localStorage.getItem("acceptance")'), 'null')
    await call('browser.tabSetProfile', { page: pageId, profileId: 'default' })
    await guestReady()
    assert.equal(await evaluate('document.cookie'), 'acceptance=cookie-value')
    assert.equal(await evaluate('localStorage.getItem("acceptance")'), 'local-value')
  })
  await check('floating workspace creates its own real guest and hides on minimize', async () => {
    assert.ok(page, 'Renderer must be connected')
    await page.getByRole('button', { name: 'Floating workspace', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('[data-javis-floating]')?.getAttribute('aria-hidden') === 'false')
    const tabs = await call('browser.tabList', { worktree: 'global-floating-terminal' })
    assert.ok(tabs.tabs.length > 0, 'Floating tab must be registered')
    await page.getByRole('button', { name: 'Minimize floating workspace' }).click()
    await page.waitForFunction(() => document.querySelector('[data-javis-floating]')?.getAttribute('aria-hidden') === 'true')
    assert.equal((await call('browser.status')).visible, false)
  })
  await check('rendered guest prompt answers and permits subsequent page input', async () => {
    await guestReady()
    await assert.rejects(() => call('browser.click', { page: pageId, element: '#prompt', expectUrl: url }), error => error.code === 'browser_dialog_opened')
    const answer = await call('browser.dialogAccept', { page: pageId, expectUrl: url })
    assert.equal(answer.accepted, true)
    await call('browser.fill', { page: pageId, element: '#name', value: 'after-prompt', expectUrl: url })
    assert.equal(await evaluate('document.querySelector("#name").value'), 'after-prompt')
  })
  await check('unpacked extension injects real content script and disable removes it on navigation', async () => {
    assert.ok(page, 'Workspace preload must be connected')
    const extensionDirectory = join(directory, 'fixture-extension')
    await mkdir(extensionDirectory)
    await writeFile(join(extensionDirectory, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Acceptance extension', version: '1.0', content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['content.js'], run_at: 'document_end' }] }))
    await writeFile(join(extensionDirectory, 'content.js'), 'document.documentElement.dataset.acceptanceExtension="loaded"')
    await page.evaluate(() => window.api.settings.set({ browserExtensionsEnabled: true }))
    const result = await page.evaluate(directory => window.api.browser.extensionsLoadUnpacked({ profileId: 'default', directory }), extensionDirectory)
    assert.equal(result.ok, true, result.error ?? 'Fixture extension installation must succeed')
    const list = await call('browser.extensionList', { profileId: 'default' })
    const extension = list.extensions.find(extension => extension.name === 'Acceptance extension')
    assert.ok(extension, 'Installed fixture extension must be listed')
    const created = await call('browser.tabCreate', { worktree: 'id:extension-fixture', url })
    await call('browser.wait', { page: created.browserPageId, fn: 'document.documentElement.dataset.acceptanceExtension === "loaded"', timeout: 8000 })
    await writeFile(join(extensionDirectory, 'content.js'), 'document.documentElement.dataset.acceptanceExtension="reloaded"')
    await call('browser.extensionReload', { profileId: 'default', extensionId: extension.id })
    await call('browser.reload', { page: created.browserPageId, expectUrl: url })
    await call('browser.wait', { page: created.browserPageId, fn: 'document.documentElement.dataset.acceptanceExtension === "reloaded"', timeout: 8000 })
    await page.evaluate(extensionId => window.api.browser.extensionsSetEnabled({ profileId: 'default', extensionId, enabled: false }), extension.id)
    await call('browser.reload', { page: created.browserPageId, expectUrl: url })
    await guestReady(created.browserPageId)
    assert.equal(await evaluate('document.documentElement.dataset.acceptanceExtension ?? "absent"', created.browserPageId), 'absent')
    await page.evaluate(extensionId => window.api.browser.extensionsRemove({ profileId: 'default', extensionId }), extension.id)
  })
  await check('source editor host stat and read are available through workspace preload', async () => {
    const file = join(directory, 'source.txt')
    await writeFile(file, 'source-fixture\n')
    const result = await page.evaluate(context => window.api.javisBrowser.call('browser.host.call', { target: 'local', method: 'files.stat', params: { worktree: context, relativePath: 'source.txt' } }), context)
    assert.equal(result.size, 15, `Stat endpoint returned envelope=${result.ok === true}, nested fixture size=${result.result?.size}`)
  })
  await check('local HTML Open Source mounts editor and saves through its granted folder', async () => {
    const file = join(directory, 'source.html')
    await writeFile(file, '<!doctype html><title>Source fixture</title><p>source-fixture</p>\n')
    const local = await call('browser.tabCreate', { worktree: context, url: pathToFileURL(file).href, activate: true, navigation: 'all' })
    await call('browser.wait', { page: local.browserPageId, selector: 'p', timeout: 8000 })
    await call('browser.tabSwitch', { page: local.browserPageId, worktree: context, focus: false })
    try { await page.locator('[data-tab-id]').filter({ hasText: 'Source fixture' }).click() }
    catch { throw new Error('Local HTML fixture tab did not appear in the tab bar') }
    try { await page.getByRole('button', { name: 'Open source file', exact: true }).click() }
    catch { throw new Error('Selected local HTML fixture has no Open Source control') }
    const editor = page.locator('.monaco-editor textarea').first()
    await editor.waitFor({ state: 'visible' })
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
    await page.keyboard.insertText('source-updated\n')
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S')
    await page.waitForFunction(async context => {
      const response = await window.api.javisBrowser.call('browser.host.call', { target: 'local', method: 'files.readChunk', params: { worktree: context, relativePath: 'source.html', offset: 0, length: 1024 } })
      return atob(response.contentBase64) === 'source-updated\n'
    }, context)
    assert.equal(await readFile(file, 'utf8'), 'source-updated\n')
  })
  await check('fresh opaque context can mount browser chrome independently of restored folder tabs', async () => {
    await call('browser.open', { worktree: 'id:fresh-ui-fixture' })
    await page.waitForFunction(() => document.querySelector('input') !== null)
    assert.equal((await call('browser.status')).visible, false)
  })
} finally {
  await browser?.close().catch(() => {})
  await engine?.shutdown()
  await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
console.log(JSON.stringify({ summary: outcomes }))
if (outcomes.some(outcome => outcome.status === 'failed')) process.exitCode = 1
