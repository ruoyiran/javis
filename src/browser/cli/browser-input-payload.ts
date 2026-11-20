import { RuntimeClientError } from '../../runtime/error.js'
import { getRequiredStringFlagAllowingEmpty } from './flags.js'

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) throw new RuntimeClientError('invalid_argument', 'stdin payload requested but stdin is a TTY')
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  return Buffer.concat(chunks).toString('utf8')
}

export async function readBrowserValue(flags: Map<string, string | boolean>, stdin = readStdin): Promise<string> {
  if (!flags.has('value-stdin')) return getRequiredStringFlagAllowingEmpty(flags, 'value')
  if (flags.has('value')) throw new RuntimeClientError('invalid_argument', 'Use either --value or --value-stdin, not both')
  const value = (await stdin()).replace(/\r?\n$/, '')
  if (value.length === 0) throw new RuntimeClientError('invalid_argument', 'Missing value from stdin')
  return value
}
