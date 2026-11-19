import type { Tab } from '../source/shared/tab-types'
export type TabCloseProtection = { pinned: boolean; dirty: boolean; unsentNotes: boolean }
export function bulkTabCloseAllowed(protection: TabCloseProtection): boolean { return !protection.pinned && !protection.dirty && !protection.unsentNotes }
export async function closeGuardedTab(tab: Tab, protection: TabCloseProtection, bulk: boolean, ports: { confirmPinned(): Promise<boolean>; confirmDirty(): Promise<boolean>; confirmNotes(): Promise<boolean>; retire(tabId: string): void }): Promise<boolean> {
  if(bulk && !bulkTabCloseAllowed(protection))return false
  if(!bulk && protection.pinned && !await ports.confirmPinned())return false
  if(!bulk && protection.dirty && !await ports.confirmDirty())return false
  if(!bulk && protection.unsentNotes && !await ports.confirmNotes())return false
  ports.retire(tab.id);return true
}
