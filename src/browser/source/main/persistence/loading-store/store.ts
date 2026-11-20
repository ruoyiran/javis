import { app } from 'electron'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { getDefaultSettings, getDefaultUIState } from '../../../shared/constants'
import type { PersistedUIState } from '../../../shared/persisted-ui-state-types'
import type { GlobalSettings } from '../../../shared/global-settings-types'

export class Store {
  private readonly path = join(app.getPath('userData'), 'settings.json')
  private settings: GlobalSettings = getDefaultSettings(app.getPath('home'))
  constructor(private readonly uiState: () => PersistedUIState = getDefaultUIState) {
    try { this.settings = { ...this.settings, ...JSON.parse(readFileSync(this.path, 'utf8')) } } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  getUI(): PersistedUIState { return this.uiState() }
  async flushPendingOrThrowAsync(_options?: unknown): Promise<void> {}
  getSettings(): GlobalSettings { return { ...this.settings } }
  updateSettings(patch: Partial<GlobalSettings>, _options?: unknown): void {
    this.settings = { ...this.settings, ...patch }
    writeFileSync(`${this.path}.tmp`, JSON.stringify(this.settings), { mode: 0o600 })
    renameSync(`${this.path}.tmp`, this.path)
  }
}
