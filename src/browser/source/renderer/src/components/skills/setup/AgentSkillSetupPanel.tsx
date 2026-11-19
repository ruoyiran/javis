import { useState } from 'react'
import { Download, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '../../ui/button'
import { SkillSetupRow } from './SkillSetupRow'
import type { AgentSkillSetupPanelProps } from './agent-skill-setup-panel-props'

export function AgentSkillSetupPanel(props: AgentSkillSetupPanelProps): React.JSX.Element {
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const leading = typeof props.leading === 'function' ? props.leading(props.installed) : props.leading
  const install = async (): Promise<void> => {
    if (installing) return
    setInstalling(true); setError(null)
    try {
      await props.onBeforeInstall?.()
      const bridge = (window.api as unknown as { javisBrowser: { call(method: string, params: Record<string, unknown>): Promise<unknown> } }).javisBrowser
      await bridge.call('agent.install', { agent: 'all' })
      await props.onRecheck()
    } catch { setError('Agent setup could not be confirmed. Check Javis agent status before retrying.') }
    finally { setInstalling(false) }
  }
  return <SkillSetupRow className={props.className} title={<span className="flex items-center gap-2">{leading}{props.title}</span>} description={props.description} error={error ?? props.error} actions={<div className="flex shrink-0 gap-2">
    {(!props.installed || props.showInstallWhenInstalled !== false) && <Button variant={props.installVariant ?? 'outline'} size="sm" disabled={props.installDisabled || installing || props.loading} onClick={() => void install()}>{installing ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}{installing ? 'Installing…' : props.installed ? props.installedInstallLabel ?? 'Update' : props.installLabel ?? 'Install'}</Button>}
    <Button variant="ghost" size="sm" disabled={installing || props.loading} onClick={() => void props.onRecheck()}><RefreshCw className="size-3.5" />Recheck</Button>
  </div>}>{props.actionHint}{typeof props.footer === 'function' ? props.footer(undefined) : props.footer}</SkillSetupRow>
}
