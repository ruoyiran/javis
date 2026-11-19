import { cp, mkdtemp, mkdir, open, rm, writeFile } from 'node:fs/promises'
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
    return !parts.some(part => ['.git', 'node_modules', 'dist', 'build', '.superpowers'].includes(part)) && !(parts[0] === 'native' && parts.includes('.build'))
  } })
  const environment = { ...process.env, ORCA_BACKGROUND_LAUNCH: '1', JAVIS_STATE_DIR: join(directory, 'state'), JAVIS_TEST_ARTIFACT_DIRECTORY: artifacts }
  for (const [name, command, args] of [
    ['npm-ci', 'npm', ['ci']],
    ['typecheck', 'npm', ['run', 'typecheck']],
    ['tests', 'npm', ['test']],
    ['build', 'npm', ['run', 'build']],
    ['packaged-licenses', process.execPath, ['-e', "const fs=require('node:fs');for(const name of ['Javis-MIT.txt','Orca-MIT.txt','SymbolsNerdFontMono-OFL.txt','Electron-LICENSE.txt','Chromium-LICENSES.html','agent-browser-LICENSE.txt']){if(!fs.statSync('dist/browser/licenses/'+name).size)throw Error('Empty packaged notice: '+name)}console.log('Packaged browser notices are present')"]],
    ['hidden-browser', process.execPath, ['tests/browser/runtime/hidden-browser-acceptance.mjs']]
  ]) {
    const log = join(artifacts, `${name}.log`)
    const file = await open(log, 'w')
    const started = Date.now()
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd: copy, env: environment, stdio: ['ignore', file.fd, file.fd], windowsHide: true })
      child.once('error', reject); child.once('exit', code => resolve(code))
    })
    await file.close()
    const result = { name, exitCode, elapsedSeconds: Math.round((Date.now() - started) / 1000), log }
    results.push(result); console.log(JSON.stringify(result))
    if (exitCode !== 0) { process.exitCode = 1; break }
  }
  await writeFile(join(artifacts, 'results.json'), JSON.stringify({ candidate, platform: process.platform, node: process.version, copiedOutsideCheckout: true, excludes: ['.git', 'node_modules', 'dist', 'build', '.superpowers', 'native/**/.build'], installationPerformed: false, results }, null, 2))
} finally { await rm(directory, { recursive: true, force: true }) }
