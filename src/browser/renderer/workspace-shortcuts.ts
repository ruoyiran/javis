import { FLOATING_TERMINAL_WORKTREE_ID } from '../source/shared/workspace/identity/floating-workspace-id'
import { textFieldClaimsActionKey } from '../source/renderer/src/lib/keyboard/text-field-shortcut-policy'
import { replayAppKeyDown } from '../source/renderer/src/lib/keyboard/app-keyboard-router'
import { useAppStore } from '../source/renderer/src/store'
import {
  addAppKeyListener,
  removeAppKeyListener
} from '../source/renderer/src/lib/keyboard/app-keyboard-router'
import { keybindingMatchesAction } from '../source/shared/keybindings/matching'
import type { KeybindingActionId } from '../source/shared/keybindings/types'
import { dispatchWorkspaceTabCommand } from '../source/renderer/src/lib/workspace/tabs/workspace-tab-commands'

export function installWorkspaceShortcuts(): () => void {
  const listener = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.isComposing) return
    const state = useAppStore.getState(),
      context =
        state.floatingWorkspacePanelOpen && document.activeElement?.closest('[data-javis-floating]')
          ? FLOATING_TERMINAL_WORKTREE_ID
          : state.activeWorktreeId
    if (
      !context ||
      (context !== FLOATING_TERMINAL_WORKTREE_ID && state.activeView === 'settings') ||
      state.activeModal !== 'none' ||
      document.body.hasAttribute('data-modal-overlay-open')
    )
      return
    const group = state.activeGroupIdByWorktree[context]
    const platform = navigator.userAgent.includes('Mac')
      ? 'darwin'
      : navigator.userAgent.includes('Windows')
        ? 'win32'
        : 'linux'
    const actions: Partial<Record<KeybindingActionId, () => void>> = {
      'tab.newBrowser': () => {
        void state.openNewBrowserTabInActiveWorkspace(group)
      },
      'tab.newBrowserSplitRight': () => {
        void state.openNewBrowserTabInActiveWorkspace(group, 'right')
      },
      'tab.close': () => {
        dispatchWorkspaceTabCommand({ type: 'close' }, context)
      },
      'tab.nextAllTypes': () => {
        dispatchWorkspaceTabCommand({ type: 'switch', direction: 1, scope: 'all-types' }, context)
      },
      'tab.previousAllTypes': () => {
        dispatchWorkspaceTabCommand({ type: 'switch', direction: -1, scope: 'all-types' }, context)
      },
      'tab.reopenClosed': () => {
        state.reopenClosedTab(context)
      },
      'floatingTerminal.toggle': () => {
        window.dispatchEvent(new Event('orca-toggle-floating-terminal'))
      }
    }
    for (const [id, execute] of Object.entries(actions))
      if (
        !textFieldClaimsActionKey(event, id as KeybindingActionId) &&
        keybindingMatchesAction(id as KeybindingActionId, event, platform, state.keybindings, {
          context: 'app'
        })
      ) {
        event.preventDefault()
        event.stopImmediatePropagation()
        execute?.()
        return
      }
  }
  addAppKeyListener('keydown', listener)
  const guest = window.api.ui.onBrowserPageTabShortcut((input) =>
    replayAppKeyDown(
      Object.assign(
        new KeyboardEvent('keydown', {
          key: input.key,
          code: input.code,
          altKey: input.alt,
          ctrlKey: input.control,
          metaKey: input.meta,
          shiftKey: input.shift,
          cancelable: true
        }),
        { doubleTapModifier: input.doubleTapModifier }
      )
    )
  )
  const close = window.api.ui.onCloseActiveTab((payload) =>
    dispatchWorkspaceTabCommand({
      type: 'close',
      ...(payload?.sourceId
        ? { target: { kind: 'browser-source', sourceId: payload.sourceId } as const }
        : {})
    })
  )
  const recent = window.api.ui.onSwitchRecentTab(() =>
    dispatchWorkspaceTabCommand({ type: 'previous-recent' })
  )
  let disposed = false,
    revision = 0
  const unsubscribe = window.api.keybindings.onChanged((snapshot) => {
    revision++
    useAppStore.getState().setKeybindingSnapshot(snapshot)
  })
  const captured = revision
  void window.api.keybindings.get().then(
    (snapshot) => {
      if (!disposed && captured === revision) useAppStore.getState().setKeybindingSnapshot(snapshot)
    },
    () => {}
  )
  return () => {
    disposed = true
    removeAppKeyListener('keydown', listener)
    guest()
    close()
    recent()
    unsubscribe?.()
  }
}
