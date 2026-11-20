import { app, type BrowserWindow } from 'electron'
import { admitBrowserPageAttach, isBrowserPageAttachMarker, associateBrowserPageAttach, startBrowserPageAttach, closeBrowserMemoryRenderer } from '../browser/guest-lifecycle/browser-page-memory'
import { join } from 'node:path'
import { ORCA_BROWSER_GUEST_WEB_PREFERENCES } from '../../shared/browser/guest-lifecycle/browser-guest-web-preferences'
import { normalizeBrowserNavigationUrl } from '../../shared/browser-url'
import { browserManager } from '../browser/guest-lifecycle/manager/browser-manager'
import { browserSessionRegistry } from '../browser/sessions/profiles/browser-session-registry'
import {
  enforceLocalSshWebRtcPolicyForGuest,
  isLocalSshBrowserPartition
} from '../browser/routing/local-host-partitions/local-ssh-browser-partitions'
import {
  browserRouteSessionRegistry,
  browserRouteWebContentsRegistry
} from '../browser/routing/sessions/browser-route-session-runtime'
import '../../shared/constants'
import { ORCA_BROWSER_BLANK_URL } from '../../shared/browser/browser-blank-page'
import {
  DOC_PREVIEW_PARTITION,
  parseDocPreviewUrl
} from '../../shared/document-preview/doc-preview-scheme'
import { setDocPreviewFailureSink } from '../browser/document-preview/doc-preview-failure-notice'
import {
  getDocPreviewGrant,
  revokeAllDocPreviewGrants
} from '../browser/document-preview/doc-preview-grant-registry'
import { isDocPreviewSession } from '../browser/document-preview/doc-preview-protocol'
import { registerHostFrameNavigationGuard } from './host-frame-navigation-guard'
import { installPrivilegedWindowNavigationPolicy } from './privileged-window-navigation'
import { parseChromeExtensionUrl } from '../../shared/browser/extensions/browser-extension-url'
import { getBrowserExtensionSessionForProfile } from '../browser/extensions/profile-sessions/browser-extension-session-loader'
import { installBrowserJavaScriptDialogs } from '../browser/guest-lifecycle/prompts/browser-javascript-dialogs'
import { attachBrowserPasswordGuest } from '../browser-passwords/browser-password-guest-service'
import { isBrowserExtensionEnabledInProfile } from '../browser/extensions/web-store/browser-extension-webstore-service'
import { isBrowserExtensionSupportEnabled } from '../browser/extensions/browser-extension-support'
import { holdWebviewFirstLoadForExtensions } from '../browser/extensions/profile-sessions/browser-extension-page-start'
import {
  admitBrowserExtensionSidePanelAttach,
  isBrowserExtensionSidePanelAttachMarker,
  startBrowserExtensionSidePanelGuest
} from '../browser/extensions/side-panel/browser-extension-side-panel-attach'
import { associateBrowserExtensionSidePanelGuest } from '../browser/extensions/side-panel/browser-extension-side-panel-guests'
import { WEB_CONTENTS_MAX_LISTENERS_PER_EVENT } from './web-contents-listener-budget'

/** orca-preview is outside normal browser URL admission; require the doc partition and a main-minted user-preview grant. */
function isAdmissibleDocPreviewAttach(partition: string, src: string): boolean {
  if (partition !== DOC_PREVIEW_PARTITION) {
    return false
  }
  const target = parseDocPreviewUrl(src)
  return target !== null && getDocPreviewGrant(target.grantId) !== null
}

/**
 * Why its own rule: extension pages (options, tabs.create) are not typed URLs, so they attach only
 * in a local browser profile where that extension is installed and enabled.
 */
function isAdmissibleExtensionPageAttach(profileId: string | null, src: string): boolean {
  const extensionUrl = parseChromeExtensionUrl(src)
  if (!extensionUrl || !profileId || !isBrowserExtensionSupportEnabled()) {
    return false
  }
  return Boolean(
    getBrowserExtensionSessionForProfile(profileId)?.extensions.getExtension(extensionUrl.extensionId) ||
      isBrowserExtensionEnabledInProfile(profileId, extensionUrl.extensionId)
  )
}

export function installMainWindowWebviewSecurity(mainWindow: BrowserWindow): void {
  installPrivilegedWindowNavigationPolicy(mainWindow.webContents)
  // Why: plugin panels are frames of this renderer; same IP-handling fence as doc preview guests.
  mainWindow.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
  // Why here and on every fresh shell document: the renderer holds the only record of which
  // preview owns which grant, and a reload throws that record away. Grants it can no longer
  // release would stay live read authorities for the rest of the process.
  revokeAllDocPreviewGrants()
  mainWindow.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      revokeAllDocPreviewGrants()
    }
  })
  // These WebContents own every preview and its failure sink; destruction leaves no readers.
  const rendererId = mainWindow.webContents.id
  const associateCreatedGuest = (_event: Electron.Event, guest: Electron.WebContents): void => {
    if (guest.getType() === 'webview') guest.setMaxListeners(WEB_CONTENTS_MAX_LISTENERS_PER_EVENT)
    associateBrowserPageAttach(guest)
    associateBrowserExtensionSidePanelGuest(guest)
  }
  app.on('web-contents-created', associateCreatedGuest)
  mainWindow.webContents.on('destroyed', () => {
    app.off('web-contents-created', associateCreatedGuest)
    closeBrowserMemoryRenderer(rendererId)
    setDocPreviewFailureSink(null)
    revokeAllDocPreviewGrants()
  })
  // Install containment before any plugin/chat srcdoc frame is created.
  registerHostFrameNavigationGuard(mainWindow.webContents)

  const browserGuestPreload = join(__dirname, '../preload/browser-guest-preload.cjs')
  // Only previews get this pinned editor-link preload; never accept renderer preload values or expose it to browsing guests.
  const docPreviewLinkPreload = join(__dirname, '../preload/doc-preview-link-preload.cjs')
  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    const src = typeof params.src === 'string' ? params.src : ''
    const normalizedSrc = normalizeBrowserNavigationUrl(src)
    const partition = typeof webPreferences.partition === 'string' ? webPreferences.partition : ''
    let attachArgument: string | null = null
    if (isBrowserPageAttachMarker(src)) {
      try { attachArgument = admitBrowserPageAttach(src, rendererId, partition) }
      catch { event.preventDefault(); return }
    }
    const profileId = browserSessionRegistry.profileIdForPartition(partition)
    const isProfilePartition = profileId !== null
    const isRoutePartition = browserRouteSessionRegistry.isAllowedPartition(partition)
    // Direct-SSH partitions exist only after proxy verification; renderer URLs need no main-side grants, like profile partitions.
    const isLocalSshPartition = isLocalSshBrowserPartition(partition)
    const isDocPreviewAttach = isAdmissibleDocPreviewAttach(partition, src)
    const isExtensionPageAttach = isAdmissibleExtensionPageAttach(profileId, src)
    let isSidePanelAttach = false
    if (isBrowserExtensionSidePanelAttachMarker(src)) {
      if (!profileId || !isBrowserExtensionSupportEnabled() ||
          !admitBrowserExtensionSidePanelAttach(src, rendererId, partition)) {
        event.preventDefault()
        return
      }
      isSidePanelAttach = true
    }

    // Require an allowlisted src/partition; renderer mistakes must not grant preload/Node authority.
    if (
      !isDocPreviewAttach &&
      !isExtensionPageAttach &&
      !isSidePanelAttach &&
      ((!normalizedSrc && !attachArgument) ||
        (!isProfilePartition && !isRoutePartition && !isLocalSshPartition) ||
        (isRoutePartition && normalizedSrc !== ORCA_BROWSER_BLANK_URL && !attachArgument))
    ) {
      event.preventDefault()
      return
    }

    delete params.preload
    // Install main-world close policy before inline scripts can call window.close.
    webPreferences.preload = isDocPreviewAttach ? docPreviewLinkPreload : browserGuestPreload
    // Clear legacy preloadURL as well as preload so guests cannot inherit the main bridge.
    delete (webPreferences as Record<string, unknown>).preloadURL
    // Electron 43 omits inherited arguments; clear defensively so future inheritance cannot leak browser-host identity.
    delete webPreferences.additionalArguments
    if (attachArgument || isSidePanelAttach) delete params.src
    webPreferences.nodeIntegration = false
    // Iframes need the passkey watch and framed extension pages; sandboxed preloads run per frame.
    webPreferences.nodeIntegrationInSubFrames = !isDocPreviewAttach
    webPreferences.enableBlinkFeatures = ''
    webPreferences.disableBlinkFeatures = ''
    webPreferences.webSecurity = true
    webPreferences.allowRunningInsecureContent = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    // Force hardened guest preferences even if host markup omits/misspells them.
    Object.assign(webPreferences, ORCA_BROWSER_GUEST_WEB_PREFERENCES)
    // Preserve only the registry-validated partition so isolated profiles keep their storage.
    webPreferences.partition = partition
    if (profileId) {
      browserSessionRegistry.attachExtensions(profileId)
      holdWebviewFirstLoadForExtensions(mainWindow.webContents, profileId, params)
    }
  })

  mainWindow.webContents.on('did-attach-webview', (_event, guest) => {
    if (startBrowserExtensionSidePanelGuest(guest)) return
    if (isDocPreviewSession(guest.session)) {
      // workspace-doc guests cannot use browser routing/popups/auth identity; attach this live host as their read-failure sink.
      setDocPreviewFailureSink(mainWindow.webContents)
      browserManager.attachGuestPolicies(guest, null, {
        profile: 'workspace-doc',
        host: mainWindow.webContents
      })
      return
    }
    // Install popup/navigation policy at creation or early redirects/target=_blank can outrun registration.
    browserManager.attachGuestPolicies(guest)
    installBrowserJavaScriptDialogs(guest, () => browserManager.resolvePagePromptTarget(guest))
    // Route guests stay blank until exact main-owned registration and override generic popup routing.
    const routeGuest = browserRouteWebContentsRegistry.attachGuest(guest)
    // Proxies cannot block WebRTC UDP; enforce it per WebContents.
    enforceLocalSshWebRtcPolicyForGuest(guest)
    attachBrowserPasswordGuest(guest)
    if (!routeGuest) startBrowserPageAttach(guest)
  })
}
