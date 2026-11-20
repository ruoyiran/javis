import { afterEach, expect, it, vi } from 'vitest'
vi.mock('../../../src/browser/source/renderer/src/store/index', () => ({
  useAppStore: () => undefined
}))
import {
  browserPageNeedsPaintRetention,
  onBrowserGuestPaintRetentionChange
} from '../../../src/browser/source/renderer/src/components/browser-pane/host-guest/browser-guest-paint-retention'
import {
  acquireBrowserAutomationVisibility,
  releaseBrowserAutomationVisibility
} from '../../../src/browser/source/renderer/src/components/browser-pane/host-guest/retention/browser-automation-visibility-store'
import {
  hydrateBrowserDrivers,
  setDriverForBrowserPage
} from '../../../src/browser/source/renderer/src/runtime/browser/ownership/browser-mobile-driver-store'
import {
  hydrateBrowserRemoteViewerPages,
  setRemoteViewersForBrowserPage
} from '../../../src/browser/source/renderer/src/runtime/browser/ownership/browser-remote-viewer-store'

afterEach(() => {
  hydrateBrowserDrivers([])
  hydrateBrowserRemoteViewerPages([])
})

it('keeps a hidden page painting until its automation, driver and viewer ownership are released', () => {
  const page = 'retained-page'
  const observed: boolean[] = []
  const unsubscribe = onBrowserGuestPaintRetentionChange(() =>
    observed.push(browserPageNeedsPaintRetention(page))
  )
  const lease = acquireBrowserAutomationVisibility(page)
  try {
    setDriverForBrowserPage(page, { kind: 'mobile', clientId: 'phone-a' })
    setRemoteViewersForBrowserPage(page, true)
    releaseBrowserAutomationVisibility(lease)
    hydrateBrowserDrivers([])
    expect(browserPageNeedsPaintRetention(page)).toBe(true)
    hydrateBrowserRemoteViewerPages([])
    expect(browserPageNeedsPaintRetention(page)).toBe(false)
    expect(observed).toEqual([true, true, true, true, true, false])
    unsubscribe()
    setRemoteViewersForBrowserPage(page, true)
    expect(observed).toEqual([true, true, true, true, true, false])
  } finally {
    unsubscribe()
    releaseBrowserAutomationVisibility(lease)
  }
})
