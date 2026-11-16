import { expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execBridge } from '../../src/runtime/desktop-script-provider/bridge.js'

it.skipIf(process.platform === 'win32')('reaps a timed-out one-shot bridge before returning action_timeout', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'javis-bridge-test-'))
  const scriptPath = join(directory, 'wait.py')
  const operationPath = join(directory, 'request.json')
  const reapedPath = join(directory, 'reaped')
  await writeFile(scriptPath, `import pathlib, signal, sys, time
def stop(_signal, _frame):
    time.sleep(0.05)
    pathlib.Path(${JSON.stringify(reapedPath)}).write_text('closed')
    sys.exit(0)
signal.signal(signal.SIGTERM, stop)
while True:
    time.sleep(1)
`)
  try {
    await expect(execBridge('linux', scriptPath, operationPath, 750)).rejects.toMatchObject({
      code: 'action_timeout'
    })
    expect(await readFile(reapedPath, 'utf8')).toBe('closed')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
