import { chromium } from 'playwright-core'
(async () => {
 const browser=await chromium.launch({executablePath:process.env.JAVIS_FIXTURE_CHROMIUM,headless:true});
 try {
 const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1,colorScheme:'dark',locale:'en-US'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
   const subscription=()=>()=>{};
 let sourceText='<h1>Source fixture</h1>';let pendingText='';
 const fileCalls=async(method,input)=>{if(method==='browser.annotations.list')return [];if(method!=='browser.host.call')throw new Error('Unknown fixture transport');const params=input.params; if(input.method==='files.stat')return {size:sourceText.length,mtimeMs:1};if(input.method==='files.readChunk')return {contentBase64:btoa(sourceText),bytesRead:sourceText.length,eof:true};if(input.method==='files.writeBase64Chunk'){pendingText=atob(params.contentBase64);return {written:true}}if(input.method==='files.commitUpload'){sourceText=pendingText;return {committed:true}}throw new Error('Unknown fixture file operation')};
   window.api={
     javisBrowser:{bootstrap:async()=>({context:'fixture-context',generation:1,contexts:[{id:'fixture-context',root:'/tmp',owner:{kind:'local'}}],host:'local',settings:{theme:'dark',uiLanguage:'en'},ui:{contextualToursAutoEligible:false}}),persistWorkspace:async(session)=>{window.fixtureSavedSession=session},call:fileCalls,onEvent:subscription},
     browser:new Proxy({sessionListProfiles:async()=>[{id:'default',label:'Default',scope:'default'}],notifyActiveTabChanged:async()=>{},reportViewportScrollState:()=>{},getGuestPreloadPath:async()=>'',getPageSiteDisplay:async()=>null,extensionsList:async()=>({active:false,extensions:[]})},{get(target,key){if(key in target)return target[key];if(String(key).startsWith('on'))return subscription;return async()=>{throw new Error('Fixture browser method: '+String(key))}}}),
     ui:new Proxy({set:async()=>({}),get:async()=>({}),writeClipboardText:async()=>{}},{get(target,key){if(key in target)return target[key];if(String(key).startsWith('on'))return subscription;return undefined}}),
     app:{getLocale:async()=> 'en-US',getVersion:async()=> '0.2.0'},
     browserPasswords:new Proxy({getStatus:async()=>null,list:async()=>[],listNever:async()=>[]},{get(target,key){return key in target ? target[key] : String(key).startsWith('on') ? subscription : undefined}}),settings:{get:async()=>({theme:'dark',uiLanguage:'en'}),set:async(patch)=>patch,onChanged:subscription},
     runtime:{onEvent:subscription,onBrowserDriverChanged:subscription,getBrowserDrivers:async()=>[],onBrowserRemoteViewersChanged:subscription,getBrowserRemoteViewerPages:async()=>[],onClientHostedBrowserRowsChanged:subscription,getClientHostedBrowserRows:async()=>[]},keybindings:{get:async()=>({overrides:{}}),onChanged:subscription},
     runtimeEnvironments:{onChanged:subscription,onEvent:subscription},
     plugins:{listLanguagePacks:async()=>[]}
   }
 });
 await page.goto(process.env.JAVIS_FIXTURE_URL ?? 'http://127.0.0.1:4179');
 await page.locator('input').first().waitFor({state:'visible'});
 await page.evaluate(() => document.fonts.ready);
 await page.evaluate(async (base) => { const action=await import(`/@fs/${base}/src/browser/source/renderer/src/components/browser-pane/workspace-doc/doc-preview-document-actions.ts`);action.openDocPreviewSource({filePath:'/tmp/example.html',relativePath:'example.html',worktreeId:'fixture-context',runtimeEnvironmentId:null,externalSshTargetId:null}) },process.cwd());
 await page.getByRole('textbox',{name:'Editor content'}).waitFor({state:'visible'});
 const tab=page.getByText('example.html',{exact:true}).first();const box=await tab.boundingBox();if(!box)throw new Error('Source tab not visible');
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+8,box.y+box.height/2+8,{steps:4});await page.mouse.move(720,878,{steps:18});await page.mouse.up();
 await page.waitForFunction(()=>window.fixtureSavedSession?.tabGroupLayouts?.['fixture-context']?.type==='split');
 if(await page.evaluate(()=>window.fixtureSavedSession.tabGroupLayouts['fixture-context'].direction)!=='vertical')throw new Error('Body edge drop did not create the requested split');
 await page.getByRole('button',{name:'Browser settings',exact:true}).click();
 const search=page.getByRole('textbox',{name:'Search browser settings'});await search.fill('profiles');
 if(await search.inputValue()!=='profiles')throw new Error('Settings typing did not retain its controlled value');
 await search.fill('');
 await page.getByRole('button',{name:'Back',exact:true}).click();
 await page.getByRole('button',{name:'Floating workspace',exact:true}).click();
 await page.getByRole('button',{name:'Maximize floating workspace',exact:true}).waitFor({state:'visible'});
 await page.screenshot({path:process.env.JAVIS_FIXTURE_SCREENSHOT ?? '/tmp/javis-browser-renderer-fixture.png'});
 if(errors.length)throw new Error(errors.join('; '));
 console.log(JSON.stringify({title:await page.title(),errors,body:'Browser chrome fixture',addressInputs:await page.locator('input').count()}));
 } finally { await browser.close(); }
})().catch(e=>{console.error(e.message);process.exitCode=1})
