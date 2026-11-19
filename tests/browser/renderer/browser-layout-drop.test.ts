import { expect, it, vi, afterEach } from 'vitest'
import { create } from 'zustand'
import { createTabsDropActions } from '../../../src/browser/source/renderer/src/store/slices/tabs/tabs-drop-actions'
import { createTabsSplitRatioActions } from '../../../src/browser/source/renderer/src/store/slices/tabs/tabs-split-ratio-actions'
import type { AppState } from '../../../src/browser/source/renderer/src/store/types'
afterEach(()=>vi.unstubAllGlobals())
it.each(['right','down'] as const)('moves an actual tab into a new %s split and persists its ratio',(direction)=>{
 vi.stubGlobal('crypto',{randomUUID:()=> 'group-new'})
 const tab=(id:string)=>({id,entityId:`browser-${id}`,groupId:'group-a',worktreeId:'context-a',contentType:'browser',label:id,customLabel:null,color:null,sortOrder:id==='one'?0:1,createdAt:1})
 const store=create<AppState>()((set,get)=>({activeWorktreeId:'context-a',unifiedTabsByWorktree:{'context-a':[tab('one'),tab('two')]},groupsByWorktree:{'context-a':[{id:'group-a',worktreeId:'context-a',tabOrder:['one','two'],activeTabId:'one'}]},layoutByWorktree:{'context-a':{type:'leaf',groupId:'group-a'}},activeGroupIdByWorktree:{'context-a':'group-a'},browserTabsByWorktree:{},openFiles:[],tabsByWorktree:{},activeFileIdByWorktree:{},activeTabIdByWorktree:{},activeBrowserTabIdByWorktree:{},activeTabTypeByWorktree:{},...createTabsDropActions(set,get),...createTabsSplitRatioActions(set)} as unknown as AppState))
 expect(store.getState().dropUnifiedTab('two',{groupId:'group-a',splitDirection:direction})).toBe(true)
 expect(store.getState().groupsByWorktree['context-a'].find(group=>group.id==='group-new')?.tabOrder).toEqual(['two'])
 expect(store.getState().layoutByWorktree['context-a']).toEqual({type:'split',ratio:0.5,direction:direction==='right'?'horizontal':'vertical',first:{type:'leaf',groupId:'group-a'},second:{type:'leaf',groupId:'group-new'}})
 store.getState().setTabGroupSplitRatio('context-a','',0.3)
 expect(store.getState().layoutByWorktree['context-a']).toMatchObject({ratio:0.3})
})
