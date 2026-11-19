import { browserMethods } from '../contract/index.js'
import { callBrowser } from '../runtime/browser-process.js'
import { isAbsolute, join, resolve, relative, sep } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { daemonEndpoint } from '../../runtime/daemon-endpoint.js'
import { JavisError, runtimeErrorDetails } from '../../runtime/error.js'
import { BrowserWorkspaceFiles } from '../main/workspace-files.js'
import { readAuthorizedDocPreviewFile, readAuthorizedDocPreviewFileChunk, type DocPreviewFileTarget } from '../source/shared/document-preview/doc-preview-file-access.js'
import type { BrowserStream } from './framed-channel.js'

export type BrowserHostRequest = { target: string; method: string; params: Record<string, unknown> }
const connections = new Map<string, Promise<BrowserStream>>()

function root(context: string): string {
  const selector = context.replace(/^(?:cwd:|id:)/, '')
  return isAbsolute(selector) ? selector : join(daemonEndpoint(process.platform, homedir(), process.env).directory, 'browser', 'workspaces', encodeURIComponent(selector))
}
const files = new BrowserWorkspaceFiles(root)
function text(value: unknown): string { if (typeof value !== 'string') throw new JavisError('invalid_argument', 'Browser host path must be a string'); return value }
function number(value: unknown): number { if (!Number.isSafeInteger(value) || (value as number) < 0) throw new JavisError('invalid_argument', 'Invalid browser file range'); return value as number }
function previewTarget(params: Record<string, unknown>, boundaryPath: string): DocPreviewFileTarget {
  const scoped = (value: unknown) => {
    const name = text(value)
    if (isAbsolute(name)) throw new JavisError('access_denied', 'Document path is outside its context')
    const path = resolve(boundaryPath, name)
    const diff = relative(boundaryPath, path)
    if (diff === '..' || diff.startsWith(`..${sep}`) || isAbsolute(diff)) throw new JavisError('access_denied', 'Document path is outside its context')
    return path
  }
  if (!Array.isArray(params.authorizedRootRelativePaths)) throw new JavisError('invalid_argument', 'Document authority roots are required')
  return { boundaryPath, entryPath: scoped(params.entryRelativePath), targetPath: scoped(params.relativePath), implicitRootPath: params.implicitRootRelativePath === null ? null : scoped(params.implicitRootRelativePath), authorizedRootPaths: params.authorizedRootRelativePaths.map(scoped) }
}

export async function dispatchBrowserHostRequest(request: BrowserHostRequest): Promise<{ ok: true; result: unknown } | { ok: false; error: { code: string; message: string; data?: unknown } }> {
  try {
    const { target, method, params } = request
    if (target !== 'local') {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/.test(target)) throw new JavisError('invalid_argument', 'Browser execution host must be a registered SSH alias')
      if (!connections.has(target)) {
        const { connectRemoteJavisBrowserStream } = await import('../../runtime/remote-stdio.js')
        const pending = connectRemoteJavisBrowserStream(target, { identity: { pairedDeviceId: `host:${target}`, clientKind: 'runtime' }, onEvent: () => {}, onClose: () => connections.delete(target) })
        connections.set(target, pending)
        void pending.catch(() => connections.delete(target))
      }
      const result = await (await connections.get(target)!).call('__browserHost', { method, params })
      return { ok: true, result }
    }
    if ((browserMethods as readonly string[]).includes(method) || method === 'browser.status') return { ok: true, result: await callBrowser(method, params) }
    const context = text(params.worktree ?? params.context ?? 'default')
    await mkdir(root(context), { recursive: true, mode: 0o700 })
    let result: unknown
    switch (method) {
      case 'files.readDocPreview': result = await readAuthorizedDocPreviewFile({ ...previewTarget(params, root(context)), maxTextBytes: 10 * 1024 * 1024, maxBinaryBytes: 20 * 1024 * 1024 }); break
      case 'files.readDocPreviewChunk': result = await readAuthorizedDocPreviewFileChunk(previewTarget(params, root(context)), number(params.offset), number(params.length)); break
      case 'files.readChunk': result = await files.readFileExplorerChunk(context, text(params.relativePath), number(params.offset), number(params.length)); break
      case 'files.writeBase64Chunk':
        if (typeof params.contentBase64 !== 'string' || params.contentBase64.length > 1024 * 1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(params.contentBase64)) throw new JavisError('invalid_argument', 'Invalid browser file chunk')
        result = await files.writeFileExplorerFileBase64Chunk(context, text(params.relativePath), text(params.contentBase64), params.append === true); break
      case 'files.commitUpload': result = await files.commitFileExplorerUpload(context, text(params.tempRelativePath), text(params.finalRelativePath ?? params.relativePath)); break
      case 'files.delete': result = await files.deleteFileExplorerPath(context, text(params.relativePath), params.recursive === true); break
      case 'files.createDir':
      case 'files.mkdir': result = await files.createFileExplorerDir(context, text(params.relativePath)); break
      case 'files.stat': result = await files.statRuntimeFile(context, text(params.relativePath)); break
      default: throw new JavisError('invalid_argument', `Unknown browser host method: ${method}`)
    }
    return { ok: true, result }
  } catch (error) { return { ok: false, error: runtimeErrorDetails(error) } }
}

export async function closeBrowserHostConnections(): Promise<void> {
  const pending = [...connections.values()]; connections.clear()
  await Promise.allSettled(pending.map(async connection => (await connection).close()))
}
