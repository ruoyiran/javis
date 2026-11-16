import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs'
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
  expect(readFileSync(result.screenshot!.path)).toEqual(png)
  expect(statSync(result.screenshot!.path).mode & 0o777).toBe(0o600)
})

it('does not add screenshot fields to capabilities', () => {
  expect(prepareCliResult({ provider: 'javis-helper' }, { directory: root, requestId: 'request-2' }))
    .toEqual({ provider: 'javis-helper' })
})
