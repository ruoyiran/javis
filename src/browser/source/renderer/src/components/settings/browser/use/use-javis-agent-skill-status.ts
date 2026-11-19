import { useCallback, useEffect, useState } from 'react'
export function useJavisAgentSkillStatus(enabled: boolean): { installed: boolean; loading: boolean; error: string | null; refresh(): Promise<boolean> } {
  const [installed, setInstalled] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async (): Promise<boolean> => {
    setLoading(true); setError(null)
    try {
      const bridge = (window.api as unknown as { javisBrowser: { call(method: string, params: Record<string, unknown>): Promise<unknown> } }).javisBrowser
      const response = await bridge.call('agent.status', { agent: 'all' })
      const statuses = Array.isArray(response) ? response : response && typeof response === 'object' && 'agents' in response && Array.isArray(response.agents) ? response.agents : []
      const available = statuses.filter((status) => status && status.available === true)
      const complete = available.length > 0 && available.every((status) => status.skill === true && status.mcp === true)
      setInstalled(complete); return complete
    } catch { setError('Agent status is unavailable'); return false }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { if (enabled) void refresh() }, [enabled, refresh])
  return { installed, loading, error, refresh }
}
