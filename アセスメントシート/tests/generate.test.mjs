import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler, { generate, GEMINI_MODEL } from '../api/generate.js';

test('架空資料と元プロンプトに165番の補足だけを追加して指定モデルへ送る', async()=>{
  const calls=[],prompt='架空のプロンプト。No.165だけは「なし」',output=Array.from({length:217},(_,i)=>`架空の値${i+1}`).join('\n');
  const fetcher=async(url,options)=>{calls.push({url,options});return calls.length===1?new Response(JSON.stringify({ok:true,valid:true})):new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:output}]}}]}))};
  const result=await generate({documents:[{category:'退院サマリー',mimeType:'application/pdf',data:'QUJDRA=='}]},{deviceId:'fake-device',accessToken:'fake-session'},{fetcher,apiKey:'fake-key',prompt});
  assert.equal(result.text,output);assert.equal(GEMINI_MODEL,'gemini-3.8-flash');assert.match(calls[1].url,/gemini-3\.8-flash:generateContent$/);
  const parts=JSON.parse(calls[1].options.body).contents[0].parts;assert.ok(parts[0].text.startsWith(prompt+'\n\n'));assert.match(parts[0].text,/情報がない場合は、推測せず「記載なし」/);assert.match(parts[0].text,/はっきり確認できる場合は「なし」/);assert.equal(parts[1].text,'【退院サマリー】');assert.equal(parts[2].inline_data.data,'QUJDRA==');
  assert.equal(calls[1].options.headers['x-goog-api-key'],'fake-key');assert.ok(!calls[1].url.includes('fake-key'));
});

test('未認証・認証エラー・不正な資料はGeminiへ送らない',async()=>{
  let count=0;const deny=async()=>{count++;return new Response(JSON.stringify({ok:true,valid:false}))};const doc={documents:[{category:'認定調査票',mimeType:'application/pdf',data:'QUJDRA=='}]},creds={deviceId:'fake',accessToken:'fake'};
  assert.equal((await generate(doc,{}, {fetcher:deny,apiKey:'fake'})).status,401);assert.equal(count,0);
  assert.equal((await generate(doc,creds,{fetcher:deny,apiKey:'fake'})).status,401);assert.equal(count,1);
  const allow=async()=>{count++;return new Response(JSON.stringify({ok:true,valid:true}))};
  assert.equal((await generate({documents:[]},creds,{fetcher:allow,apiKey:'fake'})).status,400);
  assert.equal((await generate({documents:[{category:'その他の基本情報',mimeType:'text/html',data:'QUJD'}]},creds,{fetcher:allow,apiKey:'fake'})).status,400);
  assert.equal((await generate({documents:[{category:'その他の基本情報',mimeType:'image/png',data:'A'.repeat(4*1024*1024+4)}]},creds,{fetcher:allow,apiKey:'fake'})).status,413);
  assert.equal((await generate(doc,creds,{fetcher:allow,apiKey:'fake',prompt:''})).status,503);
  assert.equal(count,5);
});

test('サーバー入口は別サイトからの要求を拒否し、回答を保存しない',async()=>{
  let code,body,headers={};const res={setHeader:(key,value)=>headers[key]=value,status:value=>{code=value;return res},json:value=>{body=value;return res}};
  await handler({method:'POST',headers:{origin:'https://other.example',host:'assessment.example'},body:{}},res);
  assert.equal(code,403);assert.equal(headers['Cache-Control'],'no-store');assert.ok(body.error);
  await handler({method:'GET',headers:{},body:{}},res);assert.equal(code,405);
});
