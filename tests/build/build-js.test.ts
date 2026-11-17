import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'

const buildScript = fileURLToPath(new URL('../../scripts/build-js.mjs', import.meta.url))
const logo = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M1 2L3 4"/></svg>\n'
const branding = {
  'javis.svg': Buffer.from(logo),
  'javis-mark.svg': Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>'),
  'javis.png': Buffer.from([137, 80, 78, 71, 1]),
  'Javis.icns': Buffer.from([105, 99, 110, 115, 2]),
  'Javis.ico': Buffer.from([0, 0, 1, 0, 3]),
  'apple-touch-icon.png': Buffer.from([137, 80, 78, 71, 4]),
  'brand.json': Buffer.from('{"name":"Javis","concept":"test"}\n')
}
const fixtures: string[] = []

afterEach(() => {
  for (const directory of fixtures.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function fixture(entry: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'javis-build-test-'))
  fixtures.push(directory)
  for (const path of ['src', 'assets/branding', 'native/javis-linux', 'native/javis-windows', 'skills/javis']) {
    mkdirSync(join(directory, path), { recursive: true })
  }
  writeFileSync(join(directory, 'src/cli.ts'), entry)
  for (const [file, contents] of Object.entries(branding)) writeFileSync(join(directory, 'assets/branding', file), contents)
  writeFileSync(join(directory, 'native/javis-linux/runtime.py'), '# Linux provider fixture\n')
  writeFileSync(join(directory, 'native/javis-windows/runtime.ps1'), '# Windows provider fixture\n')
  writeFileSync(join(directory, 'skills/javis/SKILL.md'), '# Javis skill fixture\n')
  return directory
}

function buildFixture(directory: string): void {
  const result = spawnSync(process.execPath, [buildScript], { cwd: directory, encoding: 'utf8', timeout: 10_000 })
  expect(result.error).toBeUndefined()
  expect(result.status, result.stderr).toBe(0)
}

it('includes every canonical branding asset in the installer dist directory', () => {
  const directory = fixture('console.log("Javis build fixture")')
  buildFixture(directory)
  const output = join(directory, 'dist/branding')
  expect(existsSync(output)).toBe(true)
  expect(readdirSync(output).sort()).toEqual([
    'Javis.icns', 'Javis.ico', 'apple-touch-icon.png', 'brand.json', 'javis-mark.svg', 'javis.png', 'javis.svg'
  ])
  for (const [file, contents] of Object.entries(branding)) expect(readFileSync(join(output, file))).toEqual(contents)
})

it('bundles SVG raw imports as the original text without runtime asset lookup', () => {
  const directory = fixture('import logo from "../assets/branding/javis.svg?raw"; console.log(JSON.stringify(logo))')
  buildFixture(directory)
  rmSync(join(directory, 'assets'), { recursive: true })
  const result = spawnSync(process.execPath, [join(directory, 'dist/cli.cjs')], { cwd: directory, encoding: 'utf8', timeout: 5000 })
  expect(result.status, result.stderr).toBe(0)
  expect(JSON.parse(result.stdout)).toBe(logo)
})
