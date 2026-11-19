import { chromium } from 'playwright-core'
(async () => {
 const browser=await chromium.launch({executablePath:process.env.JAVIS_FIXTURE_CHROMIUM,headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1,colorScheme:'dark',locale:'en-US'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
   const subscription=()=>()=>{};
   window.api={
     javisBrowser:{bootstrap:async()=>({context:'fixture-context',host:'local',settings:{theme:'dark',uiLanguage:'en'},ui:{contextualToursAutoEligible:false}}),persistWorkspace:async()=>{},call:async()=>{throw new Error('Fixture has no action transport')},onEvent:subscription},
     browser:new Proxy({sessionListProfiles:async()=>[{id:'default',label:'Default',scope:'default'}],notifyActiveTabChanged:async()=>{},getGuestPreloadPath:async()=>'',getPageSiteDisplay:async()=>null},{get(target,key){if(key in target)return target[key];if(String(key).startsWith('on'))return subscription;return async()=>{throw new Error('Fixture browser method: '+String(key))}}}),
     ui:new Proxy({set:async()=>({}),get:async()=>({}),writeClipboardText:async()=>{}},{get(target,key){if(key in target)return target[key];if(String(key).startsWith('on'))return subscription;return undefined}}),
     app:{getLocale:async()=> 'en-US',getVersion:async()=> '0.2.0'},
     settings:{get:async()=>({theme:'dark',uiLanguage:'en'}),set:async(patch)=>patch},
     runtime:{onEvent:subscription},
     runtimeEnvironments:{onChanged:subscription,onEvent:subscription},
     plugins:{listLanguagePacks:async()=>[]}
   }
 });
 await page.goto(process.env.JAVIS_FIXTURE_URL ?? 'http://127.0.0.1:4179');
 await page.locator('input').first().waitFor({state:'visible'});
 await page.evaluate(() => document.fonts.ready);
 await page.screenshot({path:process.env.JAVIS_FIXTURE_SCREENSHOT ?? '/tmp/javis-browser-renderer-fixture.png'});
 console.log(JSON.stringify({title:await page.title(),errors,body:'Browser chrome fixture',addressInputs:await page.locator('input').count()}));
 await browser.close();
})().catch(e=>{console.error(e.message);process.exitCode=1})
