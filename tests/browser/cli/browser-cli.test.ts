import { describe, expect, it } from 'vitest'
import { browserInvocationArgs, runBrowserCli } from '../../../src/browser/cli/index.js'

async function invoke(args: string[], result: unknown = {}, stdin?: string) {
  const requests: unknown[] = []
  let stdout = '', stderr = ''
  const code = await runBrowserCli(args, {
    call: async (method, params, target) => { requests.push({ method, params, target }); return result },
    stdout: (value: string) => { stdout += value }, stderr: (value: string) => { stderr += value }, cwd: '/fixture/folder',
    ...(stdin === undefined ? {} : { stdin: async () => stdin })
  })
  return { code, requests, stdout, stderr }
}
describe('browser CLI requests', () => {
  it('fills from stdin while removing only the final secret-reader newline', async () => {
    const output = await invoke(['fill', '--element', '@e3', '--value-stdin', '--page', 'page-7', '--json'], {}, 'line1\nline2\r\n')
    expect(output.code).toBe(0)
    expect(output.requests).toEqual([{ method: 'browser.fill', params: { element: '@e3', value: 'line1\nline2', page: 'page-7' }, target: {} }])
  })
  it('rejects conflicting or empty stdin before delivering a fill', async () => {
    for (const [flags, text] of [[['--value=', '--value-stdin'], 'value'], [['--value-stdin'], '\n']] as const) {
      const output = await invoke(['fill', '--element', '@e3', ...flags, '--page', 'page-7', '--json'], {}, text)
      expect(output.code).toBe(1)
      expect(output.requests).toEqual([])
      expect(JSON.parse(output.stderr).error.code).toBe('invalid_argument')
    }
  })
  it('creates a headless page with explicit server placement', async () => {
    const output = await invoke(['tab', 'create', '--url', 'https://example.com', '--headless', '--context', 'workspace-1', '--json'])
    expect(output.code).toBe(0)
    expect(output.requests).toEqual([{ method: 'browser.tabCreate', params: { url: 'https://example.com', worktree: 'workspace-1', placement: { kind: 'server' } }, target: { context: 'workspace-1' } }])
  })
  it('pins actions to the page and URL while preserving an empty field value', async () => {
    const output = await invoke(['fill', '--element', '@e3', '--value=', '--page', 'page-7', '--expect-url', 'https://example.com/chat', '--json'])
    expect(output.code).toBe(0)
    expect(output.requests).toEqual([{ method: 'browser.fill', params: { element: '@e3', value: '', page: 'page-7', expectUrl: 'https://example.com/chat' }, target: {} }])
    expect(JSON.parse(output.stdout)).toEqual({ ok: true, result: {} })
  })
  it('creates a profile using the source label and imported scope fields', async () => {
    const output = await invoke(['tab', 'profile', 'create', '--label', 'QA', '--scope', 'imported', '--host', 'build-host', '--json'], { profile: { id: 'profile-2', label: 'QA' } })
    expect(output.code).toBe(0)
    expect(output.requests).toEqual([{ method: 'browser.profileCreate', params: { label: 'QA', scope: 'imported' }, target: { host: 'build-host' } }])
  })
  it('rejects unknown and missing valued flags before dispatch', async () => {
    const unknown = await invoke(['click', '--element', '@e3', '--wat', 'bad', '--json'])
    expect(unknown.code).toBe(1)
    expect(unknown.requests).toEqual([])
    expect(JSON.parse(unknown.stderr).error.code).toBe('invalid_argument')
    const missing = await invoke(['fill', '--element', '@e3', '--value', '--json'])
    expect(missing.code).toBe(1)
    expect(missing.requests).toEqual([])
  })
  it('preserves folder context and removes the duplicate identity namespace', async () => {
    const output = await invoke(['snapshot', '--interactive', '--session', 'folder-session', '--json'], { snapshot: 'tree' })
    expect(output.requests).toEqual([{ method: 'browser.snapshot', params: { interactive: true, worktree: 'folder-session' }, target: { context: 'folder-session' } }])
    const identity = await invoke(['identity', 'get', '--json'])
    expect(identity.requests).toEqual([{ method: 'browser.identity.get', params: {}, target: {} }])
  })
  it('preserves browser recovery data in errors', async () => {
    let stderr = ''
    const code = await runBrowserCli(['click', '--element', '@e3', '--page', 'page-7', '--json'], {
      call: async () => { throw Object.assign(new Error('Page changed'), { code: 'browser_url_mismatch', data: { expectedUrl: 'https://example.com', actualUrl: 'https://elsewhere.test' } }) },
      stdout: () => {}, stderr: (value: string) => { stderr += value }, cwd: '/fixture'
    })
    expect(code).toBe(1)
    expect(JSON.parse(stderr)).toEqual({ ok: false, error: { code: 'browser_url_mismatch', message: 'Page changed', data: { expectedUrl: 'https://example.com', actualUrl: 'https://elsewhere.test' } } })
  })
})

it('keeps explicit empty browser storage and authentication values', async () => {
  expect((await invoke(['storage', 'local', 'set', '--key', 'draft', '--value=', '--page', 'page-7', '--json'])).requests).toEqual([
    { method: 'browser.storage.local.set', params: { key: 'draft', value: '', page: 'page-7' }, target: {} }
  ])
  expect((await invoke(['set', 'credentials', '--user', 'alice', '--pass=', '--page', 'page-7', '--json'])).requests).toEqual([
    { method: 'browser.setCredentials', params: { user: 'alice', pass: '', page: 'page-7' }, target: {} }
  ])
})
it('keeps browser profile selection and split direction in page creation', async () => {
  const result = await invoke(['tab', 'create', '--profile', 'profile-2', '--url', 'https://example.com', '--split', 'down', '--context', 'workspace-1', '--json'])
  expect(result.requests).toEqual([{ method: 'browser.tabCreate', params: { url: 'https://example.com', worktree: 'workspace-1', profileId: 'profile-2', split: 'down' }, target: { context: 'workspace-1' } }])
})
it('refuses an empty URL guard before the action', async () => {
  const result = await invoke(['click', '--element', '@e3', '--expect-url=', '--json'])
  expect(result.code).toBe(1)
  expect(result.requests).toEqual([])
  expect(JSON.parse(result.stderr).error.message).toBe('Missing value for --expect-url')
})
it('rejects competing Javis context selectors before a browser action', async () => {
  const result = await invoke(['click', '--element', '@e3', '--session', 'session-1', '--worktree', 'folder-2', '--json'])
  expect(result.code).toBe(1)
  expect(result.requests).toEqual([])
  expect(JSON.parse(result.stderr).error.code).toBe('invalid_argument')
})

it('routes the browser namespace after global selectors without consuming browser-valued flags', () => {
  expect(browserInvocationArgs(['--json', '--host', 'build-host', 'browser', 'fill', '--value=', '--element', '@e3'])).toEqual(['--json', '--host', 'build-host', 'fill', '--value=', '--element', '@e3'])
  expect(browserInvocationArgs(['--host', 'browser', 'computer', 'click', '--app', 'TextEdit'])).toBeNull()
  expect(browserInvocationArgs(['click', '--app', 'browser'])).toBeNull()
  expect(browserInvocationArgs(['--worktree=browser', 'browser', 'snapshot', '--interactive'])).toEqual(['--worktree=browser', 'snapshot', '--interactive'])
})

it('leaves tab queries and pinned actions unscoped for the worktree all selector', async () => {
  const query = await invoke(['tab', 'list', '--worktree', 'all', '--json'])
  expect(query.code).toBe(0)
  expect(query.requests).toEqual([{ method: 'browser.tabList', params: {}, target: {} }])
  const action = await invoke(['click', '--page', 'page-7', '--element', '@e3', '--worktree', 'all', '--host', 'build-host', '--json'])
  expect(action.code).toBe(0)
  expect(action.requests).toEqual([{ method: 'browser.click', params: { page: 'page-7', element: '@e3' }, target: { host: 'build-host' } }])
})
it('preserves an explicit Javis namespace named all on a pinned page', async () => {
  const context = await invoke(['click', '--page', 'page-7', '--element', '@e3', '--context', 'all', '--json'])
  expect(context.requests).toEqual([{ method: 'browser.click', params: { page: 'page-7', element: '@e3', worktree: 'all' }, target: { context: 'all' } }])
  const session = await invoke(['tab', 'list', '--session', 'all', '--json'])
  expect(session.requests).toEqual([{ method: 'browser.tabList', params: { worktree: 'all' }, target: { context: 'all' } }])
})
it('rejects unknown help paths without dispatching a browser request', async () => {
  const output = await invoke(['does-not-exist', '--help'])
  expect(output.code).toBe(1)
  expect(output.requests).toEqual([])
  expect(JSON.parse(output.stderr).error.code).toBe('invalid_argument')
})
it('handles bare browser groups and lifecycle help without runtime calls', async () => {
  for (const args of [['tab'], ['open', '--help'], ['status', '--help'], ['help', 'tab', 'profile']]) {
    const output = await invoke(args)
    expect(output.code).toBe(0)
    expect(output.requests).toEqual([])
    expect(output.stderr).toBe('')
  }
})
