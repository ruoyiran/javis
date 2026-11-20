// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { useJavisAgentSkillStatus } from '../../../src/browser/source/renderer/src/components/settings/browser/use/use-javis-agent-skill-status'

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

it('checks both local agents using the Javis status contract and refuses a disabled host refresh', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  window.api = {
    javisBrowser: {
      call: async (method: string, params: Record<string, unknown>) => {
        if (method !== 'agent.status' || params.agent !== undefined)
          throw new Error('Invalid status request')
        return [
          { agent: 'codex', available: true, skill: true, mcp: true },
          { agent: 'claude', available: true, skill: true, mcp: true }
        ]
      }
    }
  } as unknown as typeof window.api
  let status: ReturnType<typeof useJavisAgentSkillStatus> | undefined
  function Status({ enabled }: { enabled: boolean }): null {
    status = useJavisAgentSkillStatus(enabled)
    return null
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(createElement(Status, { enabled: true })))
    expect(status!.installed).toBe(true)
    await act(async () => root.render(createElement(Status, { enabled: false })))
    expect(status!.installed).toBe(false)
    let refreshed: boolean | undefined
    await act(async () => {
      refreshed = await status!.refresh()
    })
    expect(refreshed).toBe(false)
  } finally {
    await act(async () => root.unmount())
    delete (window as unknown as { api?: unknown }).api
  }
})
