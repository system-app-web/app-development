import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const html=await readFile(new URL('../app.html',import.meta.url),'utf8');
const script=html.match(/<script id="assessment-auth-verification">([\s\S]*?)<\/script>/)?.[1];
assert.ok(script);

function harness({protocol='https:',ready=true,guardFailed=false,valid=true,networkFailure=false,delay,missingSession=false}={}){
  const state={locked:true,redirect:'',message:'',requests:0};
  const data=new Map([['ktm-portal:device-id','架空端末'],['ktm-portal:device-session',JSON.stringify({accessToken:'synthetic-token'})]]);
  if(missingSession)data.delete('ktm-portal:device-session');
  const status={replaceChildren(){state.message=''},append(text){state.message=text.textContent}};
  const document={documentElement:{classList:{remove(name){if(name==='assessment-auth-locked')state.locked=false}}},getElementById:()=>status,createElement:()=>({textContent:'',onclick:null}),addEventListener:(name,fn)=>{state.listener=fn}};
  const window={ktmAuthReady:ready,assessmentGuardLoadFailed:guardFailed};
  const location={protocol,href:'https://assessment-sheet-app.vercel.app/',replace(value){state.redirect=value},reload(){}};
  const localStorage={getItem:key=>data.get(key)||null,removeItem:key=>data.delete(key)};
  const fetch=async()=>{state.requests++;if(delay)await delay;if(networkFailure)throw Error('offline');return {ok:true,json:async()=>({ok:true,valid})}};
  const context={document,window,location,localStorage,fetch,AbortController,setTimeout:()=>1,clearTimeout:()=>{},encodeURIComponent};
  vm.runInNewContext(script,context);return {state,data};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('Web版は認証確認を終えるまで画面を閉じ、有効な端末だけ開く',async()=>{
  let resolve;const delay=new Promise(done=>resolve=done),{state}=harness({delay});
  assert.equal(state.locked,true);resolve();await settle();assert.equal(state.locked,false);assert.equal(state.requests,1);
});
test('無効な端末は閉じたままポータルへ戻し、通信失敗では閉じたまま再確認を案内する',async()=>{
  const missing=harness({missingSession:true});await settle();assert.equal(missing.state.locked,true);assert.match(missing.state.redirect,/^https:\/\/app-development-gray\.vercel\.app\//);assert.equal(missing.state.requests,0);
  const invalid=harness({valid:false});await settle();assert.equal(invalid.state.locked,true);assert.match(invalid.state.redirect,/^https:\/\/app-development-gray\.vercel\.app\//);assert.equal(invalid.data.has('ktm-portal:device-session'),false);
  const offline=harness({networkFailure:true});await settle();assert.equal(offline.state.locked,true);assert.match(offline.state.message,/ログインを確認できません/);assert.equal(offline.data.has('ktm-portal:device-session'),true);
});
test('共通ガードを読み込めないときは閉じたまま、ローカルHTMLは従来どおり開く',()=>{
  const blocked=harness({guardFailed:true,ready:false});assert.equal(blocked.state.locked,true);assert.match(blocked.state.message,/ログインを確認できません/);
  const local=harness({protocol:'file:'});assert.equal(local.state.locked,false);assert.equal(local.state.requests,0);
  assert.match(html,/<html lang="ja" class="assessment-auth-locked">/);assert.match(html,/assessment-auth-locked body\{visibility:hidden!important\}/);
});

test('実際の画面でも認証中と通信失敗では内容が見えない', {skip:!process.env.ASSESSMENT_PLAYWRIGHT||!process.env.ASSESSMENT_BROWSER,timeout:60000},async()=>{
  const {chromium}=await import(pathToFileURL(process.env.ASSESSMENT_PLAYWRIGHT));
  const guard=await readFile(new URL('../../WEBアプリポータル/public/portal-auth-guard.js',import.meta.url),'utf8');
  const browser=await chromium.launch({headless:true,executablePath:process.env.ASSESSMENT_BROWSER});
  try{
    for(const offline of [false,true]){
      const context=await browser.newContext();const page=await context.newPage();let release;const wait=new Promise(resolve=>release=resolve);
      await page.addInitScript(()=>{if(location.hostname==='assessment-sheet-app.vercel.app'){localStorage.setItem('ktm-portal:device-id','synthetic-device');localStorage.setItem('ktm-portal:device-session',JSON.stringify({accessToken:'synthetic-token'}))}});
      await page.route('**/*',async route=>{const url=route.request().url();if(url==='https://assessment-sheet-app.vercel.app/')return route.fulfill({status:200,contentType:'text/html',body:html});if(url==='https://app-development-gray.vercel.app/portal-auth-guard.js')return route.fulfill({status:200,contentType:'text/javascript',body:guard});if(url.startsWith('https://script.google.com/')){await wait;if(offline)return route.abort();return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({ok:true,valid:true})})}return route.abort()});
      await page.goto('https://assessment-sheet-app.vercel.app/',{waitUntil:'domcontentloaded'});
      for(const width of [375,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.locator('.app').isVisible(),false);assert.equal(await page.locator('#assessment-auth-status').isVisible(),true)}
      release();if(offline){await page.waitForFunction(()=>document.querySelector('#assessment-auth-status').textContent.includes('ログインを確認できません'));assert.equal(await page.locator('.app').isVisible(),false)}else{await page.waitForFunction(()=>!document.documentElement.classList.contains('assessment-auth-locked'));assert.equal(await page.locator('.app').isVisible(),true)}
      await context.close();
    }
  }finally{await browser.close()}
});
