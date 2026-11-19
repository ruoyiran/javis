import {expect,it} from 'vitest'
import {backgroundBrowserContexts} from '../../../src/browser/renderer/background-browser-context-selection'
import type {BrowserPage} from '../../../src/browser/source/shared/browser-workspace-types'
it('provides B a body host while A selection remains unchanged',()=>{
 const active='A',pages={workspaceB:[{id:'page-b',worktreeId:'B'}] as BrowserPage[]}
 expect(backgroundBrowserContexts(pages,new Set(['B']),active,()=>false)).toEqual(['B'])
 expect(active).toBe('A')
 expect(backgroundBrowserContexts(pages,new Set(),active,id=>id==='page-b')).toEqual(['B'])
 expect(backgroundBrowserContexts({},new Set(['B']),active,()=>false)).toEqual([])
})
