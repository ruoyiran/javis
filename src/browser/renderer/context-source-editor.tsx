import { useConfirmationDialog } from '../source/renderer/src/components/confirmation-dialog-context'
import { useEffect, useState, useRef } from 'react'
import MonacoEditor from '../source/renderer/src/components/editor/MonacoEditor'
import { Button } from '../source/renderer/src/components/ui/button'
import { useAppStore } from '../source/renderer/src/store'
import { javisContext, javisContextHost } from '../source/renderer/src/store/workspaces/javis-context-catalog'
import { getRelativePathInsideRoot } from '../source/renderer/src/lib/path'
import { browserBridge } from './workspace-bootstrap'
import type { OpenFile } from '../source/renderer/src/store/slices/editor/types/open-file'
function base64(bytes: Uint8Array): string { let result = ''; for (const byte of bytes) result += String.fromCharCode(byte); return btoa(result) }
async function fileCall(file: OpenFile, method: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const context = javisContext(file.worktreeId), host = javisContextHost(file.worktreeId)
  if (!context?.root || !host) throw new Error('This file has no available context owner')
  const relativePath = getRelativePathInsideRoot(file.filePath, context.root)
  if (relativePath === null) throw new Error('This file is outside its granted context')
  const target = host === 'local' ? host : host.replace(/^(runtime|ssh):/, '')
  return await browserBridge().call('browser.host.call', { target, method, params: { worktree: context.id, relativePath, ...extra } }) as Record<string, unknown>
}
export function ContextSourceEditor({ file, active, viewId }: { file: OpenFile; active: boolean; viewId?:string }): React.JSX.Element {
  const confirm = useConfirmationDialog()
  const saveInFlight=useRef(false), pendingSave=useRef<string|null>(null)
  const autoSave=useAppStore((state)=>state.settings?.editorAutoSave), autoSaveDelay=useAppStore((state)=>state.settings?.editorAutoSaveDelayMs??1200)
  const ownerSignature = useRef(JSON.stringify({owner:javisContext(file.worktreeId)?.owner,root:javisContext(file.worktreeId)?.root}))
  const ownedCall = (method: string, extra: Record<string,unknown> = {}) => { const now=javisContext(file.worktreeId); if (ownerSignature.current!==JSON.stringify({owner:now?.owner,root:now?.root})) return Promise.reject(new Error('The file context owner changed; reopen the source before editing')); return fileCall(file,method,extra) }
  const draft = useAppStore((state) => state.editorDrafts[file.id]), [content, setContent] = useState<string | null>(draft ?? null), [error, setError] = useState<string | null>(null), [saving, setSaving] = useState(false)
  const [signature, setSignature] = useState<string | null>(null)
  const load = async (discardDraft=false): Promise<void> => {
    try { const stat = await ownedCall('files.stat'); const chunks: Uint8Array[] = []; let offset = 0
      for (;;) { const part = await ownedCall('files.readChunk', { offset, length: 512 * 1024 }); const text = atob(String(part.contentBase64)); const bytes = Uint8Array.from(text, (char) => char.charCodeAt(0)); chunks.push(bytes); offset += bytes.length; if (part.eof) break; if (!bytes.length || offset > 16 * 1024 * 1024) throw new Error('The source file exceeds the editor limit') }
      const bytes = new Uint8Array(offset); let cursor = 0; for (const part of chunks) { bytes.set(part, cursor); cursor += part.length }
      const currentSignature=JSON.stringify(stat)
      if(discardDraft)useAppStore.getState().clearEditorDraft(file.id)
      setContent(discardDraft ? new TextDecoder().decode(bytes) : draft ?? new TextDecoder().decode(bytes))
      setSignature(!discardDraft && draft!==undefined && file.lastKnownDiskSignature ? file.lastKnownDiskSignature : currentSignature)
      setError(!discardDraft && draft!==undefined && file.lastKnownDiskSignature && file.lastKnownDiskSignature!==currentSignature ? 'The file changed on its host while closed. Reload before saving.' : null)
      if(discardDraft || draft===undefined)useAppStore.setState((state)=>({openFiles:state.openFiles.map((entry)=>entry.id===file.id?{...entry,lastKnownDiskSignature:currentSignature,...(discardDraft?{isDirty:false}:{})}:entry)}))
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'The source file could not be loaded') }
  }
  useEffect(() => { void load() }, [file.id, file.worktreeId])
  const save = async (text: string): Promise<void> => {
    if (file.readOnly) return
    if(saveInFlight.current){pendingSave.current=text;return}
    saveInFlight.current=true
    let succeeded=false
    setSaving(true)
    try {
      if (signature !== JSON.stringify(await ownedCall('files.stat'))) throw new Error('The file changed on its host. Reload before saving.')
      const finalRelativePath=getRelativePathInsideRoot(file.filePath,javisContext(file.worktreeId)?.root??null)
      if(finalRelativePath===null)throw new Error('The file workspace is unavailable')
      const bytes = new TextEncoder().encode(text), tempRelativePath = `${finalRelativePath}.javis-${crypto.randomUUID()}.tmp`
      for (let offset = 0; offset < bytes.length || offset === 0; offset += 512 * 1024) await ownedCall('files.writeBase64Chunk', { relativePath: tempRelativePath, contentBase64: base64(bytes.subarray(offset, offset + 512 * 1024)), append: offset > 0 })
      await ownedCall('files.commitUpload', { tempRelativePath, finalRelativePath })
      const nextSignature=JSON.stringify(await ownedCall('files.stat'));setSignature(nextSignature)
      const currentDraft=useAppStore.getState().editorDrafts[file.id]
      const unchanged=currentDraft===undefined || currentDraft===text
      if(unchanged)useAppStore.getState().clearEditorDraft(file.id)
      useAppStore.setState((state)=>({openFiles:state.openFiles.map((entry)=>entry.id===file.id?{...entry,isDirty:!unchanged,lastKnownDiskSignature:nextSignature}:entry)}));setError(null);succeeded=true
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'The source file could not be saved') }
    finally { saveInFlight.current=false;setSaving(false);const queued=pendingSave.current;pendingSave.current=null;if(succeeded && queued!==null && queued!==text)void save(queued) }
  }
  useEffect(()=>{if(!autoSave || draft===undefined || file.readOnly)return;const timer=setTimeout(()=>void save(draft),autoSaveDelay);return()=>clearTimeout(timer)},[draft,autoSave,autoSaveDelay,file.readOnly])
  return <div className={active ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}><div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3 text-xs"><span className="flex-1 truncate font-mono">{file.relativePath}</span>{error && <span role="alert" className="text-destructive">{error}</span>}<Button size="sm" variant="ghost" disabled={saving} onClick={() => void (async()=>{if(!file.isDirty || await confirm({title:'Discard unsaved changes?',description:file.relativePath,confirmLabel:'Reload',confirmVariant:'destructive'}))await load(true)})()}>Reload</Button></div>{content !== null && <MonacoEditor fileId={file.id} filePath={file.filePath} relativePath={file.relativePath} worktreeId={file.worktreeId} viewStateKey={`${file.worktreeId}:${viewId??file.id}`} viewStateId={viewId} content={draft ?? content} language={file.language} readOnly={file.readOnly} passiveMirror={!active} onContentChange={(text) => useAppStore.getState().setEditorDraft(file.id, text)} onSave={(text) => void save(text)} />}</div>
}
