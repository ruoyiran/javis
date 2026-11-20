import type { RuntimeMobileSessionTabsResult } from "../../../../../shared/runtime-session-contracts"
import type { RuntimeCapability } from "../../../../../shared/protocol-version"
import { projectSessionTabBrowserPlacements } from "./session-tab-browser-placement-projection"
import { projectSessionTabFileHosts } from "./session-tab-file-host-projection"

export function projectSessionTabsForClient(
  snapshot: RuntimeMobileSessionTabsResult,
  clientKind: 'mobile' | 'runtime' | undefined,
  clientCapabilities: readonly RuntimeCapability[] | undefined
): RuntimeMobileSessionTabsResult {
  // Phones draw no agent message cards, so they never pay for sender identity.
  const { agentSenderAssociations: _desktopOnly, ...phone } = snapshot
  return projectSessionTabBrowserPlacements(
    projectSessionTabFileHosts(
      clientKind === 'mobile' ? phone : snapshot,
      clientKind
    ),
    clientCapabilities
  )
}

/** Desktops show chat status from the status feed, never from tabs[].chatStatus; its freshness
 *  stamps alone would turn version-only frames into full desktop reconciles. Phones keep it. */
export function projectSessionTabsForInventoryStream(
  snapshot: RuntimeMobileSessionTabsResult,
  clientKind: 'mobile' | 'runtime' | undefined,
  clientCapabilities: readonly RuntimeCapability[] | undefined
): RuntimeMobileSessionTabsResult {
  const projected = projectSessionTabsForClient(snapshot, clientKind, clientCapabilities)
  if (
    clientKind === 'mobile' ||
    !projected.tabs.some((tab) => tab.type === 'agent-session' && tab.chatStatus)
  ) {
    return projected
  }
  return {
    ...projected,
    tabs: projected.tabs.map((tab) => {
      if (tab.type !== 'agent-session' || !tab.chatStatus) {
        return tab
      }
      const { chatStatus: _phoneOnly, ...desktop } = tab
      return desktop
    })
  }
}
