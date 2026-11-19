import { cp, mkdtemp, mkdir, open, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join, relative, sep } from 'node:path'
import { spawn, execFileSync } from 'node:child_process'

const repository = process.cwd()
const candidate = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const directory = await mkdtemp(join(tmpdir(), 'javis-clean-copy-'))
const copy = join(directory, 'repository')
const artifacts = resolve(process.env.JAVIS_TEST_ARTIFACT_DIRECTORY ?? '.superpowers/sdd/2026-11-19-orca-browser-parity/clean-copy-qa')
await mkdir(artifacts, { recursive: true })
const results = []
try {
  await cp(repository, copy, { recursive: true, verbatimSymlinks: true, filter: path => {
    const parts = relative(repository, path).split(sep)
    return !['.git', 'node_modules', 'dist', 'build', '.superpowers'].includes(parts[0]) && !parts.includes('node_modules') && !(parts[0] === 'native' && parts.includes('.build'))
  } })
  const lock = JSON.parse(await readFile(join(copy, 'package-lock.json'), 'utf8'))
  for (const entry of Object.values(lock.packages)) {
    if (entry.resolved?.startsWith('https:') && new URL(entry.resolved).hostname !== 'registry.npmjs.org') throw new Error('The clean copy has a dependency tarball outside the public registry')
  }
  let audit = ''
  try { audit = execFileSync('rg', ['-n', '--glob', '*.{ts,tsx,js,mjs,cjs}', '(from|import\\(|require\\(|require.resolve\\().*[\x27\x22]@orca/|/Users/[^\x27\x22\\n]*[/\\\\]orca[/\\\\]', 'src', 'scripts', 'native'], { cwd: copy, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
  catch (error) { if (error.status !== 1) throw error }
  if (audit.trim()) throw new Error('The clean copy contains a forbidden production source dependency')
  results.push({ name: 'independence-audit', exitCode: 0, publicRegistry: true, noProductionOrcaRefs: true })
  console.log(JSON.stringify(results.at(-1)))
  const environment = { ...process.env, ORCA_BACKGROUND_LAUNCH: '1', JAVIS_STATE_DIR: join(directory, 'state'), JAVIS_TEST_ARTIFACT_DIRECTORY: artifacts }
  delete environment.npm_config_registry
  environment.NPM_CONFIG_REGISTRY = 'https://registry.npmjs.org'
  delete environment.npm_config_cache
  environment.NPM_CONFIG_CACHE = join(directory, 'npm-cache')
  for (const [name, command, args] of [
    ['npm-ci', 'npm', ['ci']],
    ['typecheck', 'npm', ['run', 'typecheck']],
    ['tests', 'npm', ['test']],
    ['build', 'npm', ['run', 'build']],
    ['packaged-licenses', process.execPath, ['-e', "const fs=require('node:fs');for(const name of ['Javis-MIT.txt','Orca-MIT.txt','shadcn-MIT.txt','SymbolsNerdFontMono-OFL.txt','Electron-LICENSE.txt','Chromium-LICENSES.html','agent-browser-LICENSE.txt']){if(!fs.statSync('dist/browser/licenses/'+name).size)throw Error('Empty packaged notice: '+name)}console.log('Packaged browser notices are present')"]],
    ['hidden-browser', process.execPath, ['tests/browser/runtime/hidden-browser-acceptance.mjs']]
  ]) {
    const log = join(artifacts, `${name}.log`)
    const file = await open(log, 'w')
    const started = Date.now()
    const stageEnvironment = { ...environment }
    if (name === 'tests') delete stageEnvironment.JAVIS_STATE_DIR
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd: copy, env: stageEnvironment, stdio: ['ignore', file.fd, file.fd], windowsHide: true })
      child.once('error', reject); child.once('exit', code => resolve(code))
    })
    await file.close()
    const result = { name, exitCode, elapsedSeconds: Math.round((Date.now() - started) / 1000), log }
    results.push(result); console.log(JSON.stringify(result))
    if (exitCode !== 0) { process.exitCode = 1; break }
  }
  await writeFile(join(artifacts, 'results.json'), JSON.stringify({ candidate, platform: process.platform, node: process.version, copiedOutsideCheckout: true, excludes: ['.git', 'node_modules', 'dist', 'build', '.superpowers', 'native/**/.build'], installationPerformed: false, results }, null, 2))
} finally { await rm(directory, { recursive: true, force: true }) }
