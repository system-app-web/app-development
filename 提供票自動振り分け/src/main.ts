import './style.css';
import './master.css';
import { analysePdfs, createProviderPdf, createZip, loadPdfFiles, renderPage } from './pdf-service';
import type { AnalysisResult, AppSavedData, DeliveryMethod, ProviderMasterEntry, SlipGroup } from './types';
import { emptySavedData, exportSavedData, importSavedData, loadSavedData, saveSavedData } from './storage';
import { requestGeminiSuggestion } from './gemini-service';

const app = document.querySelector<HTMLDivElement>('#app')!;
let result: AnalysisResult | undefined;
let busy = false;
let downloaded = 0;
let savedData: AppSavedData = emptySavedData();

const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!);
const range = (group: SlipGroup) => group.pages.length === 1 ? `P${group.pages[0].serial}` : `P${group.pages[0].serial}〜${group.pages.at(-1)!.serial}`;
const groupStatus = (group: SlipGroup) => group.needsReview && !group.reviewed ? '要確認' : '確認済み';
const download = (bytes: BlobPart, name: string) => { const url = URL.createObjectURL(new Blob([bytes])); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
const masterFor = (group: SlipGroup) => savedData.providerMaster.find((entry) => entry.providerNumber === group.providerNumber);
const providerNameFor = (group: SlipGroup) => masterFor(group)?.providerName.trim() || group.providerName.trim();
const destinationFor = (group: SlipGroup) => group.serviceCategory === '居宅療養' ? '居宅療養' : (masterFor(group)?.deliveryMethod || '要確認');
const outputBlocked = (group: SlipGroup) => !group.providerNumber || !providerNameFor(group) || !group.clientName.trim() || !group.serviceMonth.trim() || (!group.serviceCategory && !masterFor(group)?.deliveryMethod);
const persist = () => saveSavedData(savedData);
function refreshRoutingSafety() {
  result?.groups.forEach((group) => {
    group.issues = group.issues.filter((issue) => issue !== '送付方法が未設定です');
    if (!group.serviceCategory && !masterFor(group)?.deliveryMethod) group.issues.push('送付方法が未設定です');
    group.needsReview = group.issues.length > 0;
  });
}

function render() {
  const groups = result?.groups ?? [];
  const reviewCount = groups.filter((group) => group.needsReview && !group.reviewed).length + (result?.duplicateFiles.length ?? 0);
  const assigned = new Set(groups.flatMap((group) => group.pages.map((page) => `${page.sourceId}:${page.pageIndex}`))).size;
  const blockedCount = groups.filter(outputBlocked).length;
  const mixedMonths = Boolean(result && result.uniqueMonths.length !== 1);
  const canExport = Boolean(result && !busy && reviewCount === 0 && blockedCount === 0 && !mixedMonths && assigned === result.totalPages && groups.length);
  app.innerHTML = `
    <main class="shell">
      <header class="header">
        <div class="logo">提供票</div>
        <div><h1>提供票 自動振り分け</h1><p>PDF処理はこのPC内で行います。Gemini補助判定は${savedData.geminiEnabled ? '有効（実行ごとに確認）' : 'オフ'}です。</p></div>
        <span class="privacy">${savedData.geminiEnabled ? 'Gemini任意使用' : 'ローカル処理'}</span>
      </header>
      <nav class="steps" aria-label="作業手順">
        ${['PDFを入れる', '自動解析', '内容を確認', 'PDFを作成', '一括保存'].map((label, index) => `<span class="${(result ? index <= 2 : index === 0) ? 'active' : ''}"><b>${index + 1}</b>${label}</span>`).join('')}
      </nav>
      <section class="card intake">
        <div class="section-head"><div><span class="eyebrow">STEP 1</span><h2>サービス提供票PDFを入れる</h2></div>${result ? `<button class="quiet" data-action="reset">やり直す</button>` : ''}</div>
        <div class="dropzone ${busy ? 'disabled' : ''}" id="dropzone" role="button" tabindex="0">
          <div class="drop-icon">↓</div><strong>サービス提供票PDFをここにドラッグ＆ドロップ</strong><span>1つのPDF・複数PDF・フォルダ選択に対応</span>
          <button class="primary" data-action="choose" ${busy ? 'disabled' : ''}>PDFを選択</button>
          <input id="fileInput" type="file" accept="application/pdf,.pdf" multiple hidden>
          <input id="folderInput" type="file" accept="application/pdf,.pdf" webkitdirectory multiple hidden>
          <button class="link-button" data-action="folder" ${busy ? 'disabled' : ''}>フォルダを選択</button>
        </div>
        <p class="fine-print">画像だけのPDFは文字情報を抽出できないため、要確認として扱います。Geminiを使う場合も、事業所関連の文字だけを実行前の確認後に送ります。</p>
      </section>
      ${busy ? `<section class="progress card"><div><strong>${escapeHtml((app.dataset.progress || '準備中'))}</strong><span>ブラウザを閉じずにお待ちください</span></div><i></i></section>` : ''}
      ${masterArea()}
      ${result ? reviewArea(groups, reviewCount, assigned, canExport, blockedCount, mixedMonths) : welcome()}
    </main>
    <dialog id="previewDialog" class="preview-dialog"><form method="dialog"><button class="close" aria-label="閉じる">×</button></form><h3 id="previewTitle">元PDFページ</h3><canvas id="previewCanvas"></canvas><p id="previewError" class="error"></p></dialog>`;
  bindEvents();
}

function welcome() { return `<section class="guide"><article><b>1</b><span>PDFを投入</span></article><article><b>2</b><span>自動でページを解析</span></article><article><b>3</b><span>内容を確認・修正</span></article><article><b>4</b><span>事業所別に保存</span></article></section>`; }

function masterArea() {
  const entries = savedData.providerMaster;
  return `<section class="card master"><div class="section-head"><div><span class="eyebrow">事業所マスタ</span><h2>事業所番号と送付方法</h2><p>10桁の事業所番号で判定します。「居宅療養管理指導」の書類は送付方法に関係なく居宅療養へ分けます。</p></div><div class="backup-buttons"><button class="quiet" data-action="backup">バックアップ</button><button class="quiet" data-action="import">データ挿入</button><input id="backupInput" type="file" accept="application/json,.json" hidden></div></div>
    <div class="gemini-setting"><label><input type="checkbox" data-action="gemini-toggle" ${savedData.geminiEnabled ? 'checked' : ''}> Gemini補助判定を使う</label><span>要確認のページだけを、氏名等を伏せて送ります。スタッフポータルのログインを自動確認します。AIの結果だけで振り分け先は決定しません。</span></div>
    ${entries.length ? `<div class="table-wrap master-table"><table><thead><tr><th>10桁の事業所番号</th><th>事業所名（略称可）</th><th>送付方法</th><th></th></tr></thead><tbody>${entries.map((entry) => `<tr data-master="${escapeHtml(entry.providerNumber)}"><td>${escapeHtml(entry.providerNumber)}</td><td><input data-master-field="providerName" value="${escapeHtml(entry.providerName)}"></td><td><select data-master-field="deliveryMethod"><option value="" ${entry.deliveryMethod === '' ? 'selected' : ''}>未設定（要確認）</option>${(['LINE','FAX','メール','手渡し'] as DeliveryMethod[]).filter(Boolean).map((method) => `<option value="${method}" ${entry.deliveryMethod === method ? 'selected' : ''}>${method}</option>`).join('')}</select></td><td><button class="quiet" data-action="delete-master" data-number="${escapeHtml(entry.providerNumber)}">削除</button></td></tr>`).join('')}</tbody></table></div>` : `<p class="empty-master">PDFを解析すると、新しい事業所番号がここに追加されます。送付方法が未設定の書類は必ず「要確認」になります。</p>`}
  </section>`;
}

function reviewArea(groups: SlipGroup[], reviewCount: number, assigned: number, canExport: boolean, blockedCount: number, mixedMonths: boolean) {
  const providers = new Map<string, SlipGroup[]>();
  groups.forEach((group) => { const name = `${destinationFor(group)}｜${providerNameFor(group) || '事業所名未判定'}（${group.providerNumber || '番号未判定'}）`; providers.set(name, [...(providers.get(name) ?? []), group]); });
  const month = result!.uniqueMonths.length === 1 ? result!.uniqueMonths[0] : '提供年月未確定';
  return `
    <section class="summary-grid">
      <article><span>元PDF</span><b>${result!.sources.length}ファイル</b></article><article><span>総ページ数</span><b>${result!.totalPages}ページ</b></article><article><span>利用者 × 事業所</span><b>${groups.length}件</b></article><article><span>要確認</span><b class="${reviewCount ? 'danger' : 'good'}">${reviewCount}件</b></article>
    </section>
    ${result!.duplicateFiles.length ? `<section class="warning"><strong>重複して投入されたPDFがあります</strong><span>${result!.duplicateFiles.map(escapeHtml).join('、')}</span><button data-action="ack-duplicates" class="quiet">内容を確認して続行</button></section>` : ''}
    <section class="card verification">
      <div class="section-head"><div><span class="eyebrow">STEP 3</span><h2>振り分け内容を確認</h2><p>名前や事業所名を修正できます。要確認が残る間は出力できません。</p></div><div class="check-total ${assigned === result!.totalPages ? 'good' : 'danger'}">ページ整合性：${assigned} / ${result!.totalPages}</div></div>
      <div class="table-wrap"><table><thead><tr><th>状態</th><th>振り分け先</th><th>事業所名・番号</th><th>利用者名</th><th>ページ</th><th>提供年月</th><th>確認</th></tr></thead><tbody>
        ${groups.map((group) => `<tr data-id="${group.id}" class="${group.needsReview && !group.reviewed ? 'needs-review' : ''}"><td><span class="status ${group.needsReview && !group.reviewed ? 'warn' : 'ok'}">${groupStatus(group)}</span>${group.issues.length ? `<small>${group.issues.map(escapeHtml).join(' / ')}</small>` : ''}</td><td><b>${escapeHtml(destinationFor(group))}</b>${group.serviceCategory ? '<small>帳票種別：居宅療養管理指導</small>' : ''}</td><td><input data-field="providerName" value="${escapeHtml(group.providerName)}" aria-label="事業所名"><small>${escapeHtml(group.providerNumber || '10桁番号未判定')}${masterFor(group)?.providerName ? `・マスタ略称：${escapeHtml(masterFor(group)!.providerName)}` : ''}</small></td><td><button class="name-link" data-action="preview" data-id="${group.id}">${escapeHtml(group.clientName || '未判定')}</button><input class="inline-input" data-field="clientName" value="${escapeHtml(group.clientName)}" aria-label="利用者名"></td><td>${range(group)}<small>${escapeHtml(group.pages[0].sourceName)}</small></td><td><input data-field="serviceMonth" value="${escapeHtml(group.serviceMonth)}" aria-label="提供年月"></td><td>${group.needsReview && !group.reviewed ? `<button class="confirm" data-action="confirm" data-id="${group.id}">確認済みにする</button>${savedData.geminiEnabled ? `<button class="quiet" data-action="gemini" data-id="${group.id}">Gemini補助確認</button>` : ''}` : '<span class="muted">確認済み</span>'}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="verification-actions"><span>${reviewCount ? `要確認 ${reviewCount}件を確認してください` : blockedCount ? `必須情報または送付方法が未設定のため${blockedCount}件は出力できません` : mixedMonths ? '対象年月が未判定または複数月のため出力できません' : 'すべて確認済みです。'}</span><button class="primary" data-action="create" ${canExport ? '' : 'disabled'}>事業所別PDFを作成</button></div>
    </section>
    <section class="card provider-list"><div class="section-head"><div><span class="eyebrow">事業所別表示</span><h2>この事業所へ送付される利用者</h2></div></div><div class="provider-grid">
      ${[...providers.entries()].map(([name, providerGroups]) => `<article><h3>${escapeHtml(name)} <span>${providerGroups.length}名</span></h3><ul>${providerGroups.map((group) => `<li><button data-action="preview" data-id="${group.id}">${escapeHtml(group.clientName || '利用者名未判定')}</button><span>${range(group)}</span></li>`).join('')}</ul></article>`).join('')}
    </div></section>
    ${downloaded ? `<section class="complete card"><span class="eyebrow">完了</span><h2>振り分け結果</h2><p>元PDF：${result!.sources.length}ファイル　総ページ数：${result!.totalPages}ページ　利用者：${new Set(groups.map((g) => g.clientName)).size}名　事業所：${providers.size}事業所　作成PDF：${downloaded}ファイル　要確認：${reviewCount}件</p><button class="primary" data-action="zip">すべて一括保存（ZIP）</button></section>` : ''}
    <p class="local-note">処理済みのPDF・氏名・解析結果はサーバーへ保存されません。ページの振り分けは、実際の提供票に合わせて <code>src/analysis-rules.ts</code> のルールを調整できます。</p>`;
}

function setProgress(message: string) { app.dataset.progress = message; render(); }

function bindEvents() {
  document.querySelector('[data-action="choose"]')?.addEventListener('click', (event) => { event.stopPropagation(); document.querySelector<HTMLInputElement>('#fileInput')?.click(); });
  document.querySelector('[data-action="folder"]')?.addEventListener('click', (event) => { event.stopPropagation(); document.querySelector<HTMLInputElement>('#folderInput')?.click(); });
  document.querySelector('[data-action="reset"]')?.addEventListener('click', () => { result = undefined; downloaded = 0; render(); });
  document.querySelector<HTMLInputElement>('#fileInput')?.addEventListener('change', (event) => acceptFiles([...(event.target.files ?? [])]));
  document.querySelector<HTMLInputElement>('#folderInput')?.addEventListener('change', (event) => acceptFiles([...(event.target.files ?? [])]));
  const zone = document.querySelector('#dropzone');
  zone?.addEventListener('click', () => document.querySelector<HTMLInputElement>('#fileInput')?.click());
  zone?.addEventListener('dragover', (event) => { event.preventDefault(); zone.classList.add('dragging'); });
  zone?.addEventListener('dragleave', () => zone.classList.remove('dragging'));
  zone?.addEventListener('drop', (event) => { event.preventDefault(); zone.classList.remove('dragging'); acceptFiles([...event.dataTransfer!.files]); });
  document.querySelectorAll<HTMLInputElement>('input[data-field]').forEach((input) => input.addEventListener('change', () => {
    const group = result?.groups.find((item) => item.id === input.closest('tr')?.dataset.id); if (!group) return;
    group[input.dataset.field as 'providerName' | 'clientName' | 'serviceMonth'] = input.value.trim();
    const missing = !group.clientName || !group.providerName || !group.serviceMonth;
    group.needsReview = missing || group.issues.length > 0;
    group.reviewed = false; render();
  }));
  document.querySelectorAll<HTMLElement>('[data-action="confirm"]').forEach((button) => button.addEventListener('click', () => { const group = result?.groups.find((item) => item.id === button.dataset.id); if (group) { group.reviewed = true; render(); } }));
  document.querySelector('[data-action="ack-duplicates"]')?.addEventListener('click', () => { if (result) { result.duplicateFiles = []; render(); } });
  document.querySelector('[data-action="backup"]')?.addEventListener('click', () => download(exportSavedData(savedData), `提供票自動振り分け_バックアップ_${new Date().toISOString().slice(0, 10)}.json`));
  document.querySelector('[data-action="import"]')?.addEventListener('click', () => document.querySelector<HTMLInputElement>('#backupInput')?.click());
  document.querySelector<HTMLInputElement>('#backupInput')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0]; if (!file) return;
    try { savedData = await importSavedData(file); persist(); render(); alert('バックアップを読み込みました。'); }
    catch (error) { alert(error instanceof Error ? error.message : 'バックアップを読み込めませんでした。'); }
  });
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-master-field]').forEach((input) => input.addEventListener('change', () => {
    const number = input.closest('tr')?.dataset.master; const entry = savedData.providerMaster.find((item) => item.providerNumber === number); if (!entry) return;
    entry[input.dataset.masterField as 'providerName' | 'deliveryMethod'] = input.value as never; entry.updatedAt = new Date().toISOString(); persist(); refreshRoutingSafety(); render();
  }));
  document.querySelectorAll<HTMLElement>('[data-action="delete-master"]').forEach((button) => button.addEventListener('click', () => {
    if (!confirm('この事業所をマスタから削除しますか？過去のPDFは削除されません。')) return;
    savedData.providerMaster = savedData.providerMaster.filter((entry) => entry.providerNumber !== button.dataset.number); persist(); refreshRoutingSafety(); render();
  }));
  document.querySelector<HTMLInputElement>('[data-action="gemini-toggle"]')?.addEventListener('change', (event) => { savedData.geminiEnabled = event.target.checked; persist(); render(); });
  document.querySelectorAll<HTMLElement>('[data-action="preview"]').forEach((button) => button.addEventListener('click', () => preview(button.dataset.id!)));
  document.querySelectorAll<HTMLElement>('[data-action="gemini"]').forEach((button) => button.addEventListener('click', () => geminiAssist(button.dataset.id!)));
  document.querySelector('[data-action="create"]')?.addEventListener('click', createAll);
  document.querySelector('[data-action="zip"]')?.addEventListener('click', createAllZip);
}

async function acceptFiles(files: File[]) {
  const pdfs = files.filter((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
  if (!pdfs.length) { alert('PDFファイルを選択してください。'); return; }
  busy = true; setProgress('PDFを読み込み中');
  try {
    const loaded = await loadPdfFiles(pdfs, setProgress); result = await analysePdfs(loaded.sources, loaded.duplicateFiles, setProgress); downloaded = 0;
    let added = 0;
    for (const group of result.groups) {
      if (!group.providerNumber || masterFor(group)) continue;
      savedData.providerMaster.push({ providerNumber: group.providerNumber, providerName: group.providerName, deliveryMethod: '', updatedAt: new Date().toISOString() }); added++;
    }
    if (added) persist();
    refreshRoutingSafety();
  }
  catch (error) { alert(error instanceof Error ? `PDFを読み込めませんでした：${error.message}` : 'PDFを読み込めませんでした。'); }
  finally { busy = false; render(); }
}

async function preview(groupId: string) {
  const group = result?.groups.find((item) => item.id === groupId); if (!group || !result) return;
  const dialog = document.querySelector<HTMLDialogElement>('#previewDialog')!; const canvas = document.querySelector<HTMLCanvasElement>('#previewCanvas')!;
  document.querySelector('#previewTitle')!.textContent = `${group.clientName || '利用者名未判定'} — ${range(group)}（先頭ページ）`;
  document.querySelector('#previewError')!.textContent = ''; dialog.showModal();
  try { const ref = group.pages[0]; const source = result.sources.find((item) => item.id === ref.sourceId)!; await renderPage(source, ref.pageIndex, canvas); }
  catch { document.querySelector('#previewError')!.textContent = 'プレビューを表示できませんでした。'; }
}

async function geminiAssist(groupId: string) {
  const group = result?.groups.find((item) => item.id === groupId); if (!group) return;
  const message = '事業所名・事業所番号などの関連行（最大1,600文字）だけをGemini APIへ送信します。PDF全体や利用者名は送信しません。API利用料金が発生する場合があります。送りますか？';
  if (!confirm(message)) return;
  busy = true; setProgress('Gemini補助判定中');
  try {
    const suggestion = await requestGeminiSuggestion({ excerpt: group.geminiExcerpt, providerName: group.providerName, providerNumber: group.providerNumber, missing: group.issues });
    group.geminiUsed = true;
    group.issues = group.issues.filter((issue) => !issue.startsWith('Gemini補助結果：'));
    const candidates = [suggestion.providerName && `事業所名候補：${suggestion.providerName}`, suggestion.providerNumber && `事業所番号候補：${suggestion.providerNumber}`, suggestion.isHomeMedicalCare === true && '居宅療養管理指導の可能性'].filter(Boolean).join(' / ');
    group.issues.push(`Gemini補助結果：${[candidates, suggestion.reason || '候補を確認してください'].filter(Boolean).join(' — ')}（確信度 ${Math.round(suggestion.confidence * 100)}%・手動確認必須）`);
    group.needsReview = true; group.reviewed = false;
  } catch (error) { alert(error instanceof Error ? error.message : 'Gemini補助判定に失敗しました。'); }
  finally { busy = false; render(); }
}

function providerGroups() {
  const values = new Map<string, SlipGroup[]>();
  // 似た名称でも番号が違えば、絶対に同じPDFへ結合しない。
  result!.groups.forEach((group) => {
    const key = `${destinationFor(group)}|${group.providerNumber || `未判定-${group.id}`}`;
    values.set(key, [...(values.get(key) ?? []), group]);
  });
  return values;
}
async function createAll() {
  if (!result) return; busy = true; setProgress('事業所別PDFを作成中');
  try { const entries = [...providerGroups().values()]; for (const [index, groups] of entries.entries()) { setProgress(`${index + 1} / ${entries.length} 事業所別PDFを作成中`); const output = await createProviderPdf(providerNameFor(groups[0]), groups[0].serviceMonth, groups, result.sources); download(output.bytes, output.name); await new Promise((resolve) => setTimeout(resolve, 250)); } downloaded = entries.length; }
  catch { alert('PDFの作成に失敗しました。'); }
  finally { busy = false; render(); }
}
async function createAllZip() {
  if (!result) return; busy = true; setProgress('ZIPを作成中');
  try { const entries = [...providerGroups().values()]; const outputs = []; for (const [index, groups] of entries.entries()) { setProgress(`${index + 1} / ${entries.length} ZIP用PDFを作成中`); const output = await createProviderPdf(providerNameFor(groups[0]), groups[0].serviceMonth, groups, result.sources); outputs.push({ ...output, folder: destinationFor(groups[0]) }); } const zip = await createZip(outputs, result.uniqueMonths[0] || '提供年月未確定'); download(zip.blob, zip.name); }
  catch { alert('ZIPの作成に失敗しました。'); }
  finally { busy = false; render(); }
}

void loadSavedData().then((data) => { savedData = data; render(); });
render();
