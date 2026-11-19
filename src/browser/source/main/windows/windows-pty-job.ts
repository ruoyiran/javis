import { createRequire } from 'node:module'
const requireFromMain = createRequire(__filename)
export function assignHostProcessToStrictKillOnCloseJob(): boolean {
  if (process.platform !== 'win32') return false
  try {
    const { loadNativeModule } = requireFromMain('node-pty/lib/utils')
    const native = loadNativeModule('conpty').module
    return typeof native.assignCurrentProcessToStrictJob === 'function' && native.assignCurrentProcessToStrictJob()
  } catch { return false }
}
