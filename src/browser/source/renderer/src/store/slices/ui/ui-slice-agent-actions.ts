import type { UISlice, UISliceGet, UISliceSet } from './ui-slice-contract'
export function createUiAgentActions(set: UISliceSet, get: UISliceGet): Partial<UISlice> {
  return {
    sidebarOpen: false, sidebarWidth: 280,
    toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
    setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
    setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
    agentSendPopoverTargetMode: null,
    openAgentSendPopoverTargetMode: (args) => set({ agentSendPopoverTargetMode: {
      ...args, instanceId: crypto.randomUUID(), eligiblePaneKeys: [], disabledPaneKeys: {}, status: 'open'
    } }),
    closeAgentSendPopoverTargetMode: (id, instanceId) => set((state) => {
      const mode = state.agentSendPopoverTargetMode
      return mode && (!id || mode.id === id) && (!instanceId || mode.instanceId === instanceId) ? { agentSendPopoverTargetMode: null } : state
    }),
    sendPromptToSidebarAgentTarget: async () => {
      const mode = get().agentSendPopoverTargetMode
      if (!mode || mode.status === 'sending' || !mode.prompt.trim()) return false
      set({ agentSendPopoverTargetMode: { ...mode, status: 'sending' } })
      const bridge = (window.api as unknown as { javisBrowser: { call(method: string, params: Record<string, unknown>): Promise<unknown> } }).javisBrowser
      const delivery = bridge.call('browser.annotations.enqueue', { context: mode.worktreeId, prompt: mode.prompt, annotations: Object.values(get().browserAnnotationsByPageId).flat(), deliveryId: crypto.randomUUID() })
      mode.onPromptHandedOff?.(delivery)
      try { const result = await delivery; if (result && typeof result === 'object' && 'status' in result && result.status === 'acknowledged') mode.onPromptDelivered?.(); get().closeAgentSendPopoverTargetMode(mode.id, mode.instanceId); return Boolean(result && typeof result === 'object' && 'status' in result && result.status === 'acknowledged') }
      catch { set({ agentSendPopoverTargetMode: { ...mode, status: 'error', error: 'Feedback delivery could not be confirmed' } }); return false }
    }
  }
}
