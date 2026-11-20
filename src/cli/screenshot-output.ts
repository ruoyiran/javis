import { chmodSync, lstatSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ttlMs = 24 * 60 * 60 * 1000

type Screenshot = {
  data?: string
  format: string
  path?: string
  expiresAt?: string
  dataOmitted?: boolean
  [key: string]: unknown
}

export function prepareCliResult<T extends { screenshot: Screenshot & { data: string } }>(
  input: T,
  options: { directory?: string; requestId: string }
): Omit<T, 'screenshot'> & { screenshot: Screenshot }
export function prepareCliResult<T extends object>(input: T, options: { directory?: string; requestId: string }): T
export function prepareCliResult(input: object, options: { directory?: string; requestId: string }): object {
  const screenshot = (input as { screenshot?: Screenshot | null }).screenshot
  if (!('screenshot' in input) || screenshot === null) return input
  if (!screenshot?.data) return { ...input, screenshot: null }
  try {
    const directory = options.directory ?? join(tmpdir(), 'javis-computer-use')
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const info = lstatSync(directory)
    if (!info.isDirectory() || info.isSymbolicLink() || (process.getuid && info.uid !== process.getuid())) {
      throw new Error('Unsafe screenshot directory')
    }
    chmodSync(directory, 0o700)
    const cutoff = Date.now() - ttlMs
    for (const name of readdirSync(directory)) {
      if (!/-screenshot\.(?:png|jpg)$/.test(name)) continue
      const path = join(directory, name)
      try { if (statSync(path).mtimeMs < cutoff) rmSync(path) } catch { /* raced file */ }
    }
    const stem = options.requestId.replaceAll(/[^a-zA-Z0-9._-]/g, '_')
    const path = join(directory, `${stem}-screenshot.${screenshot.format === 'jpeg' ? 'jpg' : 'png'}`)
    writeFileSync(path, Buffer.from(screenshot.data, 'base64'), { flag: 'wx', mode: 0o600 })
    return {
      ...input,
      screenshot: {
        ...screenshot,
        data: undefined,
        path,
        dataOmitted: true,
        expiresAt: new Date(Date.now() + ttlMs).toISOString()
      }
    }
  } catch {
    return {
      ...input,
      screenshot: {
        ...screenshot,
        storageWarning: 'Could not save screenshot to a private temporary file; inline data retained'
      }
    }
  }
}
