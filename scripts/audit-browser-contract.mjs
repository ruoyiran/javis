import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const baseline = JSON.parse(await readFile(join(root, 'docs/browser-parity/orca-729f757-baseline.json'), 'utf8'))
const directory = await mkdtemp(join(tmpdir(), 'javis-browser-contract-'))
try {
  const entry = join(directory, 'contract.cjs')
  await build({
    stdin: { contents: "export { browserCliCommandKeys } from './src/browser/cli/index.ts'; export { browserMethods, publicBrowserMethods, internalBrowserMethods } from './src/browser/contract/index.ts';", resolveDir: root },
    outfile: entry, bundle: true, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'silent'
  })
  const actual = createRequire(entry)(entry)
  const commands = new Set(actual.browserCliCommandKeys)
  const methods = new Set(actual.browserMethods)
  const missingCommands = baseline.cliMappings.filter(row => !commands.has(row.javis.replace(/^javis browser /, ''))).map(row => row.javis)
  const missingMethods = baseline.rpcMethods.filter(row => !methods.has(row.method)).map(row => row.method)
  console.log(JSON.stringify({
    reference: baseline.reference,
    coveredCommands: baseline.cliMappings.length - missingCommands.length,
    coveredMethods: baseline.rpcMethods.length - missingMethods.length,
    publicMethods: actual.publicBrowserMethods.length,
    internalMethods: actual.internalBrowserMethods.length,
    missingCommands,
    missingMethods,
    scope: 'Fixed inventory coverage; behavior is verified separately.'
  }, null, 2))
  if (missingCommands.length || missingMethods.length) process.exitCode = 1
} finally {
  await rm(directory, { recursive: true, force: true })
}
