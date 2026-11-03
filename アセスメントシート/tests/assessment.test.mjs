import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const html = await readFile(new URL('../app.html', import.meta.url), 'utf8');

test('HTML内のJavaScriptを解析できる', () => {
  for (const match of html.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
  assert.match(html, /portal-auth-guard\.js/);
});

const browserModule = process.env.ASSESSMENT_PLAYWRIGHT;
const browserPath = process.env.ASSESSMENT_BROWSER;
test('架空データの217項目と旧形式・日次バックアップ', { skip: !browserModule || !browserPath, timeout: 60000 }, async () => {
  const { chromium } = await import(pathToFileURL(browserModule));
  const browser = await chromium.launch({ headless: true, executablePath: browserPath });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://**', route => route.abort());
    const oldRecord = { id:'synthetic-old-record',title:'架空の記録',createdAt:'2025-01-01T00:00:00.000Z',updatedAt:'2025-01-01T00:00:00.000Z',fields:{1:'架空の氏名',6:'架空の住所',159:'旧形式のまとめ', 'genogram-url':'https://example.invalid/'} };
    await page.addInitScript(record => { if(!localStorage.getItem('assessment-html-local-v1')) localStorage.setItem('assessment-html-local-v1',JSON.stringify([record])); }, oldRecord);
    await page.goto(new URL('../app.html', import.meta.url).href);
    await page.locator('#open-sheet').click();
    await page.waitForSelector('#docs .reference-no1');
    assert.equal(await page.locator('#docs [data-field-id="1"]').first().inputValue(), '架空の氏名');
    assert.equal(await page.locator('#docs [data-field-id="address-combined"]').inputValue(), '架空の住所');
    await page.locator('#tabs [data-tab="create"]').click();
    const values = Array.from({length:217}, (_,i) => `架空の値${i+1}`);
    values[11] = '記載なし';
    await page.locator('#paste-text').fill(values.slice(0,216).join('\n'));
    await page.locator('#apply').click();
    assert.match(await page.locator('#message span').textContent(), /217行/);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('assessment-html-local-v1'))[0].fields[1]),'架空の氏名');
    await page.locator('#paste-text').fill(values.join('\n'));
    await page.locator('#apply').click();
    await page.waitForSelector('#docs .reference-no1');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('assessment-html-local-v1'))[0]);
    for (let i=1;i<=217;i++) assert.equal(saved.fields[i], i===12?'':`架空の値${i}`, `転記番号 ${i}`);
    assert.equal(saved.fields['genogram-url'], 'https://example.invalid/');
    assert.equal(saved.fields['address-combined'], values[5]);
    assert.equal(saved.fields.household, values[159]);
    assert.equal(await page.locator('#docs textarea[data-field-id="household"]:visible').inputValue(), values[159]);
    for (const [tab,start,end] of [['sheet',1,28],['sheet2',29,99],['sheet3',100,159],['sheet3',161,166],['discharge',167,185],['admission',186,211],['discharge',212,217]]) {
      await page.locator(`#tabs [data-tab="${tab}"]`).click();
      for (let i=start;i<=end;i++) {
        const id = i===6?'address-combined':i===160?'household':String(i);
        const target = page.locator(`#docs textarea[data-field-id="${id}"]:visible`).first();
        assert.equal(await target.count(), 1, `${tab} の転記先 ${i}`);
        assert.equal(await target.inputValue(), i===12?'':`架空の値${i}`, `${tab} の転記内容 ${i}`);
      }
    }
    await page.locator('#tabs [data-tab="sheet3"]').click();
    const summary=page.locator('#docs textarea[data-field-id="159"]:visible');
    await summary.fill('あ'.repeat(251));
    assert.match(await page.locator('.summary-length-warning:visible').textContent(), /今251字/);
    await summary.fill('あ'.repeat(250));
    assert.equal(await page.locator('.summary-length-warning:visible').count(),0);
    const field=page.locator('#docs textarea[data-field-id="100"]:visible');
    await field.fill('最初');
    const baseHeight=await field.evaluate(el=>el.getBoundingClientRect().height);
    await field.fill('一行\n二行\n三行\n四行\n五行\n六行\n七行');
    const expandedHeight=await field.evaluate(el=>el.getBoundingClientRect().height);
    await field.fill('最初');
    const reducedHeight=await field.evaluate(el=>el.getBoundingClientRect().height);
    assert.ok(expandedHeight>baseHeight, `入力欄が広がる: ${baseHeight}, ${expandedHeight}`);
    assert.ok(reducedHeight<=baseHeight+2, `入力欄が元に戻る: ${baseHeight}, ${reducedHeight}`);
    await field.focus();
    await page.locator('.format-toolbar [data-action="bold"]').click();
    assert.equal(await field.evaluate(el=>getComputedStyle(el).fontWeight), '700');
    await page.locator('.format-toolbar [data-action="undo"]').click();
    assert.equal(await field.evaluate(el=>getComputedStyle(el).fontWeight), '400');
    await page.locator('.format-toolbar [data-action="hide"]').click();
    assert.equal(await field.isVisible(),false);
    await page.emulateMedia({media:'print'});
    assert.equal(await field.isVisible(),false);
    await page.emulateMedia({media:'screen'});
    await page.locator('.format-toolbar [data-restore]').selectOption('100');
    assert.equal(await field.isVisible(),true);
    for(const width of [375,1440]) {
      await page.setViewportSize({width,height:900});
      const layout=await page.evaluate(()=>({viewport:innerWidth, document:document.documentElement.scrollWidth, toolbar:document.querySelector('.format-toolbar').getBoundingClientRect().width}));
      assert.ok(layout.document<=layout.viewport+1, `画面幅 ${width} でページがはみ出さない`);
      assert.ok(layout.toolbar>0 && layout.toolbar<=width, `画面幅 ${width} のツールバー`);
    }
    const backup = await page.evaluate(async () => { const records=JSON.parse(localStorage.getItem('assessment-html-local-v1')); await window.AssessmentSheetBackup.save({records,active:records[0].id}); return window.AssessmentSheetBackup.restore(); });
    assert.equal(backup.records[0].fields[217], '架空の値217');
    await Promise.all([page.waitForEvent('load'),page.locator('#file-input').setInputFiles({name:'synthetic-legacy.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(oldRecord))})]);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('assessment-html-local-v1')).length),2);
    const restored={app:'assessment-sheet',format:'backup',version:1,data:{records:[oldRecord],active:oldRecord.id}};
    await page.locator('#file-input').setInputFiles({name:'synthetic-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(restored))});
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('assessment-html-local-v1'))[0].fields[1]==='架空の氏名');
    assert.deepEqual(errors, []);
    await context.close();
    const freshContext=await browser.newContext();
    const freshPage=await freshContext.newPage();
    await freshPage.route('https://**',route=>route.abort());
    await freshPage.goto(new URL('../app.html', import.meta.url).href);
    await freshPage.locator('#open-sheet').click();
    await freshPage.locator('#docs textarea[data-field-id="1"]').first().fill('初回の架空氏名');
    await freshPage.reload();
    await freshPage.locator('#open-sheet').click();
    assert.equal(await freshPage.locator('#docs textarea[data-field-id="1"]').first().inputValue(),'初回の架空氏名');
    await freshContext.close();
  } finally { await browser.close(); }
});
