import { describe, expect, it } from 'vitest'
import { hydrateWorkspaceSession, serializeWorkspaceSession } from '../../../src/browser/renderer/workspace-session-state'
import { getDefaultWorkspaceSession } from '../../../src/browser/source/shared/constants'
import type { AppState } from '../../../src/browser/source/renderer/src/store/types'
const page = { id:'page-a',workspaceId:'browser-a',worktreeId:'opaque-session',url:'https://example.com/',title:'Example',loading:true,faviconUrl:null,canGoBack:false,canGoForward:false,loadError:null,createdAt:1 }
const note = {id:'note-a',browserPageId:'page-a',comment:'Move the button',intent:'change',priority:'normal',createdAt:'2026-11-19',payload:{url:'https://example.com/'}}
const tab = {id:'tab-a',entityId:'browser-a',worktreeId:'opaque-session',groupId:'group-a',contentType:'browser',label:'Example',customLabel:null,color:null,sortOrder:0,createdAt:1}
const session = { ...getDefaultWorkspaceSession(), activeWorktreeId:'opaque-session', browserTabsByWorktree:{'opaque-session':[{...page,id:'browser-a',activePageId:'page-a',pageIds:['page-a']}]},browserPagesByWorkspace:{'browser-a':[{...page,annotations:[note]}]},activeBrowserTabIdByWorktree:{'opaque-session':'browser-a'},activeTabTypeByWorktree:{'opaque-session':'browser'},unifiedTabs:{'opaque-session':[tab]},tabGroups:{'opaque-session':[{id:'group-a',worktreeId:'opaque-session',activeTabId:'tab-a',tabOrder:['tab-a']}]},tabGroupLayouts:{'opaque-session':{type:'leaf',groupId:'group-a'}},activeGroupIdByWorktree:{'opaque-session':'group-a'} } as unknown as ReturnType<typeof getDefaultWorkspaceSession>
const base = { activeWorktreeId:'opaque-session',activeTabType:'browser',activeTabTypeByWorktree:{},openFiles:[],tabsByWorktree:{},activeTabIdByWorktree:{},activeFileIdByWorktree:{},editorDrafts:{} } as unknown as AppState
it('restores canonical browser groups and notes while resetting stale loading',()=>{
 const restored = hydrateWorkspaceSession(base,session,'opaque-session',new Set(['opaque-session']))
 expect(restored.groupsByWorktree?.['opaque-session'][0].activeTabId).toBe('tab-a')
 expect(restored.layoutByWorktree?.['opaque-session']).toEqual({type:'leaf',groupId:'group-a'})
 expect(restored.browserPagesByWorkspace?.['browser-a'][0].loading).toBe(false)
 expect(restored.browserAnnotationsByPageId?.['page-a'][0].comment).toBe('Move the button')
 expect(restored.activeBrowserTabId).toBe('browser-a')
 const saved=serializeWorkspaceSession({...base,...restored} as AppState,session)
 expect(saved.unifiedTabs?.['opaque-session'][0].id).toBe('tab-a')
 expect(saved.tabGroups?.['opaque-session'][0].tabOrder).toEqual(['tab-a'])
 expect(saved.browserPagesByWorkspace?.['browser-a'][0].annotations?.[0].id).toBe('note-a')
 expect('groupsByWorktree' in saved).toBe(false)
})

it('selects a renderable browser when the headless session had no active tab in its group',()=>{
 const background=structuredClone(session);background.tabGroups!['opaque-session'][0].activeTabId=null;background.activeTabTypeByWorktree!['opaque-session']='terminal'
 const restored=hydrateWorkspaceSession(base,background,'opaque-session',new Set(['opaque-session']))
 expect(restored.groupsByWorktree?.['opaque-session'][0].activeTabId).toBe('tab-a')
 expect(restored.activeTabType).toBe('browser')
})
