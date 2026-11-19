// @vitest-environment jsdom
import {act,createElement,useLayoutEffect} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach,expect,it,vi} from 'vitest'
const fixture=vi.hoisted(()=>({browserReady:false,state:{activeWorktreeId:'A',activeView:'terminal',browserPagesByWorkspace:{browserB:[{id:'page-b',worktreeId:'B'}]},layoutByWorktree:{B:{type:'leaf',groupId:'group-b'}},unifiedTabsByWorktree:{B:[{id:'editor-view',entityId:'source-b',contentType:'editor',groupId:'group-b'},{id:'browser-view',entityId:'browser-b',contentType:'browser',groupId:'group-b'}]},groupsByWorktree:{B:[{id:'group-b',activeTabId:'editor-view',tabOrder:['editor-view','browser-view']}]},openFiles:[{id:'source-b',worktreeId:'B'}]}}))
vi.mock('../../../src/browser/source/renderer/src/store',()=>({useAppStore:(select:(state:typeof fixture.state)=>unknown)=>select(fixture.state)}))
vi.mock('../../../src/browser/source/renderer/src/components/terminal/background-terminal-worktree-mount',()=>({takeAllPendingBackgroundTerminalWorktreeMounts:()=>[{worktreeId:'B'}],subscribeBackgroundTerminalWorktreeMountRequests:()=>()=>{}}))
vi.mock('../../../src/browser/source/renderer/src/components/browser-pane/host-guest/browser-guest-paint-retention',()=>({browserPageNeedsPaintRetention:()=>true,onBrowserGuestPaintRetentionChange:()=>()=>{}}))
vi.mock('../../../src/browser/renderer/browser-workspace-app',()=>({BrowserLayout:()=>{
 useLayoutEffect(()=>{const editor=document.createElement('textarea');document.body.append(editor);editor.focus();return()=>editor.remove()},[])
 return null
}}))
vi.mock('../../../src/browser/source/renderer/src/components/browser-pane/assemble-chrome/BrowserPaneOverlayLayer',()=>({default:()=>{useLayoutEffect(()=>{fixture.browserReady=true},[]);return null}}))
import {BackgroundBrowserContexts} from '../../../src/browser/renderer/background-browser-contexts'
afterEach(()=>{document.body.replaceChildren();vi.unstubAllGlobals()})
it('admits B browser painting without mounting its selected editor or moving A keyboard focus',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 const foreground=document.createElement('input'),host=document.createElement('div');document.body.append(foreground,host);foreground.focus()
 const root=createRoot(host)
 try {
   await act(async()=>root.render(createElement(BackgroundBrowserContexts)))
   expect(fixture.browserReady).toBe(true)
   expect(document.activeElement).toBe(foreground)
   expect(fixture.state.activeWorktreeId).toBe('A')
 } finally {await act(async()=>root.unmount())}
})
