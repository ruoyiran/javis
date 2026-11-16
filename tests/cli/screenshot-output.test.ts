import { mkdtempSync, mkdirSync, readFileSync, statSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { prepareCliResult } from '../../src/cli/screenshot-output.js'

const root = mkdtempSync(join(tmpdir(), 'javis-screenshot-test-'))
afterEach(() => rmSync(root, { recursive: true, force: true }))

it('saves a screenshot privately and removes inline image data from JSON', () => {
  const png = Buffer.from('fake-png')
  const result = prepareCliResult({
    snapshot: { id: 'state-1', treeText: '0 window' },
    screenshot: { data: png.toString('base64'), format: 'png', width: 1, height: 1, scale: 1 },
    screenshotStatus: { state: 'captured' }
  }, { directory: root, requestId: 'request-1' })

  expect(result.screenshot?.data).toBeUndefined()
  expect(readFileSync(result.screenshot!.path!)).toEqual(png)
  expect(statSync(result.screenshot!.path!).mode & 0o777).toBe(0o600)
})

it('does not add screenshot fields to capabilities', () => {
  expect(prepareCliResult({ provider: 'javis-helper' }, { directory: root, requestId: 'request-2' }))
    .toEqual({ provider: 'javis-helper' })
})

it('retains inline screenshot data when the temporary directory cannot be created', () => {
  mkdirSync(root, { recursive: true })
  const blocker = join(root, 'blocker')
  writeFileSync(blocker, 'file')
  const input = {
    screenshot: { data: Buffer.from('fake-png').toString('base64'), format: 'png' },
    screenshotStatus: { state: 'captured' }
  }
  const result = prepareCliResult(input, { directory: blocker, requestId: 'request-3' })
  expect(result.screenshot.data).toBe(input.screenshot.data)
  expect(result.screenshot.path).toBeUndefined()
  expect(result.screenshot.storageWarning).toBe('Could not save screenshot to a private temporary file; inline data retained')
  expect(result.screenshotStatus.state).toBe('captured')
})

it('saves to a private directory when process.getuid is unavailable', () => {
  mkdirSync(root, { recursive: true })
  const descriptor = Object.getOwnPropertyDescriptor(process, 'getuid')!
  Object.defineProperty(process, 'getuid', { configurable: true, value: undefined })
  try {
    const result = prepareCliResult({ screenshot: { data: 'aGVsbG8=', format: 'png' } }, { directory: root, requestId: 'windows' })
    expect(result.screenshot.path).toBe(join(root, 'windows-screenshot.png'))
  } finally { Object.defineProperty(process, 'getuid', descriptor) }
})
