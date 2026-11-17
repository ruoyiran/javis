import { expect, it } from 'vitest'
import { runCli } from '../../src/cli/run-cli.js'
import { parseCall } from '../../src/cli/parse-call.js'

const snapshot = {
  id: 'snapshot-2', app: { name: 'Test Editor', bundleId: 'org.test.Editor', pid: 25 },
  window: { id: 44, index: 2, title: 'Draft', width: 600, height: 400, x: 10, y: 20 },
  coordinateSpace: 'window', elementCount: 3, focusedElementId: 7,
  truncation: { truncated: true, maxNodes: 100, maxDepth: 20 },
  treeText: '0 window Draft\n\t7 text-field Name\n\t9 button Save'
}

async function text(argv: string[], result: unknown): Promise<string> {
  const lines: string[] = []
  expect(await runCli(argv, { call: async () => result, stdout: line => lines.push(line), stderr: () => {} })).toBe(0)
  return lines[0]
}

it('prints the provider and actual capability groups as readable text', async () => {
  const output = await text(['capabilities'], {
    platform: 'linux', provider: 'javis-atspi', providerVersion: '1', protocolVersion: 1,
    supports: {
      apps: { list: true, bundleIds: false, pids: true },
      windows: { list: true, targetById: false, targetByIndex: true, focus: false, moveResize: false },
      observation: { screenshot: false, annotatedScreenshot: false, elementFrames: true, ocr: false },
      actions: { click: true, scroll: true, hotkey: false, typeText: false, pressKey: false, pasteText: false, drag: false, setValue: false, performAction: false },
      surfaces: { menus: false, dialogs: true, dock: false, menubar: false },
      input: { background: false }
    }
  })
  expect(output).toContain('javis-atspi (linux, protocol 1)')
  expect(output).toContain('Windows: list=true targetById=false targetByIndex=true')
  expect(output).toContain('Actions: click, scroll')
  expect(output).toContain('Input: background=false')
})

it('prints app identifiers and empty app lists', async () => {
  expect(await text(['list-apps'], { apps: [{ name: 'Test Editor', bundleId: 'org.test.Editor', pid: 25, isRunning: true, lastUsedAt: null, useCount: null }] })).toBe('Test Editor  pid:25  org.test.Editor')
  expect(await text(['list-apps'], { apps: [] })).toBe('No apps found.')
})

it('prints window coordinates, screens and minimized state', async () => {
  expect(await text(['list-windows', '--app', 'Test Editor'], {
    app: snapshot.app, windows: [{ ...snapshot.window, app: snapshot.app, screenIndex: 1, isMinimized: true, isOffscreen: true }]
  })).toBe('[2] id:44 "Draft" (600x400 @ 10,20) screen:1 minimized,offscreen')
  expect(await text(['list-windows', '--app', 'Test Editor'], { app: snapshot.app, windows: [] })).toBe('No windows found for Test Editor.')
})

it('prints snapshot identity, focus, truncation and screenshot status with the tree', async () => {
  const output = await text(['get-app-state', '--app', 'Test Editor'], {
    sessionId: 'session-2', snapshot, screenshot: null, screenshotStatus: { state: 'skipped', reason: 'no_screenshot_flag' }
  })
  expect(output).toContain('Session: session-2')
  expect(output).toContain('Test Editor (pid 25, org.test.Editor)')
  expect(output).toContain('Window: id:44 index:2 "Draft" (600x400 @ 10,20)')
  expect(output).toContain('Visible elements: 3  Focused: #7  Coordinates: window')
  expect(output).toContain('Truncated: yes (max nodes 100, max depth 20)')
  expect(output).toContain('Screenshot skipped (--no-screenshot)')
  expect(output).toContain(snapshot.treeText)
})

it('reports captured image scale and private file location without base64', async () => {
  const output = await text(['get-app-state', '--app', 'Test Editor'], {
    sessionId: 'session-2', snapshot,
    screenshot: { format: 'png', data: 'aGVsbG8=', width: 1200, height: 800, scale: 2 },
    screenshotStatus: { state: 'captured', metadata: { engine: 'screenCaptureKit' } }
  })
  expect(output).toContain('Screenshot captured (png, saved to ')
  expect(output).toContain('1200x800, scale 2; coordinate x/y = screenshot pixels / 2')
  expect(output).toContain('screenCaptureKit')
  expect(output).not.toContain('aGVsbG8=')
})

it('labels verified actions and builds a quoted observation command for the same target', async () => {
  const output = await text(['set-value', '--app', 'Test Editor', '--host', 'devbox', '--worktree', 'feature a', '--window-id', '44', '--element-index', '7', '--value', 'private expected'], {
    sessionId: 'session-2', snapshot, screenshot: null, screenshotStatus: { state: 'skipped', reason: 'no_screenshot_flag' },
    action: { path: 'accessibility', delivery: 'background', verification: { state: 'verified', property: 'value', expected: 'private expected', actualPreview: 'private expected' } }
  })
  expect(output).toContain('Set Value completed via accessibility, verified value')
  expect(output).toContain('Delivery: background')
  expect(output).toContain('3 visible elements in current window')
  expect(output).toContain("javis computer get-app-state --app org.test.Editor --host devbox --worktree 'feature a' --window-id 44")
  expect(output).not.toContain('private expected')
})

it('marks synthetic input attempted and reports a failed screenshot', async () => {
  const output = await text(['press-key', '--app', 'Test Editor', '--session', 'session-2', '--key', 'Return'], {
    sessionId: 'session-2', snapshot, screenshot: null, screenshotStatus: { state: 'failed', code: 'screenshot_failed', message: 'capture unavailable' },
    action: { path: 'synthetic', delivery: 'foreground', verification: { state: 'unverified', reason: 'synthetic_input' } }
  })
  expect(output).toContain('Press Key attempted via synthetic, unverified (synthetic input)')
  expect(output).toContain('Delivery: foreground')
  expect(output).toContain('Screenshot failed (screenshot_failed): capture unavailable')
  expect(output).toContain('--session session-2 --window-id 44')
  expect(output).toContain('before assuming it worked')
})

it('drops a changed window target from the follow-up observation command', async () => {
  const output = await text(['click', '--app', 'Test Editor', '--host', 'devbox', '--session', 'session-2', '--window-id', '99', '--element-index', '9'], {
    sessionId: 'session-2', snapshot: null, screenshot: null,
    action: { path: 'accessibility', delivery: 'background', targetWindowId: 99, verification: { state: 'unverified', reason: 'window_changed' } },
    observationError: { code: 'window_not_found', message: 'closed' }
  })
  expect(output).toContain('Do not retry the action')
  expect(output).toContain("javis computer get-app-state --app 'Test Editor' --host devbox --session session-2")
  expect(output).not.toContain('--window-id 99')
  expect(output).not.toContain('visible elements')
})

it.each([
  ['window_not_found', '--window-id', '99'],
  ['window_stale', '--window-index', '2']
])('drops a stale selector after %s even when set-value verification succeeded', async (code, flag, value) => {
  const output = await text(['set-value', '--app', 'Test Editor', '--host', 'devbox', '--session', 'session-2', flag, value, '--element-index', '7', '--value', 'sample'], {
    sessionId: 'session-2', snapshot: null, screenshot: null,
    action: { path: 'accessibility', delivery: 'background', targetWindowId: 99, targetWindowIndex: 2, verification: { state: 'verified', property: 'value' } },
    observationError: { code, message: 'target unavailable' }
  })
  expect(output).toContain('Action delivered (background)')
  expect(output).toContain('Do not retry the action')
  expect(output).toContain("javis computer get-app-state --app 'Test Editor' --host devbox --session session-2")
  expect(output).not.toContain('--window-id')
  expect(output).not.toContain('--window-index')
})

it.each([
  ['app', '--Editor'],
  ['session', '--session-value'],
  ['worktree', '--namespace']
])('round-trips a follow-up command with a leading-dash %s value', async (flag, value) => {
  const app = flag === 'app' ? value : 'Editor'
  const sessionId = flag === 'session' ? value : 'session-2'
  const context = flag === 'worktree' ? [`--worktree=${value}`] : [`--session=${sessionId}`]
  const output = await text(['click', `--app=${app}`, ...context, '--element-index=9'], {
    sessionId, snapshot: { ...snapshot, app: { ...snapshot.app, name: app, bundleId: null } },
    screenshot: null, screenshotStatus: { state: 'skipped', reason: 'no_screenshot_flag' },
    action: { path: 'accessibility', delivery: 'background', verification: { state: 'unverified', reason: 'accessibility_action_unasserted' } }
  })
  const followUp = output.match(/`(javis computer get-app-state [^`]+)`/)?.[1]
  expect(followUp).toBeDefined()
  const parsed = parseCall(followUp!.split(' ').slice(1))
  expect(parsed.method).toBe('getAppState')
  expect(parsed.params.app).toBe(app)
  expect(flag === 'worktree' ? parsed.params.worktree : parsed.params.sessionId).toBe(flag === 'worktree' ? value : sessionId)
})
