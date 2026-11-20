import { browserFixtureApplication, browserFixtureElectron, browserFixtureCli } from './browser-fixture-distribution.mjs'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
import { waitForBrowserFixtureState } from './browser-fixture-state.mjs'

process.env.ORCA_BACKGROUND_LAUNCH = '1'
const directory = await mkdtemp(join(tmpdir(), 'javis-latest-browser-'))
process.env.JAVIS_STATE_DIR = join(directory, 'state')
const probe = net.createServer()
await new Promise(done => probe.listen(0, '127.0.0.1', done))
const port = probe.address().port
await new Promise(done => probe.close(done))
let slowResponse
let slowRequested
const requestStarted = new Promise(done => { slowRequested = done })
const server = createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/html' })
  if (request.url === '/slow') {
    slowResponse = response
    response.write('<!doctype html><title>Slow fixture</title><p>Pending fixture</p>')
    slowRequested()
    return
  }
  response.end('<!doctype html><title>Latest fixture</title><label>Fixture value<textarea id="value"></textarea></label>')
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const url = `http://127.0.0.1:${server.address().port}/`
const context = `cwd:${directory}`
const runtime = join(directory, 'runtime.cjs')
await build({ stdin: { contents: "export {BrowserProcess} from './src/browser/runtime/browser-process.ts'; export {dispatchBrowserHostRequest} from './src/browser/remote/host-dispatch.ts';", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: runtime, external: ['electron', 'node-pty'], logLevel: 'silent' })
const { BrowserProcess, dispatchBrowserHostRequest } = createRequire(runtime)(runtime)
const engine = new BrowserProcess({ executable: browserFixtureElectron, entry: join(browserFixtureApplication, 'main/main.cjs'), applicationDirectory: browserFixtureApplication, dataDirectory: join(directory, 'state', 'browser'), launchArguments: [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], onEvent: event => {
  if (event.method === 'browser.host.request') void dispatchBrowserHostRequest(event.params).then(response => engine.call('browser.host.reply', { id: event.params.id, response })).catch(() => {})
} })
const call = (method, params = {}) => engine.call(method, params)
const outcomes = []
async function check(name, run) {
  try { await run(); outcomes.push({ name, status: 'passed' }) }
  catch (error) { outcomes.push({ name, status: 'failed', code: error.code ?? 'assertion', reason: String(error.message).slice(0, 400) }) }
  console.log(JSON.stringify(outcomes.at(-1)))
}
async function cli(args, input) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [browserFixtureCli, 'browser', ...args, '--json'], { cwd: directory, env: { ...process.env, JAVIS_STATE_DIR: join(directory, 'cli-state'), JAVIS_CLI_ENTRY: browserFixtureCli }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    let stdout = '', stderr = ''
    child.stdout.on('data', bytes => { stdout += bytes })
    child.stderr.on('data', bytes => { stderr += bytes })
    child.once('error', reject)
    child.once('exit', code => done({ code, stdout, stderr }))
    child.stdin.end(input)
  })
}
let browser, page, pageId
try {
  await call('browser.open', { worktree: context })
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  page = browser.contexts()[0].pages().find(candidate => candidate.url().includes('/renderer/index.html'))
  assert(page)
  page.setDefaultTimeout(10000)
  await page.waitForFunction(() => document.querySelector('input') !== null)
  await page.evaluate(() => window.api.settings.set({ uiLanguage: 'en' }))
  pageId = (await call('browser.tabCreate', { worktree: context, url })).browserPageId
  await call('browser.wait', { page: pageId, selector: '#value', timeout: 8000 })
  await check('zoom changes actual guest geometry and resets it', async () => {
    const before = Number((await call('browser.eval', { page: pageId, expression: 'innerWidth' })).result)
    await call('browser.zoom', { page: pageId, direction: 'in' })
    const zoomed = Number((await call('browser.eval', { page: pageId, expression: 'innerWidth' })).result)
    assert(zoomed < before)
    await call('browser.zoom', { page: pageId, direction: 'reset' })
    assert.equal(Number((await call('browser.eval', { page: pageId, expression: 'innerWidth' })).result), before)
  })
  await check('stop cancels an actual pending navigation without replay', async () => {
    const navigation = call('browser.goto', { page: pageId, url: `${url}slow` })
    navigation.catch(() => {})
    await requestStarted
    const stopped = await call('browser.stop', { page: pageId })
    assert.equal(typeof stopped.url, 'string')
    await waitForBrowserFixtureState(() => slowResponse.destroyed, 'the aborted navigation response')
    await call('browser.wait', { page: pageId, fn: 'document.readyState !== "loading"', timeout: 8000 })
    slowResponse.end('<p id="late">Late fixture</p>')
    await navigation.catch(() => {})
    await call('browser.goto', { page: pageId, url })
    await call('browser.wait', { page: pageId, selector: '#value', timeout: 8000 })
  })
  await check('real CLI stdin fill and headless placement reach the browser', async () => {
    const created = await cli(['tab', 'create', '--url', url, '--headless'])
    assert.equal(created.code, 0, created.stderr)
    const result = JSON.parse(created.stdout).result
    assert.equal(JSON.parse((await cli(['status'])).stdout).result.pages.some(item => item.browserPageId === result.browserPageId), true)
    const id = result.browserPageId
    assert.equal((await cli(['wait', '--page', id, '--selector', '#value'])).code, 0)
    assert.equal((await cli(['fill', '--page', id, '--element', '#value', '--value-stdin'], 'first\nsecond\r\n')).code, 0)
    const value = await cli(['eval', '--page', id, '--expression', 'document.querySelector("#value").value'])
    assert.equal(JSON.parse(value.stdout).result.result, 'first\nsecond')
    const rejected = await cli(['fill', '--page', id, '--element', '#value', '--value-stdin', '--value', 'forbidden'], 'stdin')
    assert.equal(rejected.code, 1)
    assert.equal((await cli(['fill', '--page', id, '--element', '#value', '--value-stdin'], '')).code, 1)
    assert.equal((await cli(['fill', '--page', id, '--element', '#value', '--value', ''])).code, 0)
    assert.equal(JSON.parse((await cli(['eval', '--page', id, '--expression', 'document.querySelector("#value").value'])).stdout).result.result, '')
  })
  await check('extension toolbar opens a real side panel guest with extension APIs', async () => {
    const extensionDirectory = join(directory, 'side-panel-extension')
    await mkdir(extensionDirectory)
    await writeFile(join(extensionDirectory, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Latest side panel fixture', version: '1.0', permissions: ['sidePanel', 'storage'], action: {}, side_panel: { default_path: 'panel.html' }, background: { service_worker: 'worker.js' }, content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['content.js'] }] }))
    await writeFile(join(extensionDirectory, 'worker.js'), 'chrome.runtime.onMessage.addListener((message,sender,reply)=>{chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).then(()=>reply({ready:true}));return true;});')
    await writeFile(join(extensionDirectory, 'content.js'), 'chrome.runtime.sendMessage({type:"ready"}).then(()=>document.documentElement.dataset.sidePanelFixture="ready");')
    await writeFile(join(extensionDirectory, 'panel.html'), '<!doctype html><title>Latest panel</title><p id="panel-value">Panel loading</p><script src="panel.js"></script>')
    await writeFile(join(extensionDirectory, 'panel.js'), 'chrome.storage.local.set({fixture:"panel-ready"}).then(()=>document.querySelector("#panel-value").textContent="Panel ready");')
    await page.evaluate(() => window.api.settings.set({ browserExtensionsEnabled: true }))
    const loaded = await page.evaluate(directory => window.api.browser.extensionsLoadUnpacked({ profileId: 'default', directory }), extensionDirectory)
    assert.equal(loaded.ok, true, loaded.error)
    const extension = (await call('browser.extensionList', { profileId: 'default' })).extensions.find(item => item.name === 'Latest side panel fixture')
    assert(extension)
    await call('browser.tabSwitch', { page: pageId, worktree: context, focus: false })
    await page.locator('[data-tab-id]').filter({ hasText: 'Latest fixture' }).click()
    await call('browser.reload', { page: pageId, expectUrl: url })
    await call('browser.wait', { page: pageId, fn: 'document.documentElement.dataset.sidePanelFixture === "ready"', timeout: 8000 })
    const activated = await page.evaluate(({ pageId, extensionId }) => window.api.browser.extensionsActivateAction({ browserPageId: pageId, extensionId, anchor: { x: 0, y: 0, width: 20, height: 20 }, popupOnly: false }), { pageId, extensionId: extension.id })
    assert.equal(activated.ok, true, activated.error)
    await waitForBrowserFixtureState(() => page.evaluate(async () => (await window.api.browser.extensionsSidePanels()).length === 1), 'the opened side panel')
    await page.waitForFunction(() => [...document.querySelectorAll('webview')].some(guest => { try { return guest.getURL().startsWith('chrome-extension:') } catch { return false } }))
    const panel = browser.contexts()[0].pages().find(candidate => candidate.url().startsWith(`chrome-extension://${extension.id}/panel.html`))
    assert(panel)
    await panel.waitForFunction(() => document.querySelector('#panel-value')?.textContent === 'Panel ready')
    assert.equal(await panel.evaluate(() => typeof window.api), 'undefined')
    const panels = await page.evaluate(() => window.api.browser.extensionsSidePanels())
    assert.equal(panels.length, 1)
    await page.evaluate(id => window.api.browser.extensionsSidePanelClose({ panelId: id }), panels[0].id)
    await waitForBrowserFixtureState(() => page.evaluate(async () => (await window.api.browser.extensionsSidePanels()).length === 0), 'the closed side panel')
  })
  await check('source editor saves successive real drafts through its granted folder', async () => {
    const file = join(directory, 'source.html')
    await writeFile(file, '<!doctype html><title>Latest source fixture</title><p>Original fixture</p>\n')
    const local = await call('browser.tabCreate', { worktree: context, url: pathToFileURL(file).href, activate: true, navigation: 'all' })
    await call('browser.wait', { page: local.browserPageId, selector: 'p', timeout: 8000 })
    await call('browser.tabSwitch', { page: local.browserPageId, worktree: context, focus: false })
    await page.locator('[data-tab-id]').filter({ hasText: 'Latest source fixture' }).click()
    await page.getByRole('button', { name: 'Open source file', exact: true }).click()
    const editor = page.locator('.monaco-editor textarea').first()
    await editor.waitFor({ state: 'visible' })
    await page.waitForFunction(() => [...document.querySelectorAll('.monaco-editor .view-line')].some(line => line.textContent.includes('Original')))
    for (const text of ['first-source-draft\n', 'second-source-draft\n', 'last-source-draft\n']) {
      await page.locator('.monaco-editor').first().click()
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
      await page.keyboard.insertText(text)
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S')
      await waitForBrowserFixtureState(async () => await readFile(file, 'utf8') === text, 'the exact source draft on disk')
      assert.equal(await readFile(file, 'utf8'), text)
    }
  })
} finally {
  slowResponse?.end()
  await browser?.close().catch(() => {})
  await engine.shutdown()
  await new Promise(done => {
    const stop = spawn(process.execPath, [browserFixtureCli, 'daemon', 'stop'], { env: { ...process.env, JAVIS_STATE_DIR: join(directory, 'cli-state'), JAVIS_CLI_ENTRY: browserFixtureCli }, stdio: 'ignore', windowsHide: true })
    stop.once('exit', done)
  })
  await new Promise(done => server.close(done))
  await rm(directory, { recursive: true, force: true })
}
console.log(JSON.stringify({ summary: outcomes }))
if (outcomes.some(outcome => outcome.status === 'failed')) process.exitCode = 1
