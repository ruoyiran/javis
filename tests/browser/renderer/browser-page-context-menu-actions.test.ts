// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('../../../src/browser/source/renderer/src/store/index', () => ({
  useAppStore: (select: (state: object) => unknown) =>
    select({ browserDefaultSearchEngine: 'google' })
}))
import { RemoteBrowserPageContextMenu } from '../../../src/browser/source/renderer/src/components/browser-pane/stream-remote/remote-browser-page-context-menu'
import type { BrowserPageContextMenuActions } from '../../../src/browser/source/renderer/src/components/browser-pane/assemble-chrome/browser-page-context-menu-items'

let unmount: (() => Promise<void>) | undefined

afterEach(async () => {
  await unmount?.()
  unmount = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

it('routes a remote link to its owning browser action and closes the menu', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const opened: { url: string; activate: boolean }[] = []
  let dismissed = false
  const actions: BrowserPageContextMenuActions = {
    edit: () => {},
    openInNewTab: (url, activate) => opened.push({ url, activate }),
    externalUrl: () => null,
    goBack: () => {},
    goForward: () => {},
    reload: () => {}
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  unmount = async () => {
    await act(async () => root.unmount())
  }
  await act(async () =>
    root.render(
      createElement(RemoteBrowserPageContextMenu, {
        contextMenu: {
          x: 10,
          y: 10,
          linkUrl: 'https://example.test/remote-link',
          pageUrl: 'https://example.test/page',
          selectionText: '',
          editable: null,
          image: null
        },
        onDismiss: () => {
          dismissed = true
        },
        history: { canGoBack: false, canGoForward: false },
        actions
      })
    )
  )
  const openLink = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (button) => button.textContent?.includes('Open Link In Javis Browser')
  )
  expect(openLink).toBeDefined()
  await act(async () => openLink!.click())
  expect(opened).toEqual([{ url: 'https://example.test/remote-link', activate: false }])
  expect(dismissed).toBe(true)
})
