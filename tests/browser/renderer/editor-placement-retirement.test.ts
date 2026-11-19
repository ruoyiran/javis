import {expect,it} from 'vitest'
import {create} from 'zustand'
import {createTabsSlice} from '../../../src/browser/source/renderer/src/store/slices/tabs/create-tabs-slice'
import type {AppState} from '../../../src/browser/source/renderer/src/store/types'
it.each(['global-floating-terminal','main'])('retires one main/%s view and releases the backing document only after the last view',(remainingContext)=>{
 const file={id:'/file.html',filePath:'/file.html',relativePath:'file.html',worktreeId:'main',language:'html',mode:'edit',isDirty:true}
 const tab=(id:string,context:string,groupId:string)=>({id,entityId:'/file.html',groupId,worktreeId:context,contentType:'editor',label:'file.html',customLabel:null,color:null,sortOrder:0,createdAt:1})
 const store=create<AppState>()((set,get,api)=>({...createTabsSlice(set,get,api),activeWorktreeId:'main',openFiles:[file],editorDrafts:{'/file.html':'unsaved'},recentlyClosedEditorTabsByWorktree:{},recentlyClosedTabKindsByWorktree:{},tabBarOrderByWorktree:{},browserTabsByWorktree:{},tabsByWorktree:{},activeTabIdByWorktree:{},activeFileIdByWorktree:{},activeBrowserTabIdByWorktree:{},activeTabTypeByWorktree:{},closeFile:(id:string)=>{
   const placements=Object.values(get().unifiedTabsByWorktree).flat().filter(tab=>tab.entityId===id)
   if(placements.length){get().closeUnifiedTabs(placements.filter(tab=>tab.worktreeId==='main').map(tab=>tab.id));return}
   set({openFiles:[],editorDrafts:{}})
 },unifiedTabsByWorktree:remainingContext==='main'?{main:[tab('main-view','main','main-group'),tab('floating-view','main','floating-group')]}:{main:[tab('main-view','main','main-group')],'global-floating-terminal':[tab('floating-view','global-floating-terminal','floating-group')]},groupsByWorktree:remainingContext==='main'?{main:[{id:'main-group',worktreeId:'main',activeTabId:'main-view',tabOrder:['main-view']},{id:'floating-group',worktreeId:'main',activeTabId:'floating-view',tabOrder:['floating-view']}]}:{main:[{id:'main-group',worktreeId:'main',activeTabId:'main-view',tabOrder:['main-view']}],'global-floating-terminal':[{id:'floating-group',worktreeId:'global-floating-terminal',activeTabId:'floating-view',tabOrder:['floating-view']}]},activeGroupIdByWorktree:{main:'main-group','global-floating-terminal':'floating-group'},layoutByWorktree:{main:{type:'leaf',groupId:'main-group'},'global-floating-terminal':{type:'leaf',groupId:'floating-group'}}} as unknown as AppState))
 store.getState().closeUnifiedTab('main-view')
 expect(store.getState().unifiedTabsByWorktree.main.map(tab=>tab.id)).toEqual(remainingContext==='main'?['floating-view']:[])
 expect(store.getState().unifiedTabsByWorktree[remainingContext].map(tab=>tab.id)).toEqual(['floating-view'])
 expect(store.getState().openFiles.map(file=>file.id)).toEqual(['/file.html'])
 expect(store.getState().editorDrafts['/file.html']).toBe('unsaved')
 store.getState().closeUnifiedTab('floating-view')
 expect(store.getState().unifiedTabsByWorktree[remainingContext]).toEqual([])
 expect(store.getState().openFiles).toEqual([])
})
