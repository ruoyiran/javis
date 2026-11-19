import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { build, preview } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { chromium } from 'playwright-core'

const reference = process.argv[2]
if (!reference) throw new Error('Pass a read-only Orca checkout path as the first argument')
const baseline = '729f757b592244176420a86114c1ea23911eeeba'
const temporary = await mkdtemp(join(tmpdir(), 'javis-surface-comparison-'))
const artifacts = resolve(process.env.JAVIS_TEST_ARTIFACT_DIRECTORY ?? '.superpowers/sdd/2026-11-19-orca-browser-parity/visual-qa')
await mkdir(artifacts, { recursive: true })
const archive = join(temporary, 'source.tar')
await writeFile(archive, execFileSync('git', ['-C', resolve(reference), 'archive', baseline, 'src/renderer/src', 'src/shared', 'resources'], { maxBuffer: 512 * 1024 * 1024 }))
const extracted = join(temporary, 'reference')
await mkdir(extracted)
execFileSync('tar', ['-xf', archive, '-C', extracted])
await symlink(resolve('node_modules'), join(temporary, 'node_modules'), 'dir')
const records = []
let browser
const servers = []
try {
  browser = await chromium.launch({ executablePath: process.env.JAVIS_TEST_CHROMIUM ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
  for (const [side, source] of [['source', join(extracted, 'src')], ['javis', resolve('src/browser/source')]]) {
    const root = join(temporary, side)
    await mkdir(root)
    const renderer = join(source, 'renderer/src')
    const shared = join(source, 'shared')
    const locale = JSON.parse(await readFile(join(renderer, 'i18n/locales/en.json'), 'utf8'))
    await writeFile(join(root, 'locale.json'), JSON.stringify(locale))
    await writeFile(join(root, 'host-fixture.ts'), `
import locale from './locale.json'
const noop=()=>{}; const state={settings:{theme:'dark',uiLanguage:'en'},settingsSearchQuery:'',browserUrlHistory:[],groupsByWorktree:{},persistedUIReady:true,browserImportHintHidden:true,detectedBrowsers:[],detectedBrowsersLoaded:true,browserSessionImportState:{},keybindings:{overrides:{}},repos:[],folderWorkspaces:[],worktreesByRepo:{},runtimeEnvironments:[],runtimeStatusByEnvironmentId:{},browserSessionProfiles:[{id:'default',label:'Default',scope:'default'}],workspacePortScansByKey:{},activeView:'terminal',projectGroups:[],featureInteractions:{}, removeBrowserHistoryEntry:noop,restoreBrowserHistory:noop};
export const useAppStore=Object.assign((selector:any)=>selector(state),{getState:()=>state,setState:noop,subscribe:()=>noop});
export function translate(key:string,fallback:any,params:any={}){let value:any=key.split('.').reduce((obj:any,part:string)=>obj?.[part],locale);if(typeof value!=='string')value=typeof fallback==='string'?fallback:(fallback?.defaultValue??key);return value.replace(/{{([^}]+)}}/g,(_:any,k:string)=>String(params[k]??''))}
export const i18n={t:translate,language:'en',on:noop,off:noop,dir:()=> 'ltr',isInitialized:true}; export const javisContext=()=>null; export const javisContextHost=()=>null; export const useTranslate=()=>translate; export const useUiLanguageRevision=()=>0; export const useRepoById=()=>null; export const useWorktreeById=()=>null; export const useWorktreeRuntimeTarget=()=>null; export const useJavisContexts=(select:any)=>select({contexts:{}}); export const useBrowserNewTabLinkedItems=()=>[]; export const useBrowserNewTabServers=()=>({own:[],others:[]}); export const dispatchWorkspaceTabCommand=noop;
`)
    await writeFile(join(root, 'index.html'), '<!doctype html><html class="dark" lang="en"><head><meta charset="UTF-8"></head><body style="margin:0"><div id="root"></div><script type="module" src="/fixture.tsx"></script></body></html>')
    await writeFile(join(root, 'fixture.css'), `@import ${JSON.stringify(join(renderer, 'assets/main.css'))};\n@source ${JSON.stringify(renderer)};\n@source "./fixture.tsx";\n`)
    await writeFile(join(root, 'fixture.tsx'), `
import React from 'react'; import {createRoot} from 'react-dom/client';
import './fixture.css';
import {BrowserChromeToolbar} from ${JSON.stringify(join(renderer, 'components/browser-pane/assemble-chrome/browser-chrome-toolbar.tsx'))};
import {BrowserNewTabPage} from ${JSON.stringify(join(renderer, 'components/browser-pane/new-tab/BrowserNewTabPage.tsx'))};
import {BrowserHomePageSetting} from ${JSON.stringify(join(renderer, 'components/settings/browser/BrowserHomePageSetting.tsx'))};
import {BrowserSearchEngineSetting} from ${JSON.stringify(join(renderer, 'components/settings/browser/BrowserSearchEngineSetting.tsx'))};
import {BrowserDefaultZoomSetting} from ${JSON.stringify(join(renderer, 'components/settings/browser/BrowserDefaultZoomSetting.tsx'))};
import {SettingsGroup} from ${JSON.stringify(join(renderer, 'components/settings/section-layout/SettingsGroup.tsx'))};
import {Input} from ${JSON.stringify(join(renderer, 'components/ui/input.tsx'))};
import {Button} from ${JSON.stringify(join(renderer, 'components/ui/button.tsx'))};
import {TooltipProvider} from ${JSON.stringify(join(renderer, 'components/ui/tooltip.tsx'))};
import {Ellipsis} from 'lucide-react';
const noop=()=>{}; const surface=new URLSearchParams(location.search).get('surface');
const toolbar=<BrowserChromeToolbar controls={{canGoBack:true,canGoForward:false,goBack:noop,goForward:noop,reload:noop,navigate:noop}} addressSlot={<Input value="https://fixture.test/" readOnly aria-label="Fixture address"/>} elementTools={{activeIntent:null,onStartIntent:noop,disabled:false,grabShortcutLabel:'⌘⇧G',annotateShortcutLabel:'⌘⇧A',annotationCount:0}} markup={{active:false,disabled:false,onToggle:noop,canShowDiscoveryHint:false}} overflowMenu={({triggerRef})=><Button ref={triggerRef} size="icon" variant="ghost" aria-label="Browser menu"><Ellipsis/></Button>} closeTabOwner={{worktreeId:'fixture-no-workspace',browserPageId:'fixture-page'}}/>;
const content=surface==='settings'?<div style={{width:720,margin:'32px auto'}}><SettingsGroup title="Browser"><BrowserHomePageSetting value="https://fixture.test/" onChange={noop} onSave={noop}/><BrowserSearchEngineSetting selectedSearchEngine="google" onSearchEngineChange={noop}/><BrowserDefaultZoomSetting value={0} onChange={noop}/></SettingsGroup></div>:surface==='newtab'?<div style={{position:'relative',height:900}}><BrowserNewTabPage worktreeId="fixture-no-workspace" onOpenUrl={noop}/></div>:toolbar;
createRoot(document.getElementById('root')!).render(<TooltipProvider><div data-fixture-surface={surface} className="bg-background text-foreground" style={{width:1440,minHeight:900}}>{content}</div></TooltipProvider>);
`)
    const hostFixture = join(root, 'host-fixture.ts')
    const boundaryFiles = /\/(?:store\/index|i18n\/(?:use-translate|i18n|use-ui-language-revision)|store\/repos\/use-repository-catalog|store\/workspaces\/selection\/use-selected-worktree|store\/workspaces\/javis-context-catalog|runtime\/rpc\/targets\/use-worktree-runtime-target|components\/browser-pane\/new-tab\/(?:use-browser-new-tab-linked-items|use-browser-new-tab-servers)|lib\/workspace\/tabs\/workspace-tab-commands)\.(?:ts|tsx)$/
    const configuration = { configFile: false, root, logLevel: 'error', plugins: [{ name: 'qa-host-boundaries', enforce: 'pre', resolveId(id, importer) {
      const candidate = id.startsWith('@/') ? join(renderer, id.slice(2)) : importer && id.startsWith('.') ? resolve(dirname(importer), id) : id
      if (candidate === join(renderer, 'store') || boundaryFiles.test(candidate) || boundaryFiles.test(`${candidate}.ts`)) return hostFixture
    } }, react(), tailwind()], resolve: { alias: { '@': renderer, '@renderer': renderer, '@shared': shared } }, optimizeDeps: { noDiscovery: true, include: ['react','react-dom/client','react/jsx-runtime','lucide-react','radix-ui','sonner','zustand','clsx','tailwind-merge','class-variance-authority'] }, server: { host: '127.0.0.1', port: 0, fs: { allow: [temporary, process.cwd()] } }, define: { ORCA_BUILD_COMMIT: JSON.stringify(baseline), ORCA_BUILD_IDENTITY: 'null', ORCA_POSTHOG_WRITE_KEY: 'null', ORCA_DIAGNOSTICS_TOKEN_URL: 'null' }, build: { outDir: join(root, 'dist'), emptyOutDir: true, target: 'es2022' } }
    await build(configuration)
    const previewServer = await preview({ configFile: false, root, logLevel: 'error', build: configuration.build, preview: { host: '127.0.0.1', port: 0 } })
    const server = { httpServer: previewServer.httpServer, close: () => new Promise(resolve => previewServer.httpServer.close(resolve)) }; servers.push(server)
    const port = server.httpServer.address().port
    for (const surface of ['toolbar', 'newtab', 'settings']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark', locale: 'en-US', reducedMotion: 'reduce' })
      page.setDefaultTimeout(10000); const errors = []; page.on('pageerror', error => errors.push(error.message.split('\n')[0]))
      await page.addInitScript(() => { const noop=()=>{}; window.api={ui:{recordFeatureInteraction:async()=>true},app:{getLocale:async()=> 'en-US'},plugins:{listLanguagePacks:async()=>[]}} })
      await page.goto(`http://127.0.0.1:${port}/?surface=${surface}`)
      try { await page.locator(`[data-fixture-surface="${surface}"]`).waitFor(); await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: join(artifacts, `${side}-${surface}.png`) }); records.push({ side, surface, rendered: true, errors }) }
      catch (error) { records.push({ side, surface, rendered: false, errors, reason: error.message.split('\n')[0] }) }
      await page.close()
    }
    await server.close()
  }
  const comparison = await browser.newPage()
  for (const surface of ['toolbar', 'newtab', 'settings']) {
    if (!records.filter(row => row.surface === surface).every(row => row.rendered)) continue
    const bytes = await Promise.all(['source', 'javis'].map(side => readFile(join(artifacts, `${side}-${surface}.png`)).then(bytes => bytes.toString('base64'))))
    const result = await comparison.evaluate(async images => {
      const load = url => new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src='data:image/png;base64,'+url})
      const [a,b]=await Promise.all(images.map(load));const canvas=document.createElement('canvas');canvas.width=a.width;canvas.height=a.height;const context=canvas.getContext('2d');context.drawImage(a,0,0);const left=context.getImageData(0,0,a.width,a.height);context.clearRect(0,0,a.width,a.height);context.drawImage(b,0,0);const right=context.getImageData(0,0,a.width,a.height);const diff=context.createImageData(a.width,a.height);let pixels=0,total=0;for(let i=0;i<left.data.length;i+=4){let changed=false;for(let c=0;c<3;c++){const delta=Math.abs(left.data[i+c]-right.data[i+c]);total+=delta;if(delta>2)changed=true}if(changed){pixels++;diff.data.set([255,0,0,255],i)}}context.putImageData(diff,0,0);return {width:a.width,height:a.height,differingPixels:pixels,differingPercent:100*pixels/(a.width*a.height),meanChannelDifference:total/(a.width*a.height*3),diff:canvas.toDataURL('image/png').split(',')[1]}
    }, bytes)
    await writeFile(join(artifacts, `${surface}-diff.png`), Buffer.from(result.diff, 'base64'))
    delete result.diff; records.push({ surface, comparison: result })
  }
  await writeFile(join(artifacts, 'results.json'), JSON.stringify({ baseline, conditions: { viewport: '1440x900', theme: 'dark', language: 'en-US', deviceScaleFactor: 1 }, scope: 'Actual chrome toolbar with supplied address slot, empty new-tab page, settings homepage/search/default zoom rows; shared controlled host boundaries; no desktop shell, webview or complete settings certification', records }, null, 2))
  console.log(JSON.stringify({ artifacts, records }))
  if (records.some(row => row.rendered === false || row.errors?.length)) process.exitCode = 1
} finally {
  await browser?.close(); await Promise.allSettled(servers.map(server => server.close())); await rm(temporary, { recursive: true, force: true })
}
