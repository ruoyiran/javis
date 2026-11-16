import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DesktopScriptProviderClient } from '../../src/runtime/desktop-script-provider/client.js'

const fixture = `import json, pathlib, signal, sys, time
with open(sys.argv[1], encoding='utf-8') as source:
    request = json.load(source)
tool = request['tool']
directory = pathlib.Path(__file__).parent
mode = pathlib.Path(__file__).stem
app = {'name': 'Demo', 'bundleId': None, 'pid': 42}
snapshot = {'snapshotId': 'before', 'app': app, 'windowTitle': 'Main', 'windowId': 7,
            'windowIndex': 0, 'windowBounds': {'x': 10, 'y': 20, 'width': 300, 'height': 200},
            'treeLines': ['3 text field Value: old'], 'focusedElementId': 3,
            'elements': [{'index': 3, 'runtimeId': [4, 5], 'value': 'old'}]}
supports = {'apps': {'list': True, 'bundleIds': False, 'pids': True},
            'windows': {'list': True, 'targetById': True, 'targetByIndex': True, 'focus': False, 'moveResize': False},
            'observation': {'screenshot': True, 'annotatedScreenshot': False, 'elementFrames': True, 'ocr': False},
            'actions': {'click': True, 'typeText': True, 'pressKey': True, 'hotkey': False,
                        'pasteText': True, 'scroll': True, 'drag': True, 'setValue': True, 'performAction': True},
            'surfaces': {'menus': False, 'dialogs': False, 'dock': False, 'menubar': False}}
if tool == 'handshake':
    if mode == 'late_gate':
        (directory / 'handshake-started').write_text('started')
        while not (directory / 'release-handshake').exists():
            time.sleep(0.01)
    result = {'ok': True, 'capabilities': {'platform': 'linux', 'provider': 'fixture',
              'providerVersion': '1', 'protocolVersion': 1, 'supports': supports}}
elif tool == 'get_app_state':
    result = {'ok': True, 'snapshot': snapshot}
elif tool == 'set_value':
    if request.get('element', {}).get('runtimeId') != [4, 5]:
        result = {'ok': False, 'error': 'stale element'}
    else:
        after = dict(snapshot, snapshotId='after', focusedElementId=8,
                     elements=[{'index': 8, 'runtimeId': [4, 5], 'value': request['value']}])
        result = {'ok': True, 'action': {'path': 'accessibility', 'actionName': 'setValue'}, 'snapshot': after}
elif tool == 'click':
    if mode == 'late_gate':
        (directory / 'action-delivered').write_text('delivered')
    if mode == 'reap':
        def stop(_signal, _frame):
            (directory / 'child-reaped').write_text('closed')
            sys.exit(0)
        signal.signal(signal.SIGTERM, stop)
        (directory / 'action-started').write_text('started')
        time.sleep(2)
    result = {'ok': True, 'action': {'path': 'synthetic', 'actionName': 'click'},
              'observationError': {'code': 'window_not_found', 'message': 'window closed'},
              'snapshot': None}
else:
    result = {'ok': False, 'error': 'unexpected tool: ' + tool}
print(json.dumps(result))
`

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    try { await stat(path); return } catch { await new Promise(resolve => setTimeout(resolve, 10)) }
  }
  throw new Error(`fixture did not create ${path}`)
}

describe('Linux desktop script provider', () => {
  let directory: string
  let scriptPath: string
  let provider: DesktopScriptProviderClient

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'javis-provider-test-'))
    scriptPath = join(directory, 'fixture.py')
    await writeFile(scriptPath, fixture)
    provider = new DesktopScriptProviderClient('linux', scriptPath)
  })

  afterAll(async () => {
    await provider?.shutdown()
    await rm(directory, { recursive: true, force: true })
  })

  it('renders the bridge snapshot and resolves a stable element for setValue', async () => {
    const observed = await provider.call('getAppState', { app: 'Demo', session: 'test' }) as any
    expect(observed.snapshot).toMatchObject({
      id: 'before',
      coordinateSpace: 'window',
      focusedElementId: 3,
      window: { id: 7, width: 300, height: 200 }
    })
    expect(observed.snapshot.treeText).toContain('3 text field Value: old')
    expect(observed.screenshotStatus.state).toBe('failed')

    const changed = await provider.call('setValue', {
      app: 'Demo', session: 'test', elementIndex: 3, value: 'new'
    }) as any
    expect(changed.snapshot.id).toBe('after')
    expect(changed.action.verification).toEqual({
      state: 'verified', property: 'value', expected: 'new', actualPreview: 'new'
    })
  })

  it('preserves an action when the follow-up observation fails', async () => {
    const result = await provider.call('click', { app: 'Demo', session: 'test', x: 4, y: 5 }) as any
    expect(result).toMatchObject({
      action: { path: 'synthetic', verification: { state: 'unverified', reason: 'synthetic_input' } },
      observationError: { code: 'window_not_found', message: 'window closed' },
      snapshot: null,
      screenshot: null
    })
  })

  it('rejects an unsupported action before sending it to the bridge', async () => {
    await expect(provider.call('hotkey', { app: 'Demo', key: 'Ctrl+a' })).rejects.toMatchObject({
      code: 'unsupported_capability'
    })
  })

  it('rejects a malformed window target instead of choosing another window', async () => {
    await expect(provider.call('getAppState', { app: 'Demo', windowId: '7' })).rejects.toMatchObject({
      code: 'invalid_argument'
    })
  })

  it('does not launch an action after delivery expires during capability preflight', async () => {
    const lateScript = join(directory, 'late_gate.py')
    await writeFile(lateScript, fixture)
    let allowed = true
    const gated = new DesktopScriptProviderClient('linux', lateScript, null, () => allowed)
    try {
      const action = gated.call('click', { app: 'Demo', session: 'test', x: 4, y: 5 })
      await waitForFile(join(directory, 'handshake-started'))
      allowed = false
      await writeFile(join(directory, 'release-handshake'), '')
      await expect(action).rejects.toMatchObject({ code: 'action_timeout' })
      await expect(stat(join(directory, 'action-delivered'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await gated.shutdown()
    }
  })

  it('reaps an active one-shot action before shutdown returns', async () => {
    const hangingScript = join(directory, 'reap.py')
    await writeFile(hangingScript, fixture)
    const active = new DesktopScriptProviderClient('linux', hangingScript)
    try {
      await active.call('capabilities', {})
      const action = active.call('click', { app: 'Demo', session: 'test', x: 4, y: 5 })
      void action.catch(() => {})
      await waitForFile(join(directory, 'action-started'))
      await active.shutdown()
      expect(await readFile(join(directory, 'child-reaped'), 'utf8')).toBe('closed')
      await expect(action).rejects.toMatchObject({ code: 'action_timeout' })
    } finally {
      await active.shutdown()
    }
  })
})
