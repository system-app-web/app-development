import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const browserModule=process.env.ASSESSMENT_PLAYWRIGHT,browserPath=process.env.ASSESSMENT_BROWSER;
const manualIds=['reason','assessment-type','created-date','reception-person','reception-method','family-status','kp','family-age','cohabitation','services','housing-aircon','admission-note','discharge-stay','discharge-wishes','medical-care','nursing','rehabilitation','discharge-notes','face-age','face-public','face-family-2','face-family-relation-2','face-family-3','face-family-relation-3','face-contact-2','face-contact-relation-2','face-contact-phone-2','face-contact-3','face-contact-relation-3','face-contact-phone-3','face-care-manager','face-note'];
test('トップから資料を入れ、作成中・シート確認・保存へ進む', {skip:!browserModule||!browserPath,timeout:60000},async()=>{
  const {chromium}=await import(pathToFileURL(browserModule)),browser=await chromium.launch({headless:true,executablePath:browserPath});
  try{
    const context=await browser.newContext(),page=await context.newPage();await page.route('https://**',route=>route.abort());
    await page.addInitScript(()=>{const old={id:'synthetic-old',title:'架空の記録',createdAt:'2025-01-01T00:00:00.000Z',updatedAt:'2025-01-01T00:00:00.000Z',fields:{1:'架空の以前の利用者',6:'架空の住所'}};localStorage.setItem('assessment-html-local-v1',JSON.stringify([old]));localStorage.setItem('ktm-portal:device-id','synthetic-device');localStorage.setItem('ktm-portal:device-session',JSON.stringify({accessToken:'synthetic-token'}));const original=window.fetch;window.fetch=(url,options)=>{if(url!=='/api/generate')return original(url,options);window.__flowRequest=JSON.parse(options.body);return new Promise(resolve=>{window.__finishFlow=()=>{const lines=Array(217).fill('記載なし');lines[0]='架空の新しい利用者';resolve(new Response(JSON.stringify({text:lines.join('\n')}),{status:200,headers:{'Content-Type':'application/json'}}))}})}});
    let confirmation='';page.on('dialog',dialog=>{confirmation=dialog.message();return dialog.accept()});await page.goto(new URL('../app.html',import.meta.url).href);
    assert.equal(await page.evaluate(()=>document.body.dataset.flow),'home');assert.ok(await page.locator('.flow-drop').isVisible());
    await page.locator('.user-record').click();await page.waitForFunction(()=>document.body.dataset.flow==='editor');assert.equal(await page.locator('#docs textarea[data-field-id="1"]').first().inputValue(),'架空の以前の利用者');
    assert.equal(await page.locator('.format-toolbar').isVisible(),false);await page.locator('.flow-edit').click();assert.equal(await page.locator('.format-toolbar').isVisible(),true);await page.locator('.flow-edit').click();
    await page.locator('.flow-top-link').click();
    await page.locator('.flow-drop').evaluate(el=>{const dt=new DataTransfer();dt.items.add(new File(['架空資料'],'認定調査票.pdf',{type:'application/pdf'}));el.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt}))});
    await page.waitForFunction(()=>document.body.dataset.flow==='working'&&window.__flowRequest);assert.match(confirmation,/認定調査票\.pdf/);assert.match(confirmation,/新しいシート/);assert.equal((await page.evaluate(()=>window.__flowRequest)).documents[0].category,'認定調査票');
    await page.evaluate(()=>window.__finishFlow());await page.waitForFunction(()=>document.body.dataset.flow==='editor');
    const records=await page.evaluate(()=>JSON.parse(localStorage.getItem('assessment-html-local-v1')));assert.equal(records.length,2);assert.equal(records.find(x=>x.id==='synthetic-old').fields[1],'架空の以前の利用者');assert.equal(records[0].fields[1],'架空の新しい利用者');
    const before=Number(await page.locator('.flow-review b').textContent());assert.ok(before>216,'番号のない黄色の入力欄も含める');await page.locator('.flow-review button').click();await page.waitForFunction(()=>document.activeElement?.dataset.fieldId==='2');
    await page.locator('#docs textarea[data-field-id="2"]:visible').fill('カクウ');await page.waitForFunction(expected=>Number(document.querySelector('.flow-review b').textContent)===expected,before-1);
    await page.locator('.flow-actions summary').click();for(const id of ['print','excel-export','drive-settings','save','import','duplicate'])assert.ok(await page.locator('#'+id).isVisible(),id+' を利用できる');
    await context.close();
  }finally{await browser.close()}
});

test('黄色の217項目へ各シートをまたいで移動し、白や非表示を数えない', {skip:!browserModule||!browserPath,timeout:180000},async()=>{
  const {chromium}=await import(pathToFileURL(browserModule)),browser=await chromium.launch({headless:true,executablePath:browserPath});
  try{const context=await browser.newContext(),page=await context.newPage();await page.route('https://**',route=>route.abort());
    const record={id:'synthetic-map',title:'架空の記録',createdAt:'2025-01-01T00:00:00Z',updatedAt:'2025-01-01T00:00:00Z',fields:Object.fromEntries(Array.from({length:217},(_,i)=>[String(i+1),'架空の値']))};for(const id of manualIds)record.fields[id]='架空の値';record.fields['address-combined']='架空の住所';record.fields.household='架空の世帯';
    await page.addInitScript(value=>localStorage.setItem('assessment-html-local-v1',JSON.stringify([value])),record);await page.goto(new URL('../app.html',import.meta.url).href);await page.locator('.user-record').click();await page.waitForFunction(()=>document.body.dataset.flow==='editor');
    for(const id of Array.from({length:217},(_,i)=>i+1)){
      await page.evaluate(id=>{const key='assessment-html-local-v1',records=JSON.parse(localStorage.getItem(key));for(let n=1;n<=217;n++)records[0].fields[n]='架空の値';records[0].fields['address-combined']='架空の住所';records[0].fields.household='架空の世帯';records[0].fields[id]='';if(id===6)records[0].fields['address-combined']='';if(id===160)records[0].fields.household='';localStorage.setItem(key,JSON.stringify(records))},id);
      await page.locator('.flow-review button').click();const field=id===6?'address-combined':id===160?'household':String(id);
      await page.waitForFunction(field=>document.activeElement?.dataset.fieldId===field,field,{timeout:7000});
    }
    for(const id of manualIds){await page.evaluate(({id,manualIds})=>{const key='assessment-html-local-v1',records=JSON.parse(localStorage.getItem(key));for(let n=1;n<=217;n++)records[0].fields[n]='架空の値';records[0].fields['address-combined']='架空の住所';records[0].fields.household='架空の世帯';for(const field of manualIds)records[0].fields[field]='架空の値';records[0].fields[id]='';localStorage.setItem(key,JSON.stringify(records))},{id,manualIds});await page.locator('.flow-review button').click();await page.waitForFunction(id=>document.activeElement?.dataset.fieldId===id,id,{timeout:7000})}
    await page.evaluate(manualIds=>{const key='assessment-html-local-v1',records=JSON.parse(localStorage.getItem(key));for(const field of manualIds)records[0].fields[field]='架空の値';records[0].fields[6]='';records[0].fields['address-combined']='';records[0].fields[160]='';records[0].fields.household='';records[0].formats={'address-combined':{background:'#ffffff'}};records[0].hiddenFields=['household'];localStorage.setItem(key,JSON.stringify(records))},manualIds);
    await page.locator('.flow-review button').click();await page.waitForFunction(()=>document.querySelector('.flow-review b').textContent==='0');
    await page.locator('.flow-top-link').click();await page.locator('[data-flow-paste]').click();
    await page.locator('#paste-text').fill(Array.from({length:217},(_,i)=>`新しい架空の値${i+1}`).join('\n'));
    page.once('dialog',dialog=>dialog.dismiss());await page.locator('#apply').click();
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('assessment-html-local-v1'))[0].fields[1]),'架空の値','上書きをキャンセルすると元の値を保持');
    await context.close();
  }finally{await browser.close()}
});
