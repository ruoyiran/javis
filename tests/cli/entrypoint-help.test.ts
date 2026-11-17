import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { afterAll, beforeAll, expect, it } from 'vitest'

let directory: string
let entry: string
beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'javis-cli-help-test-'))
  entry = join(directory, 'cli.cjs')
  await build({ entryPoints: [fileURLToPath(new URL('../../src/cli.ts', import.meta.url))], outfile: entry, bundle: true, platform: 'node', target: 'node22', format: 'cjs', loader: { '.svg': 'text' }, logLevel: 'silent' })
})
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }) })

it.each([
  'capabilities', 'list-apps', 'permissions', 'list-windows', 'get-app-state', 'click',
  'perform-secondary-action', 'scroll', 'drag', 'type-text', 'press-key', 'hotkey',
  'paste-text', 'set-value'
])('prints bundled computer %s help without launching a provider', command => {
  const output = execFileSync(process.execPath, [entry, 'computer', command, '--help'], { encoding: 'utf8', timeout: 5000 })
  expect(output).toContain(`Usage: javis computer ${command}`)
})

it('routes bundled help command paths through the computer adapter', () => {
  for (const argv of [['help', 'computer', 'drag'], ['--help', 'computer', 'drag'], ['computer', 'help', 'drag']]) {
    expect(execFileSync(process.execPath, [entry, ...argv], { encoding: 'utf8', timeout: 5000 })).toContain('--from-element-index')
  }
})

it('keeps flat command help available in the bundled CLI', () => {
  expect(execFileSync(process.execPath, [entry, 'click', '--help'], { encoding: 'utf8', timeout: 5000 })).toContain('Usage: javis click --app')
})

it('reports the package release version from the bundled CLI', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  expect(execFileSync(process.execPath, [entry, '--version'], { encoding: 'utf8', timeout: 5000 })).toBe(`${manifest.version}\n`)
})
