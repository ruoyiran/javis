import '../source/renderer/src/assets/main.css'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from '../source/renderer/src/i18n/I18nProvider'
import { TooltipProvider } from '../source/renderer/src/components/ui/tooltip'
import { Toaster } from '../source/renderer/src/components/ui/sonner'
import PinnedTabCloseDialog from '../source/renderer/src/components/terminal-pane/layout/close/PinnedTabCloseDialog'
import { BrowserWorkspaceApp } from './browser-workspace-app'
import { bootstrapBrowserWorkspace } from './workspace-bootstrap'
import { installAppKeyboardRouter } from '../source/renderer/src/lib/keyboard/app-keyboard-router'
import { installBodyOverlayAttributes } from '../source/renderer/src/lib/overlay-interaction/body-overlay-attributes'
import { applyDocumentTheme } from '../source/renderer/src/app-shell/appearance/document-theme'
import { useAppStore } from '../source/renderer/src/store'
import { installBrowserClientPageRenderer } from '../source/renderer/src/components/browser-pane/browser-client-page-renderer-installation'
import { registerBrowserClientPageGuestMessageHandler } from '../source/renderer/src/components/browser-pane/browser-client-page-retained-elements'
import { handleGuestWindowCloseMessage } from '../source/renderer/src/components/browser-pane/host-guest/browser-page-window-close'

installAppKeyboardRouter()
installBodyOverlayAttributes()
registerBrowserClientPageGuestMessageHandler(handleGuestWindowCloseMessage)
installBrowserClientPageRenderer()
const element = document.getElementById('root')
if (!element) throw new Error('Browser renderer root is missing')
const root = createRoot(element)
void bootstrapBrowserWorkspace().then(() => {
  applyDocumentTheme(useAppStore.getState().settings?.theme ?? 'system', { disableTransitions: false })
  useAppStore.subscribe((state, previous) => { if (state.settings?.theme !== previous.settings?.theme) applyDocumentTheme(state.settings?.theme ?? 'system', { disableTransitions: false }) })
  root.render(<I18nProvider><TooltipProvider><BrowserWorkspaceApp /><PinnedTabCloseDialog /><Toaster /></TooltipProvider></I18nProvider>)
}).catch(() => {
  root.render(<div className="flex h-screen items-center justify-center bg-background text-foreground"><div role="alert" className="space-y-4"><p>Javis could not load the browser workspace.</p><button onClick={() => window.location.reload()}>Retry</button></div></div>)
})
