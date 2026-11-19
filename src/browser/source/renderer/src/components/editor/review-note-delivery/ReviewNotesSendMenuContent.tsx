import { useState, useEffect } from 'react'
import { Send, Loader2 } from 'lucide-react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useAppStore } from '@/store'
import { toast } from 'sonner'
import { useTranslate } from '@/i18n/use-translate'

export function ReviewNotesSendMenuContent({ worktreeId, groupId, prompt, onPromptDelivered, onPromptHandedOff }: {
  worktreeId: string; groupId: string; prompt: string; promptDelivery?: string; launchSource?: string
  onPromptDelivered?: () => void; onPromptHandedOff?: (delivered: Promise<unknown>) => void
}): React.JSX.Element {
  const [sending, setSending] = useState(false)
  const [available, setAvailable] = useState(false)
  useEffect(() => { let current=true; const bridge=(window.api as unknown as {javisBrowser:{call(method:string,params:Record<string,unknown>):Promise<unknown>}}).javisBrowser; void bridge.call('browser.annotations.targets',{context:worktreeId}).then((result)=>{if(current)setAvailable(Boolean(result && typeof result==='object' && 'targets' in result && Array.isArray(result.targets) && result.targets.some((target)=>target.id==='context-queue' && target.available)))},()=>{if(current)setAvailable(false)});return()=>{current=false}},[worktreeId])
  const t = useTranslate()
  return <DropdownMenuItem disabled={sending || !prompt || !available} onSelect={(event) => {
    event.preventDefault()
    if (sending || !prompt) return
    setSending(true)
    const state = useAppStore.getState()
    const mode = state.agentSendPopoverTargetMode
    const sourcePageId = mode?.id.match(/^browser-annotations:(.+):(banner|tray)$/)?.[1] ?? state.browserTabsByWorktree[worktreeId]?.find((tab) => tab.id === state.activeBrowserTabIdByWorktree[worktreeId])?.activePageId
    const pageIds = sourcePageId ? [sourcePageId] : []
    const annotations = pageIds.flatMap((id) => state.browserAnnotationsByPageId[id] ?? [])
    const bridge = (window.api as unknown as { javisBrowser: { call(method: string, params: Record<string, unknown>): Promise<unknown> } }).javisBrowser
    const delivered = (async () => {
      const payload = { context: worktreeId, groupId, prompt, pageIds, annotations }
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)))
      const deliveryId = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
      const result = await bridge.call('browser.annotations.enqueue', { ...payload, deliveryId })
      if (!result || typeof result !== 'object' || !('status' in result) || (result.status !== 'queued' && result.status !== 'acknowledged')) throw new Error('The annotation queue did not acknowledge delivery')
      return { ...result, delivered: result.status === 'acknowledged' }
    })()

    if (onPromptHandedOff) onPromptHandedOff(delivered)
    else void delivered.then((result) => { if (result.delivered) onPromptDelivered?.() }, () => {})
    void delivered.then(() => { useAppStore.getState().closeAgentSendPopoverTargetMode(); toast.success('Feedback queued for this Javis context') }, () => { toast.error('Feedback delivery could not be confirmed. Refresh the context before sending again.') }).finally(() => setSending(false))
  }}>{sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}{t('browser.annotation.sendToContext', 'Send to this context')}</DropdownMenuItem>
}
