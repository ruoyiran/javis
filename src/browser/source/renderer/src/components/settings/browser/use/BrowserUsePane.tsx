import { useEffect, useState } from 'react'
import { BROWSER_USE_ENABLED_STORAGE_KEY } from '@/lib/browser/browser-use-setup-state'
import { useJavisAgentSkillStatus } from './use-javis-agent-skill-status'
import { cn } from '@/lib/class-names'
import { useAppStore } from '../../../../store/index'
import {
  LOCAL_EXECUTION_HOST_ID,
  type ExecutionHostId
} from '../../../../../../shared/execution-host'
import { BROWSER_FAMILY_LABELS } from '../../../../../../shared/browser/browser-family-labels'
import { SearchableSetting } from '../../section-layout/SearchableSetting'
import { matchesSettingsSearch } from '../../search/settings-search'
import { getBrowserUsePaneSearchEntries } from './browser-use-search'
import { BrowserUseExamples } from './BrowserUseExamples'
import { BrowserUseComputerUseNotice } from './BrowserUseComputerUseNotice'
import { BrowserUseEnableSwitch } from './BrowserUseEnableSwitch'
import { BrowserUseSkillStep } from './BrowserUseSkillStep'
import { BrowserUseCookieImportStep } from './BrowserUseCookieImportStep'
import { useTranslate } from '@/i18n/use-translate'

type BrowserUseSetupProps = {
  hostId: ExecutionHostId
  onConfigureMoreBrowsers?: () => void
  onOpenComputerUse?: () => void
}

export function BrowserUseSetup({
  hostId,
  onConfigureMoreBrowsers,
  onOpenComputerUse
}: BrowserUseSetupProps): React.JSX.Element {
  const t = useTranslate()
  const searchQuery = useAppStore((s) => s.settingsSearchQuery)
  const browserSessionProfiles = useAppStore((s) => s.browserSessionProfiles)
  const fetchBrowserSessionProfiles = useAppStore((s) => s.fetchBrowserSessionProfiles)
  const browserSessionImportState = useAppStore((s) => s.browserSessionImportState)

  const [browserUseEnabled, setBrowserUseEnabled] = useState<boolean>(() => {
    return localStorage.getItem(BROWSER_USE_ENABLED_STORAGE_KEY) === '1'
  })

  const toggleBrowserUse = (value: boolean): void => {
    setBrowserUseEnabled(value)
    localStorage.setItem(BROWSER_USE_ENABLED_STORAGE_KEY, value ? '1' : '0')
    if (value) {
      useAppStore.getState().recordFeatureInteraction('agent-browser-setup')
    }
  }

  useEffect(() => {
    if (!browserUseEnabled) {
      return
    }
    void fetchBrowserSessionProfiles()
  }, [browserUseEnabled, fetchBrowserSessionProfiles])

  const defaultProfile = browserSessionProfiles.find((p) => p.id === 'default')
  const cookiesImported = !!defaultProfile?.source

  const {
    installed,
    loading,
    error,
    refresh: refreshSkill
  } = useJavisAgentSkillStatus(browserUseEnabled && hostId === LOCAL_EXECUTION_HOST_ID)
  const skillDisabled = hostId !== LOCAL_EXECUTION_HOST_ID
  const skillDetected = !skillDisabled && installed
  const skillLoading = !skillDisabled && loading
  const skillError = skillDisabled
    ? t(
        'browser.agentSetup.localOnly',
        'Agent setup is available on this computer. Select the local host to configure agents.'
      )
    : error

  const isImportingDefault =
    browserSessionImportState?.profileId === 'default' &&
    browserSessionImportState.status === 'importing'

  const showSkillStep = matchesSettingsSearch(searchQuery, [getBrowserUsePaneSearchEntries()[0]])
  const showCookieImportStep = matchesSettingsSearch(searchQuery, [
    getBrowserUsePaneSearchEntries()[1]
  ])
  const steps = [skillDetected, cookiesImported]
  const completedCount = steps.filter(Boolean).length

  const sourceLabel = defaultProfile?.source
    ? `${BROWSER_FAMILY_LABELS[defaultProfile.source.browserFamily] ?? defaultProfile.source.browserFamily}${defaultProfile.source.profileName ? ` (${defaultProfile.source.profileName})` : ''}`
    : null

  if (!browserUseEnabled) {
    return (
      <div className="flex items-center justify-between gap-4 py-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">
            {t('auto.components.settings.BrowserUsePane.507fdae102', 'Agent browser use')}
          </p>
          <p className="text-xs text-muted-foreground">
            {t(
              'auto.components.settings.BrowserUsePane.96b91c6349',
              'Let coding agents drive this browser with your logins.'
            )}
          </p>
        </div>
        <BrowserUseEnableSwitch
          enabled={browserUseEnabled}
          onToggle={() => toggleBrowserUse(!browserUseEnabled)}
        />
      </div>
    )
  }

  return (
    <div className="space-y-3 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-sm font-semibold">
            {t('auto.components.settings.BrowserUsePane.507fdae102', 'Agent browser use')}
          </p>
          <p className="text-xs text-muted-foreground">
            {t(
              'auto.components.settings.BrowserUsePane.finishSteps',
              'Let coding agents drive this browser with your logins. Finish the steps below.'
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              completedCount === steps.length
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {completedCount}/{steps.length}
          </span>
          <BrowserUseEnableSwitch
            enabled={browserUseEnabled}
            onToggle={() => toggleBrowserUse(!browserUseEnabled)}
          />
        </div>
      </div>

      {onOpenComputerUse ? (
        <BrowserUseComputerUseNotice onOpenComputerUse={onOpenComputerUse} />
      ) : null}

      {showSkillStep ? (
        <SearchableSetting
          title={t(
            'auto.components.settings.BrowserUsePane.4451b3c0a6',
            'Install browser use skill'
          )}
          description={t(
            'auto.components.settings.BrowserUsePane.68ea76eb71',
            "Install the Browser Use skill so agents can operate Javis's browser."
          )}
          keywords={getBrowserUsePaneSearchEntries()[0].keywords}
          className={cn(
            'rounded-xl border border-border/60 bg-card/50 p-4',
            skillDisabled && 'opacity-60'
          )}
        >
          <BrowserUseSkillStep
            target={skillDisabled ? null : { kind: 'local' }}
            skillDetected={skillDetected}
            skillLoading={skillLoading}
            skillError={skillError}
            disabled={skillDisabled}
            onBeforeInstall={() => {
              useAppStore.getState().recordFeatureInteraction('agent-browser-setup')
            }}
            onRecheck={refreshSkill}
          />
        </SearchableSetting>
      ) : null}

      {showCookieImportStep ? (
        <BrowserUseCookieImportStep
          cookiesImported={cookiesImported}
          isImportingDefault={isImportingDefault}
          sourceLabel={sourceLabel}
          onConfigureMoreBrowsers={onConfigureMoreBrowsers}
        />
      ) : null}

      <BrowserUseExamples />
    </div>
  )
}
