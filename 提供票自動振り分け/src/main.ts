import './style.css';
import './master.css';
import './folds.css';
import { analysePdfs, createFilePreview, createProviderPdf, createZip, loadPdfFiles, renderPage, safeFilename } from './pdf-service';
import type { AnalysisResult, AppSavedData, DeliveryMethod, ProviderMasterEntry, SlipGroup } from './types';
import { emptySavedData, exportSavedData, importSavedData, loadOutputDirectoryHandle, loadSavedData, saveOutputDirectoryHandle, saveSavedData } from './storage';
import { requestGeminiSuggestion } from './gemini-service';

const app = document.querySelector<HTMLDivElement>('#app')!;
let result: AnalysisResult | undefined;
let busy = false;
let downloaded = 0;
let outputKind: 'folder' | 'zip' | undefined;
let outputName = '';
let outputDirectoryHandle: FileSystemDirectoryHandle | undefined;
let scrollToTopOnNextRender = false;
let focusSaveButtonOnNextRender = false;
type QueuedPdf = { id: string; file: File; thumbnail?: string; pageCount?: number; previewError: boolean };
let queuedFiles: QueuedPdf[] = [];
let savedData: AppSavedData = emptySavedData();
const sectionOpen: Record<string, boolean | undefined> = {};

const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!);
const range = (group: SlipGroup) => group.pages.length === 1 ? `P${group.pages[0].serial}` : `P${group.pages[0].serial}〜${group.pages.at(-1)!.serial}`;
const groupStatus = (group: SlipGroup) => group.needsReview && !group.reviewed ? '要確認' : '確認済み';
const download = (bytes: BlobPart, name: string) => { const url = URL.createObjectURL(new Blob([bytes])); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
const masterFor = (group: SlipGroup) => savedData.providerMaster.find((entry) => entry.providerNumber === group.providerNumber);
const providerNameFor = (group: SlipGroup) => masterFor(group)?.providerName.trim() || group.providerName.trim();
const destinationFor = (group: SlipGroup) => group.serviceCategory === '居宅療養' || masterFor(group)?.deliveryMethod === '居宅療養' ? '居宅療養' : (masterFor(group)?.deliveryMethod || '要確認');
const outputBlocked = (group: SlipGroup) => !group.providerNumber || !providerNameFor(group) || !group.clientName.trim() || !group.serviceMonth.trim() || !masterFor(group)?.deliveryMethod;
const persist = () => saveSavedData(savedData);
function refreshRoutingSafety() {
  result?.groups.forEach((group) => {
    group.issues = group.issues.filter((issue) => issue !== '送付方法が未設定です');
    let master = masterFor(group);
    if (!master && !group.providerNumber && group.providerName.trim()) {
      const nameMatches = savedData.providerMaster.filter((entry) => normalizedProviderName(entry.providerName) === normalizedProviderName(group.providerName));
      if (nameMatches.length === 1) {
        master = nameMatches[0];
        group.providerNumber = master.providerNumber;
        group.issues = group.issues.filter((issue) => issue !== '10桁の事業所番号を判定できません');
      }
    }
    if (master?.providerName.trim()) {
      group.providerName ||= master.providerName.trim();
      group.issues = group.issues.filter((issue) => issue !== '事業所名を判定できません');
    }
    if (!master?.deliveryMethod) {
      group.issues.push('送付方法が未設定です');
      group.reviewed = false;
    }
    group.needsReview = group.issues.length > 0;
  });
}

function render() {
  document.querySelectorAll<HTMLDetailsElement>('details[data-section]').forEach((section) => {
    const key = section.dataset.section;
    if (key) sectionOpen[key] = section.open;
  });
  const scrollPosition = scrollToTopOnNextRender ? 0 : window.scrollY;
  const focusSaveButton = focusSaveButtonOnNextRender;
  scrollToTopOnNextRender = false;
  focusSaveButtonOnNextRender = false;
  const innerScrollPositions = Array.from(app.querySelectorAll<HTMLElement>('[data-scroll-area]'))
    .map((area) => ({ key: area.dataset.scrollArea!, top: area.scrollTop, left: area.scrollLeft }));
  const active = document.activeElement;
  const focusTarget = active instanceof HTMLInputElement || active instanceof HTMLSelectElement
    ? {
        masterNumber: active.closest<HTMLTableRowElement>('tr[data-master]')?.dataset.master,
        masterField: active.dataset.masterField,
        groupId: active.closest<HTMLTableRowElement>('tr[data-id]')?.dataset.id,
        groupField: active.dataset.field,
      }
    : undefined;
  const groups = result?.groups ?? [];
  const assigned = new Set(groups.flatMap((group) => group.pages.map((page) => `${page.sourceId}:${page.pageIndex}`))).size;
  const masterSetupProviderNumbers = new Set(groups.filter((group) => group.providerNumber && !masterFor(group)?.deliveryMethod).map((group) => group.providerNumber));
  const masterSetupCount = masterSetupProviderNumbers.size;
  const reviewKeys = new Set<string>();
  groups.forEach((group) => {
    const masterRouteMissing = Boolean(group.providerNumber && masterSetupProviderNumbers.has(group.providerNumber));
    if (group.needsReview && !group.reviewed) {
      if (masterRouteMissing) {
        reviewKeys.add(`master:${group.providerNumber}`);
        if (group.issues.some((issue) => issue !== '送付方法が未設定です') || !group.clientName.trim() || !providerNameFor(group) || !group.serviceMonth.trim()) reviewKeys.add(`group:${group.id}`);
      } else reviewKeys.add(`group:${group.id}`);
    }
  });
  masterSetupProviderNumbers.forEach((number) => reviewKeys.add(`master:${number}`));
  const reviewCount = reviewKeys.size + (result?.duplicateFiles.length ?? 0);
  const blockedCount = groups.filter(outputBlocked).length;
  const mixedMonths = Boolean(result && result.uniqueMonths.length !== 1);
  const canExport = Boolean(result && !busy && !queuedFiles.length && reviewCount === 0 && blockedCount === 0 && !mixedMonths && assigned === result.totalPages && groups.length);
  const progressMessage = app.dataset.progress || '処理を準備中';
  const progressParts = progressMessage.match(/^(\d+)\s*\/\s*(\d+)\s*(.*)$/u);
  const progressCurrent = progressParts ? Number(progressParts[1]) : 0;
  const progressTotal = progressParts ? Number(progressParts[2]) : 0;
  const progressPercent = progressTotal ? Math.min(100, Math.round((progressCurrent / progressTotal) * 100)) : 0;
  const progressStage = progressParts?.[3] || progressMessage;
  const progressUnit = progressStage.includes('ページ') ? 'ページ' : progressStage.includes('ファイル') ? 'ファイル' : '件';
  app.innerHTML = `
    <main class="shell">
      <header class="header">
        <div class="logo">提供票</div>
        <div><h1>提供票 自動振り分け</h1></div>
      </header>
      <nav class="steps" aria-label="作業手順">
        ${['PDFをドラッグ&ドロップ', '自動振り分け', '事業所マスタを確認', '事業所別フォルダを作成（ZIPファイル保存）'].map((label, index) => `<span class="${(canExport ? index <= 3 : result ? index <= 2 : index === 0) ? 'active' : ''}"><b>${index + 1}</b>${label}</span>`).join('')}
      </nav>
      ${result && !busy ? summaryArea(groups, reviewCount) : ''}
      ${fixedSection('intake', busy ? '振り分け中' : result && !queuedFiles.length ? '振り分け結果と保存' : 'サービス提供票PDFを入れる', queuedFiles.length ? `選択中 ${queuedFiles.length}件 · 開始前` : busy ? '処理中' : result ? '振り分け結果・保存' : 'STEP 1 · 最初にPDFを選択', `
        ${result ? `<div class="intake-actions"><button class="primary reset-button" data-action="reset" ${busy ? 'disabled' : ''}>リセット</button></div>` : ''}
        ${busy ? `<section class="progress-panel" role="status" aria-live="polite">
          <div class="progress-panel-heading"><div class="progress-panel-copy"><span>振り分け中</span><strong>${escapeHtml(progressStage)}</strong></div>
            ${progressParts ? `<div class="progress-counter"><strong>${progressCurrent}<small> / ${progressTotal}</small></strong><span>${progressUnit}</span></div>` : `<i class="progress-spinner" aria-hidden="true"></i>`}
          </div>
          <div class="progress-track" ${progressParts ? `role="progressbar" aria-label="${escapeHtml(progressStage)}" aria-valuemin="0" aria-valuemax="${progressTotal}" aria-valuenow="${progressCurrent}"` : 'aria-hidden="true"'}><span style="width:${progressParts ? `${progressPercent}%` : '32%'}" class="${progressParts ? '' : 'indeterminate'}"></span></div>
          <p class="progress-hint">処理が終わるまで、この画面を閉じずにお待ちください。</p>
        </section>` : queuedFiles.length || !result ? `
          <div class="dropzone ${queuedFiles.length ? 'with-previews' : ''}" id="dropzone" role="region" aria-label="PDFのドラッグ・ドロップ欄">
            ${queuedFiles.length ? queuePanel() : `
            <div class="drop-icon">↓</div><strong>サービス提供票PDFをここにドラッグ＆ドロップ</strong>
            <button class="primary" data-action="choose">PDFを選択</button>
            <button class="link-button" data-action="folder">フォルダを選択</button>
            `}
            <input id="fileInput" type="file" accept="application/pdf,.pdf" multiple hidden>
            <input id="folderInput" type="file" accept="application/pdf,.pdf" webkitdirectory multiple hidden>
          </div>
        ` : outputPanel(canExport, reviewCount, blockedCount, masterSetupCount, mixedMonths, groups.length, assigned, result.totalPages)}
      `)}
      ${masterArea()}
      ${result && !busy ? reviewArea(groups, reviewCount, assigned) : ''}
    </main>
    <dialog id="previewDialog" class="preview-dialog"><form method="dialog"><button class="close" aria-label="閉じる">×</button></form><h3 id="previewTitle">元PDFページ</h3><canvas id="previewCanvas"></canvas><p id="previewError" class="error"></p></dialog>`;
  bindEvents();
  requestAnimationFrame(() => {
    innerScrollPositions.forEach(({ key, top, left }) => {
      const area = app.querySelector<HTMLElement>(`[data-scroll-area="${key}"]`);
      if (area) { area.scrollTop = top; area.scrollLeft = left; }
    });
    let nextFocus: HTMLInputElement | HTMLSelectElement | undefined;
    if (focusTarget?.masterNumber && focusTarget.masterField) {
      nextFocus = Array.from(document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-master-field]'))
        .find((field) => field.closest<HTMLTableRowElement>('tr[data-master]')?.dataset.master === focusTarget.masterNumber && field.dataset.masterField === focusTarget.masterField);
    } else if (focusTarget?.groupId && focusTarget.groupField) {
      nextFocus = Array.from(document.querySelectorAll<HTMLInputElement>('[data-field]'))
        .find((field) => field.closest<HTMLTableRowElement>('tr[data-id]')?.dataset.id === focusTarget.groupId && field.dataset.field === focusTarget.groupField);
    }
    if (!focusSaveButton) nextFocus?.focus({ preventScroll: true });
    window.scrollTo(0, scrollPosition);
    if (focusSaveButton && canExport) app.querySelector<HTMLButtonElement>('[data-action="create"]:not(:disabled)')?.focus({ preventScroll: true });
  });
}

function foldSection(key: string, title: string, meta: string, content: string, defaultOpen = false) {
  const open = sectionOpen[key] ?? defaultOpen;
  return `<details class="card fold-section ${key}-section" data-section="${key}" ${open ? 'open' : ''}><summary class="fold-summary"><span class="fold-title">${title}</span><span class="fold-meta">${meta}</span><i aria-hidden="true"></i></summary><div class="fold-body">${content}</div></details>`;
}

function fixedSection(key: string, title: string, meta: string, content: string) {
  return `<section class="card fold-section ${key}-section"><div class="fold-summary intake-fixed-summary"><span class="fold-title">${title}</span><span class="fold-meta">${meta}</span></div><div class="fold-body">${content}</div></section>`;
}

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options: { id: string; mode: 'readwrite'; startIn: FileSystemDirectoryHandle | 'desktop' }) => Promise<FileSystemDirectoryHandle>;
};

function outputPanel(canExport: boolean, reviewCount: number, blockedCount: number, masterSetupCount: number, mixedMonths: boolean, groupCount: number, assigned: number, totalPages: number) {
  const pickerAvailable = window.isSecureContext && typeof (window as DirectoryPickerWindow).showDirectoryPicker === 'function';
  const reason = masterSetupCount ? '事業所マスタで振り分け先を設定すると、保存できるようになります。' : reviewCount ? `要確認 ${reviewCount}件を確認してから保存できます。` : blockedCount ? `必須情報または振り分け先が未設定の ${blockedCount}件を先に確認してください。` : mixedMonths ? '対象年月が1か月に揃ってから保存できます。' : '';
  const statusLabel = canExport ? '保存可能' : masterSetupCount ? '事業所マスタ未設定' : '確認が必要';
  return `<section class="result-actions">
    <div class="result-actions-heading"><div><span class="eyebrow">振り分け完了</span><h2>${groupCount}件を振り分けました</h2></div>${outputDirectoryHandle && pickerAvailable ? `<small>前回の保存先：${escapeHtml(outputDirectoryHandle.name)}</small>` : ''}</div>
    <div class="result-counts"><div><span>要確認</span><strong>${reviewCount}<small>件</small></strong></div><div><span>ページ</span><strong>${assigned}<small> / ${totalPages}</small></strong></div><div><span>状態</span><strong class="${canExport ? 'ready' : 'needs-review'}">${statusLabel}</strong></div></div>
    <div class="result-save-row">
      ${masterSetupCount ? `<span class="output-status master-setup-note">${escapeHtml(reason)}</span>` : canExport ? `<span class="save-instruction">${pickerAvailable ? 'ボタンを押すと保存先フォルダを選べます。' : '振り分けたPDFが事業所ごとのフォルダにまとまります。'}</span>` : `<span class="output-status">${escapeHtml(reason || '内容を確認してから保存できます。')}</span>`}
      <div class="result-save-actions">
        ${masterSetupCount ? `<button class="primary master-jump-button" data-action="go-master">事業所マスタへ移動</button>` : ''}
        <button class="primary output-button output-button-large" data-action="create" ${canExport && !busy ? '' : 'disabled'}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H10l2 2h7.5A1.5 1.5 0 0 1 21 9.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/><path d="M3.5 11h17"/></svg>${pickerAvailable ? '保存先フォルダを選んで保存' : '振り分け完了フォルダをダウンロード'}</button>
      </div>
    </div>
  </section>`;
}

function queuePanel() {
  if (!queuedFiles.length) return '';
  const previewPending = queuedFiles.some((item) => !item.thumbnail && !item.previewError);
  return `<div class="pdf-queue-content" aria-label="振り分けるPDF">
    <div class="pdf-queue-heading"><div><strong>振り分けるPDF（${queuedFiles.length}件）</strong><span>続けてドラッグするか、追加ボタンでPDFを増やせます。</span></div><div class="pdf-queue-tools"><button class="quiet" data-action="choose" ${busy ? 'disabled' : ''}>PDFを追加</button><button class="quiet" data-action="folder" ${busy ? 'disabled' : ''}>フォルダを追加</button></div></div>
    <div class="pdf-queue-grid">${queuedFiles.map((item) => `<article class="pdf-queue-item">
      <div class="pdf-thumb">${item.thumbnail ? `<img src="${escapeHtml(item.thumbnail)}" alt="${escapeHtml(item.file.name)}の1ページ目">` : item.previewError ? `<span class="pdf-thumb-message">プレビューを表示できません<br>振り分けは可能です</span>` : `<span class="pdf-thumb-loading">プレビュー作成中…</span>`}</div>
      <strong class="pdf-queue-name" title="${escapeHtml(item.file.name)}">${escapeHtml(item.file.name)}</strong>
      <span class="pdf-queue-pages">${item.pageCount ? `${item.pageCount}ページ` : item.previewError ? 'PDFを確認してください' : '読み込み中'}</span>
      <button class="pdf-queue-delete" data-action="remove-queued" data-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.file.name)}を一覧から削除" title="一覧から削除" ${busy ? 'disabled' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/></svg></button>
    </article>`).join('')}</div>
    <div class="pdf-queue-summary"><span>不要なPDFはゴミ箱で外せます。元ファイルは削除されません。</span><div class="pdf-start-control"><span class="pdf-start-instruction">${previewPending ? 'プレビューの準備ができるまでお待ちください。' : 'PDFを確認したら、下のボタンを押してください。'}</span><button class="primary pdf-start" data-action="start-routing" ${busy || previewPending ? 'disabled' : ''}>${busy ? '振り分け中…' : previewPending ? 'プレビュー作成中…' : '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5a1 1 0 0 1 1.5-.86l10 6.5a1 1 0 0 1 0 1.72l-10 6.5A1 1 0 0 1 8 18.5z"/></svg>自動振り分け開始'}</button></div></div>
  </div>`;
}

function masterArea() {
  const entries = [...savedData.providerMaster].sort((a, b) => {
    const priority = (entry: ProviderMasterEntry) => !entry.deliveryMethod ? 0 : !entry.providerName.trim() ? 1 : 2;
    return priority(a) - priority(b);
  });
  const needsSetup = entries.filter((entry) => !entry.providerName.trim() || !entry.deliveryMethod).length;
  const needsRoute = entries.filter((entry) => !entry.deliveryMethod).length;
  return foldSection('master', '事業所マスタ', `${needsSetup ? `要設定 ${needsSetup}件 · ` : ''}登録 ${entries.length}件`, `<div class="section-head master-head"><div><h2>事業所番号と振り分け先・送付方法</h2></div><div class="backup-buttons"><button class="quiet" data-action="backup">バックアップ</button><button class="quiet" data-action="import">データ挿入</button><input id="backupInput" type="file" accept="application/json,.json" hidden></div></div>
    ${needsSetup ? `<div class="master-alert" role="status"><strong>${needsRoute ? '振り分け先を選択してください' : '事業所名を入力してください'}</strong><span>${needsRoute ? '赤色の欄を設定しないとダウンロードできません。' : '色の付いた欄を確認してください。'}</span></div>` : ''}
    ${entries.length ? `<div class="table-wrap master-table" data-scroll-area="master"><table><thead><tr><th>10桁の事業所番号</th><th>事業所名（略称可）</th><th>振り分け先・送付方法</th><th></th></tr></thead><tbody>${entries.map((entry) => { const missingName = !entry.providerName.trim(); const missingRoute = !entry.deliveryMethod; const state = missingName ? 'needs-name' : missingRoute ? 'needs-route' : 'registered'; const label = missingName ? (missingRoute ? '名称・振り分け先を入力' : '事業所名を入力') : missingRoute ? '振り分け先を選択' : '登録済み'; return `<tr data-master="${escapeHtml(entry.providerNumber)}" class="master-${state}"><td>${escapeHtml(entry.providerNumber)}<small class="master-status ${state}">${label}</small></td><td><input data-master-field="providerName" value="${escapeHtml(entry.providerName)}"></td><td><select data-master-field="deliveryMethod" class="${missingRoute ? 'master-route-unset' : ''}"><option value="" ${entry.deliveryMethod === '' ? 'selected' : ''}>未設定（要確認）</option>${(['LINE','FAX','メール','手渡し','居宅療養','その他'] as DeliveryMethod[]).filter(Boolean).map((method) => `<option value="${method}" ${entry.deliveryMethod === method ? 'selected' : ''}>${method}</option>`).join('')}</select></td><td><button class="quiet" data-action="delete-master" data-number="${escapeHtml(entry.providerNumber)}">削除</button></td></tr>`; }).join('')}</tbody></table></div>` : `<p class="empty-master">PDFを解析すると、新しい事業所番号がここに追加されます。送付方法が未設定の書類は必ず「要確認」になります。</p>`}
  `, true);
}

function summaryArea(groups: SlipGroup[], reviewCount: number) {
  return `<section class="summary-grid">
    <article><span>元PDF</span><b>${result!.sources.length}ファイル</b></article><article><span>総ページ数</span><b>${result!.totalPages}ページ</b></article><article><span>利用者 × 事業所</span><b>${groups.length}件</b></article><article><span>要確認</span><b class="${reviewCount ? 'danger' : 'good'}">${reviewCount}件</b></article>
  </section>`;
}

function reviewArea(groups: SlipGroup[], reviewCount: number, assigned: number) {
  const providers = new Map<string, SlipGroup[]>();
  groups.forEach((group) => { const name = `${destinationFor(group)}｜${providerNameFor(group) || '事業所名未判定'}（${group.providerNumber || '番号未判定'}）`; providers.set(name, [...(providers.get(name) ?? []), group]); });
  const month = result!.uniqueMonths.length === 1 ? result!.uniqueMonths[0] : '提供年月未確定';
  return `
    ${result!.duplicateFiles.length ? `<section class="warning"><strong>重複して投入されたPDFがあります</strong><span>${result!.duplicateFiles.map(escapeHtml).join('、')}</span><button data-action="ack-duplicates" class="quiet">内容を確認して続行</button></section>` : ''}
    ${foldSection('verification', '振り分け内容を確認', `${reviewCount ? `要確認 ${reviewCount}件` : '要確認なし'} · ${groups.length}件`, `
      <div class="section-head"><div><p>名前や事業所名を修正できます。要確認が残る間は出力できません。</p></div><div class="check-total ${assigned === result!.totalPages ? 'good' : 'danger'}">ページ整合性：${assigned} / ${result!.totalPages}</div></div>
      <div class="table-wrap" data-scroll-area="verification"><table><thead><tr><th>状態</th><th>振り分け先</th><th>事業所名・番号</th><th>利用者名</th><th>ページ</th><th>提供年月</th><th>確認</th></tr></thead><tbody>
        ${groups.map((group) => `<tr data-id="${group.id}" class="${group.needsReview && !group.reviewed ? 'needs-review' : ''}"><td><span class="status ${group.needsReview && !group.reviewed ? 'warn' : 'ok'}">${groupStatus(group)}</span>${group.issues.length ? `<small>${group.issues.map(escapeHtml).join(' / ')}</small>` : ''}</td><td><b>${escapeHtml(destinationFor(group))}</b></td><td><input data-field="providerName" value="${escapeHtml(group.providerName)}" aria-label="事業所名"></td><td><input class="inline-input" data-field="clientName" value="${escapeHtml(group.clientName)}" aria-label="利用者名"></td><td><div class="verification-page-cell"><span>${range(group)}</span><button class="quiet page-preview-link" data-action="preview" data-id="${group.id}">PDFを見る</button></div></td><td><input data-field="serviceMonth" value="${escapeHtml(group.serviceMonth)}" aria-label="提供年月"></td><td>${group.needsReview && !group.reviewed ? `<button class="confirm" data-action="confirm" data-id="${group.id}">確認済みにする</button>` : '<span class="muted">確認済み</span>'}</td></tr>`).join('')}
      </tbody></table></div>
    `, false)}
    ${downloaded ? foldSection('complete', outputKind === 'folder' ? '振り分けフォルダを作成しました' : 'ZIPをダウンロードしました', `${downloaded}事業所分 · ${escapeHtml(outputName)}`, `<div class="complete-content"><p>元PDF：${result!.sources.length}ファイル　総ページ数：${result!.totalPages}ページ　利用者：${new Set(groups.map((g) => g.clientName)).size}名　事業所：${providers.size}事業所　作成PDF：${downloaded}件　要確認：${reviewCount}件${outputKind === 'folder' && outputDirectoryHandle ? `　保存先：${escapeHtml(outputDirectoryHandle.name)} / ${escapeHtml(outputName)}` : ''}</p><button class="primary" data-action="create">もう一度作成して保存</button></div>`, true) : ''}
    `;
}

function setProgress(message: string) { app.dataset.progress = message; render(); }

function showIntakeProgress() {
  scrollToTopOnNextRender = true;
}

function bindEvents() {
  document.querySelectorAll<HTMLDetailsElement>('details[data-section]').forEach((section) => section.addEventListener('toggle', () => {
    const key = section.dataset.section;
    if (key) sectionOpen[key] = section.open;
  }));
  document.querySelector('[data-action="choose"]')?.addEventListener('click', (event) => { event.stopPropagation(); document.querySelector<HTMLInputElement>('#fileInput')?.click(); });
  document.querySelector('[data-action="folder"]')?.addEventListener('click', (event) => { event.stopPropagation(); document.querySelector<HTMLInputElement>('#folderInput')?.click(); });
  document.querySelector('[data-action="reset"]')?.addEventListener('click', () => {
    if (busy || !confirm('振り分け結果と選択中PDFの一覧をリセットします。元のPDFファイルは削除されません。よろしいですか？')) return;
    queuedFiles = []; result = undefined; downloaded = 0; outputKind = undefined; outputName = ''; render();
  });
  document.querySelector<HTMLInputElement>('#fileInput')?.addEventListener('change', (event) => queueFiles([...(event.target.files ?? [])]));
  document.querySelector<HTMLInputElement>('#folderInput')?.addEventListener('change', (event) => queueFiles([...(event.target.files ?? [])]));
  const zone = document.querySelector('#dropzone');
  zone?.addEventListener('click', (event) => {
    if (queuedFiles.length || (event.target instanceof Element && event.target.closest('button, input'))) return;
    document.querySelector<HTMLInputElement>('#fileInput')?.click();
  });
  zone?.addEventListener('dragover', (event) => { event.preventDefault(); zone.classList.add('dragging'); });
  zone?.addEventListener('dragleave', () => zone.classList.remove('dragging'));
  zone?.addEventListener('drop', (event) => { event.preventDefault(); zone.classList.remove('dragging'); queueFiles([...event.dataTransfer!.files]); });
  document.querySelectorAll<HTMLElement>('[data-action="remove-queued"]').forEach((button) => button.addEventListener('click', (event) => { event.stopPropagation(); removeQueued(button.dataset.id!); }));
  document.querySelector('[data-action="start-routing"]')?.addEventListener('click', startRouting);
  document.querySelectorAll<HTMLInputElement>('input[data-field]').forEach((input) => input.addEventListener('change', () => {
    const group = result?.groups.find((item) => item.id === input.closest('tr')?.dataset.id); if (!group) return;
    group[input.dataset.field as 'providerName' | 'clientName' | 'serviceMonth'] = input.value.trim();
    const missing = !group.clientName || !group.providerName || !group.serviceMonth;
    group.needsReview = missing || group.issues.length > 0;
    group.reviewed = false; render();
  }));
  document.querySelectorAll<HTMLElement>('[data-action="confirm"]').forEach((button) => button.addEventListener('click', () => { const group = result?.groups.find((item) => item.id === button.dataset.id); if (group) { group.reviewed = true; render(); } }));
  document.querySelector('[data-action="ack-duplicates"]')?.addEventListener('click', () => { if (result) { result.duplicateFiles = []; render(); } });
  document.querySelector('[data-action="go-master"]')?.addEventListener('click', () => {
    const missingEntries = new Map<string, ProviderMasterEntry>();
    result?.groups.forEach((group) => {
      if (group.providerNumber && !savedData.providerMaster.some((entry) => entry.providerNumber === group.providerNumber) && !missingEntries.has(group.providerNumber)) {
        missingEntries.set(group.providerNumber, { providerNumber: group.providerNumber, providerName: group.providerName, deliveryMethod: '', updatedAt: new Date().toISOString() });
      }
    });
    if (missingEntries.size) {
      savedData.providerMaster.push(...missingEntries.values());
      persist();
      render();
    }
    sectionOpen.master = true;
    const masterSection = app.querySelector<HTMLDetailsElement>('details[data-section="master"]');
    if (!masterSection) return;
    masterSection.open = true;
    requestAnimationFrame(() => {
      masterSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const unsetRoute = masterSection.querySelector<HTMLSelectElement>('select.master-route-unset');
      unsetRoute?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      unsetRoute?.focus({ preventScroll: true });
    });
  });
  document.querySelector('[data-action="backup"]')?.addEventListener('click', () => download(exportSavedData(savedData), `提供票自動振り分け_バックアップ_${new Date().toISOString().slice(0, 10)}.json`));
  document.querySelector('[data-action="import"]')?.addEventListener('click', () => document.querySelector<HTMLInputElement>('#backupInput')?.click());
  document.querySelector<HTMLInputElement>('#backupInput')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0]; if (!file) return;
    try { savedData = await importSavedData(file); persist(); render(); alert('バックアップを読み込みました。'); }
    catch (error) { alert(error instanceof Error ? error.message : 'バックアップを読み込めませんでした。'); }
  });
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-master-field]').forEach((input) => input.addEventListener('change', () => {
    const number = input.closest('tr')?.dataset.master; const entry = savedData.providerMaster.find((item) => item.providerNumber === number); if (!entry) return;
    const hadMissingRoutes = Boolean(result?.groups.some((group) => group.providerNumber && !masterFor(group)?.deliveryMethod));
    entry[input.dataset.masterField as 'providerName' | 'deliveryMethod'] = input.value as never; entry.updatedAt = new Date().toISOString(); persist(); refreshRoutingSafety();
    const hasMissingRoutes = Boolean(result?.groups.some((group) => group.providerNumber && !masterFor(group)?.deliveryMethod));
    if (input.dataset.masterField === 'deliveryMethod' && hadMissingRoutes && !hasMissingRoutes) {
      scrollToTopOnNextRender = true;
      focusSaveButtonOnNextRender = true;
    }
    render();
  }));
  document.querySelectorAll<HTMLElement>('[data-action="delete-master"]').forEach((button) => button.addEventListener('click', () => {
    const providerNumber = button.dataset.number!;
    const isInCurrentResult = Boolean(result?.groups.some((group) => group.providerNumber === providerNumber));
    const confirmation = isInCurrentResult
      ? 'この事業所のマスタ設定を解除しますか？現在の振り分け結果に含まれているため、未設定の事業所として一覧の先頭に残り、設定するまで保存できなくなります。過去のPDFは削除されません。'
      : 'この事業所をマスタから削除しますか？過去のPDFは削除されません。';
    if (!confirm(confirmation)) return;
    const removedEntry = savedData.providerMaster.find((entry) => entry.providerNumber === providerNumber);
    savedData.providerMaster = savedData.providerMaster.filter((entry) => entry.providerNumber !== providerNumber);
    const activeGroup = result?.groups.find((group) => group.providerNumber === providerNumber);
    if (activeGroup) {
      savedData.providerMaster.push({
        providerNumber,
        providerName: removedEntry?.providerName || activeGroup.providerName,
        deliveryMethod: '',
        updatedAt: new Date().toISOString(),
      });
    }
    persist(); refreshRoutingSafety(); render();
    if (activeGroup) requestAnimationFrame(() => {
      const unsetRoute = Array.from(document.querySelectorAll<HTMLSelectElement>('select.master-route-unset'))
        .find((select) => select.closest<HTMLTableRowElement>('tr[data-master]')?.dataset.master === providerNumber);
      unsetRoute?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      unsetRoute?.focus({ preventScroll: true });
    });
  }));
  document.querySelectorAll<HTMLElement>('[data-action="preview"]').forEach((button) => button.addEventListener('click', () => preview(button.dataset.id!)));
  document.querySelectorAll<HTMLElement>('[data-action="create"]').forEach((button) => button.addEventListener('click', createAllOutputs));
}

async function queueFiles(files: File[]) {
  if (!files.length) return;
  const pdfs = files.filter((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
  if (!pdfs.length) { alert('PDFファイルを選択してください。'); return; }
  if (busy) return;
  const added = pdfs.map((file) => ({ id: crypto.randomUUID(), file, previewError: false } satisfies QueuedPdf));
  queuedFiles.push(...added);
  render();
  for (const item of added) {
    try {
      const preview = await createFilePreview(item.file);
      if (!queuedFiles.some((queued) => queued.id === item.id)) continue;
      item.thumbnail = preview.thumbnail;
      item.pageCount = preview.pageCount;
    } catch {
      if (!queuedFiles.some((queued) => queued.id === item.id)) continue;
      item.previewError = true;
    }
    render();
  }
}

function removeQueued(id: string) {
  queuedFiles = queuedFiles.filter((item) => item.id !== id);
  render();
}

async function startRouting() {
  if (!queuedFiles.length || queuedFiles.some((item) => !item.thumbnail && !item.previewError) || busy) return;
  const pdfs = queuedFiles.map((item) => item.file);
  showIntakeProgress();
  busy = true; setProgress('PDFを読み込み中');
  try {
    const loaded = await loadPdfFiles(pdfs, setProgress); const analysis = await analysePdfs(loaded.sources, loaded.duplicateFiles, setProgress); result = analysis; queuedFiles = []; downloaded = 0; outputKind = undefined; outputName = ''; sectionOpen.verification = false;
    let added = 0;
    let filledNames = 0;
    for (const group of result.groups) {
      if (!group.providerNumber) continue;
      const existing = masterFor(group);
      if (existing) {
        // PDFから名前が取れた場合も、スタッフが登録済みの略称や送付方法は変更しません。
        if (!existing.providerName.trim() && group.providerName.trim()) {
          existing.providerName = group.providerName;
          existing.updatedAt = new Date().toISOString();
          filledNames++;
        }
        continue;
      }
      savedData.providerMaster.push({ providerNumber: group.providerNumber, providerName: group.providerName, deliveryMethod: '', updatedAt: new Date().toISOString() }); added++;
    }
    if (added || filledNames) persist();
    refreshRoutingSafety();
    if (added) sectionOpen.master = true;
    await automaticallyAssistUnresolvedOffices();
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

const providerIdentityIssues = new Set(['事業所名を判定できません', '10桁の事業所番号を判定できません']);

function normalizedProviderName(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('ja').replace(/[\s・,，.。\-－‐()（）]/gu, '');
}

function providerNamesCompatible(left: string, right: string) {
  const a = normalizedProviderName(left);
  const b = normalizedProviderName(right);
  return !a || !b || a === b || a.includes(b) || b.includes(a);
}

function applyAutomaticGeminiSuggestion(group: SlipGroup, suggestion: Awaited<ReturnType<typeof requestGeminiSuggestion>>) {
  if (suggestion.confidence < 0.9) return false;
  if (group.providerNumber && suggestion.providerNumber && group.providerNumber !== suggestion.providerNumber) return false;
  if (!providerNamesCompatible(group.providerName, suggestion.providerName || '')) return false;

  const candidateNumber = group.providerNumber || suggestion.providerNumber || '';
  let master = savedData.providerMaster.find((entry) => entry.providerNumber === candidateNumber);
  if (master) {
    if (!providerNamesCompatible(group.providerName, master.providerName)
      || !providerNamesCompatible(suggestion.providerName || '', master.providerName)) return false;
    if (!master.providerName.trim() && suggestion.providerName?.trim()) master.providerName = suggestion.providerName.trim();
  } else {
    if (!suggestion.providerNumber || suggestion.confidence < 0.95 || group.providerNumber) return false;
    const suggestedName = suggestion.providerName?.trim() || group.providerName.trim();
    if (!suggestedName || !providerNamesCompatible(group.providerName, suggestedName)) return false;
    master = { providerNumber: suggestion.providerNumber, providerName: suggestedName, deliveryMethod: '', updatedAt: new Date().toISOString() };
    savedData.providerMaster.push(master);
    sectionOpen.master = true;
  }

  group.providerNumber = master.providerNumber;
  group.providerName = master.providerName.trim() || suggestion.providerName?.trim() || group.providerName;
  if (suggestion.isHomeMedicalCare === true) group.serviceCategory = '居宅療養';
  group.issues = group.issues.filter((issue) => !providerIdentityIssues.has(issue));
  group.needsReview = group.issues.length > 0;
  group.geminiUsed = true;
  return true;
}

function addGeminiCandidateForReview(group: SlipGroup, suggestion: Awaited<ReturnType<typeof requestGeminiSuggestion>>) {
  const candidates = [
    suggestion.providerName && `事業所名候補：${suggestion.providerName}`,
    suggestion.providerNumber && `事業所番号候補：${suggestion.providerNumber}`,
    suggestion.isHomeMedicalCare === true && '居宅療養管理指導の可能性',
    suggestion.reason,
  ].filter(Boolean).join(' / ');
  group.issues = group.issues.filter((issue) => !issue.startsWith('自動確認候補：'));
  group.issues.push(`自動確認候補：${candidates || '事業所マスタと照合できません'}（確認してください・確信度 ${Math.round(suggestion.confidence * 100)}%）`);
  group.needsReview = true;
  group.reviewed = false;
}

async function automaticallyAssistUnresolvedOffices() {
  const targets = result?.groups.filter((group) => group.issues.some((issue) => providerIdentityIssues.has(issue)) && group.geminiExcerpt.trim()) ?? [];
  if (!targets.length) return;

  type Suggestion = Awaited<ReturnType<typeof requestGeminiSuggestion>>;
  const cachedSuggestions = new Map<string, Suggestion>();
  for (const [index, group] of targets.entries()) {
    setProgress(`${index + 1} / ${targets.length}件　事業所情報を補助確認中`);
    const cacheKey = `${group.providerName}|${group.providerNumber}|${group.geminiExcerpt}`;
    try {
      let suggestion = cachedSuggestions.get(cacheKey);
      if (!suggestion) {
        suggestion = await requestGeminiSuggestion({ excerpt: group.geminiExcerpt, providerName: group.providerName, providerNumber: group.providerNumber, missing: group.issues });
        cachedSuggestions.set(cacheKey, suggestion);
      }
      if (!applyAutomaticGeminiSuggestion(group, suggestion)) addGeminiCandidateForReview(group, suggestion);
    } catch {
      for (const pending of targets.slice(index)) {
        pending.issues.push('事業所情報を自動確認できませんでした。事業所マスタを確認してください。');
        pending.needsReview = true;
        pending.reviewed = false;
      }
      break;
    }
  }
  refreshRoutingSafety();
  persist();
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
function directoryPicker() { return (window as DirectoryPickerWindow).showDirectoryPicker; }

function isMissingEntry(error: unknown) {
  return error instanceof DOMException && error.name === 'NotFoundError';
}

function isEntryConflict(error: unknown) {
  return error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'TypeMismatchError');
}

async function createUniqueDirectory(parent: FileSystemDirectoryHandle, baseName: string) {
  for (let suffix = 1; suffix < 1000; suffix++) {
    const name = suffix === 1 ? baseName : `${baseName} (${suffix})`;
    try { await parent.getDirectoryHandle(name); }
    catch (error) {
      if (!isEntryConflict(error)) throw error;
      if (isMissingEntry(error)) return { name, handle: await parent.getDirectoryHandle(name, { create: true }) };
    }
  }
  throw new Error('同名フォルダが多いため、新しい保存フォルダを作成できません。');
}

async function writeUniquePdf(directory: FileSystemDirectoryHandle, filename: string, bytes: Uint8Array) {
  const stem = filename.toLowerCase().endsWith('.pdf') ? filename.slice(0, -4) : filename;
  for (let suffix = 1; suffix < 1000; suffix++) {
    const name = suffix === 1 ? `${stem}.pdf` : `${stem} (${suffix}).pdf`;
    try { await directory.getFileHandle(name); }
    catch (error) {
      if (!isEntryConflict(error)) throw error;
      if (!isMissingEntry(error)) continue;
      const file = await directory.getFileHandle(name, { create: true });
      const writable = await file.createWritable();
      await writable.write(bytes);
      await writable.close();
      return;
    }
  }
  throw new Error('同名PDFが多いため、上書きせずに保存できません。');
}

async function createAllOutputs() {
  if (!result) return;
  const pickerAvailable = window.isSecureContext && Boolean(directoryPicker());
  let selectedDirectory: FileSystemDirectoryHandle | undefined;
  if (pickerAvailable) {
    try {
      selectedDirectory = await directoryPicker()!.call(window, {
        id: 'service-slip-sorter-output',
        mode: 'readwrite',
        startIn: outputDirectoryHandle ?? 'desktop',
      });
      outputDirectoryHandle = selectedDirectory;
      try { await saveOutputDirectoryHandle(selectedDirectory); }
      catch { alert('選んだフォルダには今回保存できますが、次回用の保存先を記憶できませんでした。'); }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      alert(error instanceof Error ? `保存先フォルダを選べませんでした：${error.message}` : '保存先フォルダを選べませんでした。');
      return;
    }
  }

  showIntakeProgress(); busy = true; downloaded = 0; outputKind = undefined; outputName = '';
  setProgress(pickerAvailable ? '保存用フォルダを作成中' : 'ZIPを作成中');
  try {
    const entries = [...providerGroups().values()];
    if (selectedDirectory) {
      const month = result.uniqueMonths[0] || '提供年月未確定';
      const outputFolder = await createUniqueDirectory(selectedDirectory, `提供票振り分け_${safeFilename(month)}`);
      outputName = outputFolder.name;
      for (const [index, groups] of entries.entries()) {
        setProgress(`${index + 1} / ${entries.length}件の事業所別PDFを作成中`);
        const output = await createProviderPdf(providerNameFor(groups[0]), groups[0].serviceMonth, groups, result.sources);
        const destination = await outputFolder.handle.getDirectoryHandle(safeFilename(destinationFor(groups[0])), { create: true });
        await writeUniquePdf(destination, output.name, output.bytes);
      }
      outputKind = 'folder';
    } else {
      const outputs = [];
      for (const [index, groups] of entries.entries()) {
        setProgress(`${index + 1} / ${entries.length} ZIP用PDFを作成中`);
        const output = await createProviderPdf(providerNameFor(groups[0]), groups[0].serviceMonth, groups, result.sources);
        outputs.push({ ...output, folder: destinationFor(groups[0]) });
      }
      const zip = await createZip(outputs, result.uniqueMonths[0] || '提供年月未確定');
      download(zip.blob, zip.name);
      outputKind = 'zip';
      outputName = zip.name;
    }
    downloaded = entries.length;
  } catch (error) {
    const detail = error instanceof Error ? error.message : '不明なエラー';
    alert(outputName ? `保存中にエラーが発生しました。一部のPDFが保存されている可能性があります。作成途中のフォルダ「${outputName}」を確認してください。\n${detail}` : `PDFの作成に失敗しました：${detail}`);
  } finally { busy = false; render(); }
}

void loadSavedData().then((data) => { savedData = data; render(); });
void loadOutputDirectoryHandle().then((handle) => { outputDirectoryHandle = handle; render(); }).catch(() => { /* 保存先の記憶が利用できない場合もフォルダ選択は可能 */ });
render();
