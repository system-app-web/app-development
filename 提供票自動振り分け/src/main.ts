import './style.css';
import './master.css';
import './folds.css';
import { analysePdfs, createFilePreview, createMergedProviderPdf, createProviderPdf, createZip, loadPdfFiles, renderPage, safeFilename } from './pdf-service';
import { DEFAULT_DELIVERY_METHODS, type AnalysisResult, type AppSavedData, type DeliveryMethodOption, type ProviderMasterEntry, type SlipGroup } from './types';
import { emptySavedData, exportSavedData, importSavedData, loadSavedData, saveSavedData } from './storage';
import { requestGeminiSuggestion } from './gemini-service';

const app = document.querySelector<HTMLDivElement>('#app')!;
let result: AnalysisResult | undefined;
let busy = false;
let deletingMasterNumber: string | undefined;
let masterActionError = '';
let deliveryMethodEditorOpen = false;
let deliveryMethodDraft: DeliveryMethodOption[] = [];
let downloaded = 0;
let outputName = '';
const stoppedGroupIds = new Set<string>();
let clientStopDialogOpen = false;
let clientSearchTerm = '';
let scrollToTopOnNextRender = false;
type QueuedPdf = { id: string; file: File; thumbnail?: string; pageCount?: number; previewAspectRatio?: number; previewError: boolean };
let queuedFiles: QueuedPdf[] = [];
let savedData: AppSavedData = emptySavedData();
const sectionOpen: Record<string, boolean | undefined> = {};

const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!);
const range = (group: SlipGroup) => group.pages.length === 1 ? `P${group.pages[0].serial}` : `P${group.pages[0].serial}〜${group.pages.at(-1)!.serial}`;
const deliveryMethodIssue = '送付方法が未設定です';
const groupStatus = (group: SlipGroup, singleFolderExport = false) => {
  if (stoppedGroupIds.has(group.id)) {
    const hasOtherIssue = group.issues.some((issue) => issue !== deliveryMethodIssue);
    return hasOtherIssue && group.needsReview && !group.reviewed ? '送付停止・要確認' : '送付停止';
  }
  const onlyDeliveryMethodMissing = group.issues.length > 0 && group.issues.every((issue) => issue === deliveryMethodIssue);
  if (singleFolderExport && group.needsReview && !group.reviewed && onlyDeliveryMethodMissing) return '一括保存対象';
  return group.needsReview && !group.reviewed ? '要確認' : '確認済み';
};
const download = (bytes: BlobPart, name: string) => { const url = URL.createObjectURL(new Blob([bytes])); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
const masterFor = (group: SlipGroup) => savedData.providerMaster.find((entry) => entry.providerNumber === group.providerNumber);
const providerNameFor = (group: SlipGroup) => masterFor(group)?.providerName.trim() || group.providerName.trim();
const destinationFor = (group: SlipGroup) => masterFor(group)?.deliveryMethod || '要確認';
function initializeProviderMasterOrder(data: AppSavedData) {
  if (data.providerMasterOrderInitialized) return false;
  data.providerMaster = [
    ...data.providerMaster.filter((entry) => !entry.deliveryMethod),
    ...data.providerMaster.filter((entry) => Boolean(entry.deliveryMethod)),
  ];
  data.providerMasterOrderInitialized = true;
  return true;
}
const deliveryMethodOptions = () => {
  const configured = savedData.deliveryMethods?.length ? savedData.deliveryMethods : DEFAULT_DELIVERY_METHODS;
  const mergeOption = { ...(configured.find((method) => method.value === 'PDF結合') ?? { value: 'PDF結合', name: 'PDF結合', folderName: 'PDF結合' }), name: 'PDF結合（自動FAX用）' };
  const methods = configured.filter((method) => method.value !== 'PDF結合');
  const otherIndex = methods.findIndex((method) => method.value === 'その他');
  methods.splice(otherIndex < 0 ? methods.length : otherIndex, 0, mergeOption);
  return methods;
};
const deliveryMethodNameFor = (value: string) => deliveryMethodOptions().find((method) => method.value === value)?.name || value;
const deliveryFolderNameFor = (value: string) => deliveryMethodOptions().find((method) => method.value === value)?.folderName || value;
const outputBlocked = (group: SlipGroup, allowMissingDeliveryMethod = false) => !group.providerNumber || !providerNameFor(group) || !group.clientName.trim() || !group.serviceMonth.trim() || (!allowMissingDeliveryMethod && !masterFor(group)?.deliveryMethod);
const persist = () => saveSavedData(savedData);
let singleFolderExportChecked = false;
const monthlyFolderTitle = (month: string) => {
  const monthNumber = month.match(/([0-9]{1,2})月/u)?.[1];
  return monthNumber ? `${Number(monthNumber)}月　提供表` : '提供年月未確定　提供表';
};
const normalizeClientName = (name: string) => name.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('ja');

function clientEntries(groups: SlipGroup[] = result?.groups ?? []) {
  const entries = new Map<string, { name: string; groups: SlipGroup[] }>();
  groups.forEach((group) => {
    const name = group.clientName.trim();
    const key = normalizeClientName(name);
    if (!key) return;
    const entry = entries.get(key) ?? { name, groups: [] };
    entry.groups.push(group);
    if (name.localeCompare(entry.name, 'ja') < 0) entry.name = name;
    entries.set(key, entry);
  });
  return [...entries.entries()].map(([key, entry]) => ({ key, ...entry }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

function clientOfficeEntries(entry: ReturnType<typeof clientEntries>[number]) {
  const offices = new Map<string, { key: string; name: string; groups: SlipGroup[] }>();
  entry.groups.forEach((group) => {
    const name = providerNameFor(group) || '事業所名未判定';
    const providerNumber = group.providerNumber.trim();
    const normalizedName = normalizedProviderName(name);
    const key = providerNumber ? `number:${providerNumber}` : normalizedName ? `name:${normalizedName}` : `group:${group.id}`;
    const office = offices.get(key) ?? { key, name, groups: [] };
    office.groups.push(group);
    if (name.localeCompare(office.name, 'ja') < 0) office.name = name;
    offices.set(key, office);
  });
  return [...offices.values()].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

const isStoppedGroup = (group: SlipGroup) => stoppedGroupIds.has(group.id);
const stoppedClientCount = (groups: SlipGroup[] = result?.groups ?? []) => clientEntries(groups).filter((entry) => entry.groups.some(isStoppedGroup)).length;
const stoppedOfficeCount = (groups: SlipGroup[] = result?.groups ?? []) => clientEntries(groups).reduce((total, entry) => total + clientOfficeEntries(entry).filter((office) => office.groups.every(isStoppedGroup)).length, 0);
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

function showRenderFailure(error: unknown) {
  console.error('画面の描画に失敗しました', error);
  app.innerHTML = `<main class="shell"><section class="card render-error" role="alert"><div><h2>画面の表示に問題が発生しました</h2><p>入力済みデータは保持されています。再表示をお試しください。</p><button class="primary" data-action="retry-render">再表示する</button></div></section></main>`;
  app.querySelector<HTMLButtonElement>('[data-action="retry-render"]')?.addEventListener('click', render);
}

function render() {
  try { renderView(); }
  catch (error) { showRenderFailure(error); }
}

function progressState(message: string) {
  const parts = message.match(/^(\d+)\s*\/\s*(\d+)\s*(.*)$/u);
  const current = parts ? Number(parts[1]) : undefined;
  const total = parts ? Number(parts[2]) : undefined;
  const stage = parts?.[3] || message;
  const ratio = total ? Math.min(1, (current ?? 0) / total) : 0;
  let percent = Math.round(ratio * 100);
  // Routing is made up of sequential phases. Reserve part of the bar for each
  // phase so the meter never jumps back to zero when the counter changes.
  if (current !== undefined && total !== undefined) {
    if (stage.includes('ファイルを確認中')) percent = Math.round(ratio * 15);
    else if (stage.includes('ページ解析中')) percent = 15 + Math.round(ratio * 70);
    else if (stage.includes('事業所情報を補助確認中')) percent = 85 + Math.round(ratio * 14);
  }
  return {
    stage,
    current,
    total,
    percent,
    unit: stage.includes('ページ') ? 'ページ' : stage.includes('ファイル') ? 'ファイル' : '件',
  };
}

function progressPanelMarkup(message: string) {
  const state = progressState(message);
  const hasCounter = state.current !== undefined && state.total !== undefined;
  return `<section class="progress-panel" role="status" aria-live="polite">
    <div class="progress-panel-heading"><div class="progress-panel-copy"><span>振り分け中</span><strong>${escapeHtml(state.stage)}</strong></div>
      ${hasCounter ? `<div class="progress-counter"><strong>${state.current}<small> / ${state.total}</small></strong><span>${state.unit}</span></div>` : '<i class="progress-spinner" aria-hidden="true"></i>'}
    </div>
    <div class="progress-track" ${hasCounter ? `role="progressbar" aria-label="${escapeHtml(state.stage)}" aria-valuemin="0" aria-valuemax="${state.total}" aria-valuenow="${state.current}"` : 'aria-hidden="true"'}><span style="width:${hasCounter ? `${state.percent}%` : '32%'}" class="${hasCounter ? '' : 'indeterminate'}"></span></div>
    <p class="progress-hint">処理が終わるまで、この画面を閉じずにお待ちください。</p>
  </section>`;
}

function updateProgressPanel(message: string) {
  const panel = app.querySelector<HTMLElement>('.progress-panel');
  if (!panel) return false;
  const state = progressState(message);
  const hasCounter = state.current !== undefined && state.total !== undefined;
  const stage = panel.querySelector<HTMLElement>('.progress-panel-copy strong');
  if (stage) stage.textContent = state.stage;

  let counter = panel.querySelector<HTMLElement>('.progress-counter');
  const spinner = panel.querySelector<HTMLElement>('.progress-spinner');
  if (hasCounter) {
    if (!counter && spinner) {
      spinner.outerHTML = '<div class="progress-counter"><strong></strong><span></span></div>';
      counter = panel.querySelector<HTMLElement>('.progress-counter');
    }
    const count = counter?.querySelector<HTMLElement>('strong');
    if (count) count.innerHTML = `${state.current}<small> / ${state.total}</small>`;
    const unit = counter?.querySelector<HTMLElement>('span');
    if (unit) unit.textContent = state.unit;
  } else if (counter) {
    counter.outerHTML = '<i class="progress-spinner" aria-hidden="true"></i>';
  }

  const track = panel.querySelector<HTMLElement>('.progress-track');
  const fill = track?.querySelector<HTMLElement>('span');
  if (track && fill) {
    if (hasCounter) {
      track.removeAttribute('aria-hidden');
      track.setAttribute('role', 'progressbar');
      track.setAttribute('aria-label', state.stage);
      track.setAttribute('aria-valuemin', '0');
      track.setAttribute('aria-valuemax', String(state.total));
      track.setAttribute('aria-valuenow', String(state.current));
    } else {
      track.removeAttribute('role');
      track.removeAttribute('aria-label');
      track.removeAttribute('aria-valuemin');
      track.removeAttribute('aria-valuemax');
      track.removeAttribute('aria-valuenow');
      track.setAttribute('aria-hidden', 'true');
    }
    fill.style.width = hasCounter ? `${state.percent}%` : '32%';
    fill.classList.toggle('indeterminate', !hasCounter);
  }
  return true;
}

function renderView() {
  document.querySelectorAll<HTMLDetailsElement>('details[data-section]').forEach((section) => {
    const key = section.dataset.section;
    if (key) sectionOpen[key] = section.open;
  });
  const scrollPosition = scrollToTopOnNextRender ? 0 : window.scrollY;
  scrollToTopOnNextRender = false;
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
  const activeGroups = groups.filter((group) => !isStoppedGroup(group));
  const masterSetupProviderNumbers = new Set(activeGroups.filter((group) => group.providerNumber && !masterFor(group)?.deliveryMethod).map((group) => group.providerNumber));
  const masterSetupCount = masterSetupProviderNumbers.size;
  if (!masterSetupCount) singleFolderExportChecked = false;
  const singleFolderExport = singleFolderExportChecked && masterSetupCount > 0;
  const reviewKeys = new Set<string>();
  groups.forEach((group) => {
    const stopped = isStoppedGroup(group);
    const masterRouteMissing = Boolean(group.providerNumber && masterSetupProviderNumbers.has(group.providerNumber));
    if (group.needsReview && !group.reviewed) {
      if (stopped) {
        const hasOtherReview = group.issues.some((issue) => issue !== deliveryMethodIssue)
          || !group.clientName.trim() || !providerNameFor(group) || !group.serviceMonth.trim();
        if (hasOtherReview) reviewKeys.add(`group:${group.id}`);
      } else if (masterRouteMissing) {
        if (!singleFolderExport) reviewKeys.add(`master:${group.providerNumber}`);
        if (group.issues.some((issue) => issue !== '送付方法が未設定です') || !group.clientName.trim() || !providerNameFor(group) || !group.serviceMonth.trim()) reviewKeys.add(`group:${group.id}`);
      } else reviewKeys.add(`group:${group.id}`);
    }
  });
  if (!singleFolderExport) masterSetupProviderNumbers.forEach((number) => reviewKeys.add(`master:${number}`));
  else activeGroups.forEach((group) => {
    if (!group.providerNumber || !masterSetupProviderNumbers.has(group.providerNumber)) return;
    const hasOtherReview = group.issues.some((issue) => issue !== deliveryMethodIssue)
      || !group.clientName.trim() || !providerNameFor(group) || !group.serviceMonth.trim();
    if (!hasOtherReview) reviewKeys.delete(`group:${group.id}`);
  });
  const reviewCount = reviewKeys.size + (result?.duplicateFiles.length ?? 0);
  const blockedCount = groups.filter((group) => outputBlocked(group, singleFolderExport || isStoppedGroup(group))).length;
  const mixedMonths = Boolean(result && result.uniqueMonths.length !== 1);
  const canExport = Boolean(result && !busy && !queuedFiles.length && reviewCount === 0 && blockedCount === 0 && !mixedMonths && assigned === result.totalPages && groups.length);
  const progressMessage = app.dataset.progress || '処理を準備中';
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
      ${fixedSection('intake', busy ? '振り分け中' : result && !queuedFiles.length ? '振り分け結果と保存' : 'サービス提供票PDFを入れる', result ? `<button class="primary reset-button header-reset-button" data-action="reset" ${busy ? 'disabled' : ''}>リセット</button>` : queuedFiles.length || busy ? `<span class="fold-meta">${queuedFiles.length ? `選択中 ${queuedFiles.length}件 · 開始前` : '処理中'}</span>` : '', `
        ${busy ? progressPanelMarkup(progressMessage) : queuedFiles.length || !result ? `
          <div class="dropzone ${queuedFiles.length ? 'with-previews' : ''}" id="dropzone" role="region" aria-label="PDFのドラッグ・ドロップ欄">
            ${queuedFiles.length ? queuePanel() : `
            <div class="drop-icon">↓</div><strong>サービス提供票PDFをここにドラッグ＆ドロップ</strong>
            <button class="primary" data-action="choose">PDFを選択</button>
            <button class="link-button" data-action="folder">フォルダを選択</button>
            `}
            <input id="fileInput" type="file" accept="application/pdf,.pdf" multiple hidden>
            <input id="folderInput" type="file" accept="application/pdf,.pdf" webkitdirectory multiple hidden>
          </div>
        ` : outputPanel(canExport, reviewCount, blockedCount, masterSetupCount, mixedMonths, groups.length, assigned, result.totalPages, singleFolderExport)}
      `)}
      ${masterArea(singleFolderExport)}
      ${result && !busy ? reviewArea(groups, reviewCount, assigned, singleFolderExport) : ''}
    </main>
    <dialog id="previewDialog" class="preview-dialog" aria-labelledby="previewTitle"><form method="dialog"><button class="close" aria-label="閉じる"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></form><h3 id="previewTitle" tabindex="-1" autofocus>元PDFページ</h3><div id="previewPages" class="preview-pages"></div></dialog>
    ${clientStopDialogOpen && result && !busy ? clientStopDialog(groups) : ''}
    ${deliveryMethodEditor()}`;
  bindEvents();
  if (deliveryMethodEditorOpen) app.querySelector<HTMLDialogElement>('#deliveryMethodDialog')?.showModal();
  if (clientStopDialogOpen && result && !busy) app.querySelector<HTMLDialogElement>('#clientStopDialog')?.showModal();
  requestAnimationFrame(() => {
    try {
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
      nextFocus?.focus({ preventScroll: true });
      window.scrollTo(0, scrollPosition);
    } catch (error) { showRenderFailure(error); }
  });
}

function foldSection(key: string, title: string, meta: string, content: string, defaultOpen = false) {
  const open = sectionOpen[key] ?? defaultOpen;
  return `<details class="card fold-section ${key}-section" data-section="${key}" ${open ? 'open' : ''}><summary class="fold-summary"><span class="fold-title">${title}</span><span class="fold-meta">${meta}</span><i aria-hidden="true"></i></summary><div class="fold-body">${content}</div></details>`;
}

function fixedSection(key: string, title: string, meta: string, content: string) {
  return `<section class="card fold-section ${key}-section"><div class="fold-summary intake-fixed-summary"><span class="fold-title">${title}</span>${meta}</div><div class="fold-body">${content}</div></section>`;
}

function outputPanel(canExport: boolean, reviewCount: number, blockedCount: number, masterSetupCount: number, mixedMonths: boolean, groupCount: number, assigned: number, totalPages: number, singleFolderExport: boolean) {
  const reason = reviewCount ? `要確認 ${reviewCount}件を確認してから保存できます。` : blockedCount ? `必須情報または振り分け先が未設定の ${blockedCount}件を先に確認してください。` : mixedMonths ? '対象年月が1か月に揃ってから保存できます。' : '';
  const statusLabel = canExport ? '保存可能' : masterSetupCount && !singleFolderExport ? '事業所マスタ未設定' : '確認が必要';
  const downloadButton = `<button class="primary output-button output-button-large" data-action="create" ${canExport && !busy ? '' : 'disabled'}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H10l2 2h7.5A1.5 1.5 0 0 1 21 9.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/><path d="M3.5 11h17"/></svg>${busy ? 'ZIPを作成中…' : '振り分け完了フォルダをダウンロード'}</button>`;
  const saveReason = !canExport && !masterSetupCount ? `<div class="output-status">${escapeHtml(reason || '内容を確認してから保存できます。')}</div>` : '';
  const saveActions = `<div class="result-save-row has-master-setup"><div class="result-save-actions has-master-setup">
    <div class="master-action-column"><button class="primary master-jump-button" data-action="go-master" ${canExport ? 'disabled' : ''}>事業所マスタへ移動</button></div>
    <div class="stop-action-column">${clientStopControl()}</div>
    <div class="download-action-column">${downloadButton}<label class="single-folder-option ${canExport ? 'is-locked' : ''}"><span class="single-folder-choice"><input type="checkbox" data-action="single-folder-export" ${singleFolderExport ? 'checked' : ''} ${canExport ? 'disabled' : ''}><span>送付方法を使用しない方は一括して一つのフォルダに作成</span></span><small>チェックすると、送付方法が未設定でも保存できます。</small></label></div>
  </div></div>`;
  return `<section class="result-actions">
    <div class="result-actions-heading"><div><span class="eyebrow">振り分け完了</span><h2>${groupCount}件を振り分けました</h2></div></div>
    <div class="result-counts"><div><span>要確認</span><strong>${reviewCount}<small>件</small></strong></div><div><span>ページ</span><strong>${assigned}<small> / ${totalPages}</small></strong></div><div><span>状態</span><strong class="${canExport ? 'ready' : 'needs-review'}">${statusLabel}</strong></div></div>
    ${saveReason}${saveActions}
  </section>`;
}

function queuePanel() {
  if (!queuedFiles.length) return '';
  const previewPending = queuedFiles.some((item) => !item.thumbnail && !item.previewError);
  return `<div class="pdf-queue-content" aria-label="振り分けるPDF">
    <div class="pdf-queue-heading"><div><strong>振り分けるPDF（${queuedFiles.length}件）</strong><span>続けてドラッグするか、追加ボタンでPDFを増やせます。</span></div><div class="pdf-queue-tools"><button class="quiet" data-action="choose" ${busy ? 'disabled' : ''}>PDFを追加</button><button class="quiet" data-action="folder" ${busy ? 'disabled' : ''}>フォルダを追加</button></div></div>
    <div class="pdf-queue-grid">${queuedFiles.map((item) => `<article class="pdf-queue-item">
      <div class="pdf-thumb" ${item.previewAspectRatio ? `style="aspect-ratio:${item.previewAspectRatio}"` : ''}>${item.thumbnail ? `<img src="${escapeHtml(item.thumbnail)}" alt="${escapeHtml(item.file.name)}の1ページ目">` : item.previewError ? `<span class="pdf-thumb-message">プレビューを表示できません<br>振り分けは可能です</span>` : `<span class="pdf-thumb-loading">プレビュー作成中…</span>`}</div>
      <strong class="pdf-queue-name" title="${escapeHtml(item.file.name)}">${escapeHtml(item.file.name)}</strong>
      <span class="pdf-queue-pages">${item.pageCount ? `${item.pageCount}ページ` : item.previewError ? 'PDFを確認してください' : '読み込み中'}</span>
      <button class="pdf-queue-delete" data-action="remove-queued" data-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.file.name)}を一覧から削除" title="一覧から削除" ${busy ? 'disabled' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/></svg></button>
    </article>`).join('')}</div>
    <div class="pdf-queue-summary"><span>不要なPDFはゴミ箱で外せます。元ファイルは削除されません。</span><div class="pdf-start-control">${previewPending ? '<span class="pdf-start-instruction">プレビューの準備ができるまでお待ちください。</span>' : ''}<button class="primary pdf-start" data-action="start-routing" ${busy || previewPending ? 'disabled' : ''}>${busy ? '振り分け中…' : previewPending ? 'プレビュー作成中…' : '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5a1 1 0 0 1 1.5-.86l10 6.5a1 1 0 0 1 0 1.72l-10 6.5A1 1 0 0 1 8 18.5z"/></svg>自動振り分け開始'}</button></div></div>
  </div>`;
}

function masterArea(singleFolderExport: boolean) {
  // 設定状況の変化で一覧内の位置が動かないよう、保存されている順序をそのまま使う。
  const entries = [...savedData.providerMaster];
  const needsSetup = entries.filter((entry) => !entry.providerName.trim() || !entry.deliveryMethod).length;
  const needsRoute = entries.filter((entry) => !entry.deliveryMethod).length;
  return foldSection('master', '事業所マスタ', `${needsSetup ? `要設定 ${needsSetup}件 · ` : ''}登録 ${entries.length}件`, `<div class="section-head master-head"><div><h2>事業所番号と振り分け先・送付方法</h2></div><div class="backup-buttons"><button class="quiet" data-action="edit-delivery-methods">送付方法項目編集</button><button class="quiet" data-action="backup">バックアップ</button><button class="quiet" data-action="import">データ挿入</button><input id="backupInput" type="file" accept="application/json,.json" hidden></div></div>
    ${needsSetup ? `<div class="master-alert" role="status"><strong>${needsRoute ? '振り分け先を選択してください' : '事業所名を入力してください'}</strong><span>${singleFolderExport && needsRoute ? '今回の一括保存では送付方法を使いません。事業所名など、ほかの不足情報は通常どおり確認してください。' : needsRoute ? '赤色の欄を設定しないとダウンロードできません。' : '色の付いた欄を確認してください。'}</span></div>` : ''}
    ${masterActionError ? `<div class="master-operation-error" role="alert">${escapeHtml(masterActionError)}</div>` : ''}
    ${entries.length ? `<div class="table-wrap master-table" data-scroll-area="master"><table><thead><tr><th>10桁の事業所番号</th><th>事業所名（略称可）</th><th>振り分け先・送付方法</th><th></th></tr></thead><tbody>${entries.map((entry) => { const missingName = !entry.providerName.trim(); const missingRoute = !entry.deliveryMethod; const state = missingName ? 'needs-name' : missingRoute ? 'needs-route' : 'registered'; const label = missingName ? (missingRoute ? '名称・振り分け先を入力' : '事業所名を入力') : missingRoute ? '振り分け先を選択' : '登録済み'; const isDeleting = deletingMasterNumber === entry.providerNumber; return `<tr data-master="${escapeHtml(entry.providerNumber)}" class="master-${state}"><td>${escapeHtml(entry.providerNumber)}<small class="master-status ${state}">${label}</small></td><td><input data-master-field="providerName" value="${escapeHtml(entry.providerName)}"></td><td><select data-master-field="deliveryMethod" class="${missingRoute ? 'master-route-unset' : ''}"><option value="" ${entry.deliveryMethod === '' ? 'selected' : ''}>未設定（要確認）</option>${deliveryMethodOptions().map((method) => `<option value="${escapeHtml(method.value)}" ${entry.deliveryMethod === method.value ? 'selected' : ''}>${escapeHtml(method.name)}</option>`).join('')}</select></td><td><button class="quiet master-delete-button" data-action="delete-master" data-number="${escapeHtml(entry.providerNumber)}" ${deletingMasterNumber ? 'disabled' : ''}>${isDeleting ? '<i class="progress-spinner small" aria-hidden="true"></i>削除中…' : '削除'}</button></td></tr>`; }).join('')}</tbody></table></div>` : `<p class="empty-master">PDFを解析すると、新しい事業所番号がここに追加されます。送付方法が未設定の書類は必ず「要確認」になります。</p>`}
  `, true);
}

function deliveryMethodEditor() {
  return `<dialog id="deliveryMethodDialog" class="delivery-method-dialog" aria-labelledby="deliveryMethodTitle">
    <div class="delivery-method-dialog-head"><div><span class="eyebrow">事業所マスタ</span><h2 id="deliveryMethodTitle">送付方法項目編集</h2></div><button type="button" class="delivery-method-close" data-action="cancel-delivery-methods" aria-label="閉じる"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
    <p class="delivery-method-help">表示名は事業所マスタの選択肢に、保存フォルダ名はダウンロード時のフォルダ名に使われます。</p>
    <div class="delivery-method-list">${deliveryMethodDraft.map((method, index) => `<div class="delivery-method-edit-row">
      <label><span>送付方法の表示名</span><input data-delivery-method-field="name" data-index="${index}" value="${escapeHtml(method.name)}" maxlength="60"></label>
      <label><span>ダウンロード時のフォルダ名</span><input data-delivery-method-field="folderName" data-index="${index}" value="${escapeHtml(method.folderName)}" maxlength="80"></label>
      ${method.value === '居宅療養' ? '<span class="delivery-method-fixed">自動振り分け項目</span>' : method.value === 'PDF結合' ? '<span class="delivery-method-fixed">結合処理項目</span>' : `<button type="button" class="quiet delivery-method-remove" data-action="remove-delivery-method" data-index="${index}">削除</button>`}
    </div>`).join('')}</div>
    <button type="button" class="quiet delivery-method-add" data-action="add-delivery-method">＋ 送付方法を追加</button>
    <div class="delivery-method-actions"><button type="button" class="quiet" data-action="cancel-delivery-methods">キャンセル</button><button type="button" class="primary" data-action="save-delivery-methods">保存</button></div>
  </dialog>`;
}

function summaryArea(groups: SlipGroup[], reviewCount: number) {
  const userCount = clientEntries(groups).length;
  const officeCount = new Set(groups.map((group) => {
    if (group.providerNumber.trim()) return `number:${group.providerNumber.trim()}`;
    const providerName = normalizedProviderName(group.providerName);
    return providerName ? `name:${providerName}` : '';
  }).filter(Boolean)).size;
  return `<section class="summary-grid">
    <article><span>総ページ数</span><b>${result!.totalPages}ページ</b></article><article><span>利用者数</span><b>${userCount}名</b></article><article><span>事業所数</span><b>${officeCount}件</b></article><article><span>要確認</span><b class="${reviewCount ? 'danger' : 'good'}">${reviewCount}件</b></article>
  </section>`;
}

function clientStopControl() {
  const stoppedUsers = stoppedClientCount();
  const stoppedOffices = stoppedOfficeCount();
  return `<button type="button" class="primary client-stop-open" data-action="open-client-stops">利用者一覧・停止設定</button>${stoppedOffices ? `<small class="client-stop-current">今回停止対象：${stoppedUsers}名・${stoppedOffices}事業所分</small>` : ''}`;
}

function clientStopDialog(groups: SlipGroup[]) {
  const entries = clientEntries(groups);
  const unnamedGroups = groups.filter((group) => !normalizeClientName(group.clientName)).length;
  const stoppedCount = stoppedClientCount(groups);
  const stoppedOffices = stoppedOfficeCount(groups);
  const searchQuery = normalizeClientName(clientSearchTerm);
  const visibleCount = entries.filter((entry) => {
    const officeNames = clientOfficeEntries(entry).map((office) => office.name);
    return !searchQuery || normalizeClientName([entry.name, ...officeNames].join(' ')).includes(searchQuery);
  }).length;
  const rows = entries.map((entry, index) => {
    const allStopped = entry.groups.every(isStoppedGroup);
    const offices = clientOfficeEntries(entry);
    const stoppedForClient = offices.filter((office) => office.groups.every(isStoppedGroup)).length;
    const search = normalizeClientName([entry.name, ...offices.map((office) => office.name)].join(' '));
    const pageCount = entry.groups.reduce((total, group) => total + group.pages.length, 0);
    return `<article class="client-stop-row" data-client-row data-search="${escapeHtml(search)}" ${searchQuery && !search.includes(searchQuery) ? 'hidden' : ''} role="listitem">
      <div class="client-stop-main"><div class="client-stop-name-line"><strong>${escapeHtml(entry.name)}</strong><span class="client-stop-inline-help">今回停止する事業所をクリックしてください</span></div><div class="client-stop-offices">${offices.map((office, officeIndex) => {
        const stopped = office.groups.every(isStoppedGroup);
        return `<button type="button" class="client-stop-office-chip ${stopped ? 'is-stopped' : ''}" data-action="toggle-office-stop" data-client-index="${index}" data-office-index="${officeIndex}" aria-pressed="${stopped}" aria-label="${escapeHtml(office.name)}、${stopped ? '停止中。クリックすると再開します' : '通常振り分け。クリックすると今回停止します'}" title="${stopped ? '停止中（クリックすると再開）' : 'クリックすると今回停止します'}"><span>${escapeHtml(office.name)}</span></button>`;
      }).join('')}</div><small>${offices.length}事業所・${pageCount}ページ${stoppedForClient ? `・${stoppedForClient}事業所停止中` : ''}</small></div>
      <div class="client-stop-actions"><button type="button" class="client-stop-all ${allStopped ? 'is-resume' : ''}" data-action="toggle-client-stop" data-client-index="${index}">${allStopped ? '全て再開する' : '全て停止する'}</button></div>
    </article>`;
  }).join('');
  const listMarkup = `<p class="client-stop-help">利用がない方は「全て停止する」を選ぶか、利用者名の下にある事業所名をクリックして事業所ごとに停止してください。停止したPDFは通常の送付先フォルダには入れず、ZIP内の「送付停止・確認用」フォルダに残します。PDF自体は削除されません。設定を変えた場合はZIPを再作成してください。</p>
      <p class="client-stop-caution">利用者名をもとにまとめています。同じ名前の方を個別には区別できないため、停止する前に事業所名とページ数を確認してください。停止設定は今回の振り分け限りで、次回はリセットされます。</p>
      <div class="client-stop-toolbar"><span>判定できた利用者 <b>${entries.length}名</b> · 停止対象 <b>${stoppedCount}名・${stoppedOffices}事業所分</b>${unnamedGroups ? ` · 名前未判定 ${unnamedGroups}件` : ''}</span><label><span class="sr-only">利用者を検索</span><input type="search" data-action="search-clients" value="${escapeHtml(clientSearchTerm)}" placeholder="利用者名・事業所名で検索"></label></div>
      ${unnamedGroups ? `<p class="client-stop-unnamed">利用者名を判定できなかった${unnamedGroups}件は、一覧から停止できません。振り分け内容で名前を確認してください。</p>` : ''}
      <div class="client-stop-list" data-scroll-area="client-stop-list" role="list">${rows || '<p class="client-stop-empty">利用者名を判定できたPDFがありません。</p>'}<p class="client-stop-no-match" ${entries.length && searchQuery && !visibleCount ? '' : 'hidden'}>検索に一致する利用者はいません。</p></div>`;
  return `<dialog id="clientStopDialog" class="client-stop-dialog" aria-labelledby="clientStopTitle">
    <div class="client-stop-dialog-head"><div><span class="eyebrow">今回の振り分けだけに適用</span><h2 id="clientStopTitle">利用者一覧・停止設定</h2></div><button type="button" class="client-stop-close" data-action="close-client-stops" aria-label="閉じる"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
    ${listMarkup}
    <div class="client-stop-dialog-actions"><button type="button" class="primary" data-action="close-client-stops">閉じる</button></div>
  </dialog>`;
}

function reviewArea(groups: SlipGroup[], reviewCount: number, assigned: number, singleFolderExport: boolean) {
  const providers = new Map<string, SlipGroup[]>();
  groups.forEach((group) => { const name = `${deliveryMethodNameFor(destinationFor(group))}｜${providerNameFor(group) || '事業所名未判定'}（${group.providerNumber || '番号未判定'}）`; providers.set(name, [...(providers.get(name) ?? []), group]); });
  const month = result!.uniqueMonths.length === 1 ? result!.uniqueMonths[0] : '提供年月未確定';
  return `
    ${result!.duplicateFiles.length ? `<section class="warning"><strong>重複して投入されたPDFがあります</strong><span>${result!.duplicateFiles.map(escapeHtml).join('、')}</span><button data-action="ack-duplicates" class="quiet">内容を確認して続行</button></section>` : ''}
    ${foldSection('verification', '振り分け内容を確認', `${reviewCount ? `要確認 ${reviewCount}件` : '要確認なし'} · ${groups.length}件`, `
      <div class="section-head"><div><p>名前や事業所名を修正できます。${singleFolderExport ? '送付方法未設定は今回の一括保存では使いません。ほかの要確認は解消してください。' : '要確認が残る間は出力できません。'}</p></div><div class="check-total ${assigned === result!.totalPages ? 'good' : 'danger'}">ページ整合性：${assigned} / ${result!.totalPages}</div></div>
      <div class="table-wrap" data-scroll-area="verification"><table><thead><tr><th>状態</th><th>振り分け先</th><th>事業所名・番号</th><th>利用者名</th><th>ページ</th><th>提供年月</th><th>確認</th></tr></thead><tbody>
        ${groups.map((group) => {
          const stopped = isStoppedGroup(group);
          const onlyDeliveryMethodMissing = group.issues.length > 0 && group.issues.every((issue) => issue === deliveryMethodIssue);
          const bypassedMissingMethod = (stopped || singleFolderExport) && group.needsReview && !group.reviewed && onlyDeliveryMethodMissing;
          const needsReview = group.needsReview && !group.reviewed && !bypassedMissingMethod;
          const issues = group.issues.filter((issue) => !(stopped && issue === deliveryMethodIssue)).map((issue) => issue === deliveryMethodIssue && singleFolderExport ? '送付方法は今回使用しません' : issue);
          return `<tr data-id="${group.id}" class="${needsReview ? 'needs-review' : ''}"><td><span class="status ${stopped ? 'stopped' : needsReview ? 'warn' : 'ok'}">${groupStatus(group, singleFolderExport)}</span>${issues.length ? `<small>${issues.map(escapeHtml).join(' / ')}</small>` : ''}</td><td><b>${stopped ? '送付停止' : escapeHtml(deliveryMethodNameFor(destinationFor(group)))}</b></td><td><input data-field="providerName" value="${escapeHtml(group.providerName)}" aria-label="事業所名"></td><td><input class="inline-input" data-field="clientName" value="${escapeHtml(group.clientName)}" aria-label="利用者名"></td><td><div class="verification-page-cell"><span>${range(group)}</span><button class="quiet page-preview-link" data-action="preview" data-id="${group.id}">PDFを見る</button></div></td><td><input data-field="serviceMonth" value="${escapeHtml(group.serviceMonth)}" aria-label="提供年月"></td><td>${needsReview ? `<button class="confirm" data-action="confirm" data-id="${group.id}">確認済みにする</button>` : '<span class="muted">確認済み</span>'}</td></tr>`;
        }).join('')}
      </tbody></table></div>
    `, false)}
    ${downloaded ? foldSection('complete', 'ZIPをダウンロードしました', `${downloaded}件のPDF · ${escapeHtml(outputName)}`, `<div class="complete-content"><p>元PDF：${result!.sources.length}ファイル　総ページ数：${result!.totalPages}ページ　利用者：${clientEntries(groups).length}名　事業所：${providers.size}事業所　作成PDF：${downloaded}件　停止対象：${stoppedClientCount(groups)}名・${stoppedOfficeCount(groups)}事業所分${stoppedOfficeCount(groups) ? '（ZIP内の「送付停止・確認用」フォルダ）' : ''}　要確認：${reviewCount}件</p><button class="primary" data-action="create">もう一度作成して保存</button></div>`, true) : ''}
    `;
}

function setProgress(message: string) {
  app.dataset.progress = message;
  if (!updateProgressPanel(message)) render();
}

function showIntakeProgress() {
  scrollToTopOnNextRender = true;
}

function saveDeliveryMethodDraft() {
  const options = deliveryMethodDraft.map((method) => ({ value: method.value, name: method.name.trim(), folderName: method.folderName.trim() }));
  if (!options.length || options.some((method) => !method.name || !method.folderName)) {
    alert('送付方法名と保存フォルダ名を入力してください。');
    return;
  }
  const normalizedNames = options.map((method) => method.name.normalize('NFKC').toLocaleLowerCase('ja'));
  if (new Set(normalizedNames).size !== normalizedNames.length || new Set(options.map((method) => method.value)).size !== options.length) {
    alert('送付方法の表示名が重複しています。別の名前にしてください。');
    return;
  }

  const nextValues = new Set(options.map((method) => method.value));
  const removedValues = new Set(deliveryMethodOptions().filter((method) => !nextValues.has(method.value)).map((method) => method.value));
  const affectedEntries = savedData.providerMaster.filter((entry) => removedValues.has(entry.deliveryMethod));
  if (affectedEntries.length && !confirm(`削除する送付方法を使っている事業所が${affectedEntries.length}件あります。保存すると、その事業所の送付方法は「未設定」に戻ります。続けますか？`)) return;

  const previousOptions = savedData.deliveryMethods;
  const previousMaster = savedData.providerMaster.map((entry) => ({ ...entry }));
  const previousGroups = result?.groups.map((group) => ({ ...group, issues: [...group.issues] }));
  try {
    savedData.deliveryMethods = options;
    if (removedValues.size) {
      const updatedAt = new Date().toISOString();
      savedData.providerMaster.forEach((entry) => {
        if (removedValues.has(entry.deliveryMethod)) {
          entry.deliveryMethod = '';
          entry.updatedAt = updatedAt;
        }
      });
    }
    persist();
    refreshRoutingSafety();
  } catch (error) {
    console.error('送付方法項目の保存に失敗しました', error);
    savedData.deliveryMethods = previousOptions;
    savedData.providerMaster = previousMaster;
    if (result && previousGroups) result.groups = previousGroups;
    try { persist(); } catch { /* 画面上の状態は復元し、保存エラーを案内します */ }
    alert('設定を保存できませんでした。変更を元に戻しました。');
    return;
  }
  deliveryMethodEditorOpen = false;
  deliveryMethodDraft = [];
  render();
}

function bindEvents() {
  document.querySelectorAll<HTMLDetailsElement>('details[data-section]').forEach((section) => section.addEventListener('toggle', () => {
    const key = section.dataset.section;
    if (key) sectionOpen[key] = section.open;
  }));
  document.querySelector('[data-action="edit-delivery-methods"]')?.addEventListener('click', () => {
    deliveryMethodDraft = deliveryMethodOptions().map((method) => ({ ...method }));
    deliveryMethodEditorOpen = true;
    render();
  });
  document.querySelectorAll<HTMLInputElement>('[data-delivery-method-field]').forEach((input) => input.addEventListener('input', () => {
    const method = deliveryMethodDraft[Number(input.dataset.index)];
    if (!method) return;
    method[input.dataset.deliveryMethodField as 'name' | 'folderName'] = input.value;
  }));
  document.querySelector('[data-action="add-delivery-method"]')?.addEventListener('click', () => {
    deliveryMethodDraft.push({ value: `custom:${crypto.randomUUID()}`, name: '', folderName: '' });
    render();
    app.querySelector<HTMLInputElement>(`[data-delivery-method-field="name"][data-index="${deliveryMethodDraft.length - 1}"]`)?.focus();
  });
  document.querySelectorAll<HTMLElement>('[data-action="remove-delivery-method"]').forEach((button) => button.addEventListener('click', () => {
    deliveryMethodDraft.splice(Number(button.dataset.index), 1);
    render();
  }));
  document.querySelector('[data-action="save-delivery-methods"]')?.addEventListener('click', saveDeliveryMethodDraft);
  document.querySelectorAll<HTMLElement>('[data-action="cancel-delivery-methods"]').forEach((button) => button.addEventListener('click', () => {
    deliveryMethodEditorOpen = false;
    deliveryMethodDraft = [];
    render();
  }));
  app.querySelector<HTMLDialogElement>('#deliveryMethodDialog')?.addEventListener('cancel', (event) => {
    event.preventDefault();
    deliveryMethodEditorOpen = false;
    deliveryMethodDraft = [];
    render();
  });
  app.querySelector('[data-action="open-client-stops"]')?.addEventListener('click', () => {
    clientSearchTerm = '';
    clientStopDialogOpen = true;
    render();
    requestAnimationFrame(() => app.querySelector<HTMLInputElement>('[data-action="search-clients"]')?.focus({ preventScroll: true }));
  });
  app.querySelectorAll<HTMLElement>('[data-action="close-client-stops"]').forEach((button) => button.addEventListener('click', () => {
    clientStopDialogOpen = false;
    render();
  }));
  app.querySelector<HTMLDialogElement>('#clientStopDialog')?.addEventListener('cancel', (event) => {
    event.preventDefault();
    clientStopDialogOpen = false;
    render();
  });
  app.querySelector<HTMLInputElement>('[data-action="search-clients"]')?.addEventListener('input', (event) => {
    const input = event.currentTarget as HTMLInputElement;
    clientSearchTerm = input.value;
    const query = normalizeClientName(clientSearchTerm);
    let visibleCount = 0;
    app.querySelectorAll<HTMLElement>('[data-client-row]').forEach((row) => {
      row.hidden = Boolean(query && !normalizeClientName(row.dataset.search ?? '').includes(query));
      if (!row.hidden) visibleCount++;
    });
    const noMatch = app.querySelector<HTMLElement>('.client-stop-no-match');
    if (noMatch) noMatch.hidden = visibleCount > 0;
  });
  app.querySelectorAll<HTMLButtonElement>('[data-action="toggle-client-stop"]').forEach((button) => button.addEventListener('click', () => {
    const entry = clientEntries()[Number(button.dataset.clientIndex)];
    if (!entry) return;
    const wasStopped = entry.groups.every(isStoppedGroup);
    entry.groups.forEach((group) => {
      if (wasStopped) stoppedGroupIds.delete(group.id);
      else stoppedGroupIds.add(group.id);
    });
    // 既に保存したZIPは自動更新できないため、設定変更後は作成完了表示を取り下げます。
    downloaded = 0;
    outputName = '';
    render();
    requestAnimationFrame(() => app.querySelector<HTMLButtonElement>(`[data-action="toggle-client-stop"][data-client-index="${button.dataset.clientIndex}"]`)?.focus({ preventScroll: true }));
  }));
  app.querySelectorAll<HTMLButtonElement>('[data-action="toggle-office-stop"]').forEach((button) => button.addEventListener('click', () => {
    const entry = clientEntries()[Number(button.dataset.clientIndex)];
    const office = entry ? clientOfficeEntries(entry)[Number(button.dataset.officeIndex)] : undefined;
    if (!office) return;
    const wasStopped = office.groups.every(isStoppedGroup);
    office.groups.forEach((group) => {
      if (wasStopped) stoppedGroupIds.delete(group.id);
      else stoppedGroupIds.add(group.id);
    });
    downloaded = 0;
    outputName = '';
    render();
    requestAnimationFrame(() => app.querySelector<HTMLButtonElement>(`[data-action="toggle-office-stop"][data-client-index="${button.dataset.clientIndex}"][data-office-index="${button.dataset.officeIndex}"]`)?.focus({ preventScroll: true }));
  }));
  document.querySelector<HTMLInputElement>('[data-action="single-folder-export"]')?.addEventListener('change', (event) => {
    singleFolderExportChecked = (event.currentTarget as HTMLInputElement).checked;
    render();
    app.querySelector<HTMLInputElement>('[data-action="single-folder-export"]')?.focus({ preventScroll: true });
  });
  document.querySelector('[data-action="choose"]')?.addEventListener('click', (event) => { event.stopPropagation(); document.querySelector<HTMLInputElement>('#fileInput')?.click(); });
  document.querySelector('[data-action="folder"]')?.addEventListener('click', (event) => { event.stopPropagation(); document.querySelector<HTMLInputElement>('#folderInput')?.click(); });
  document.querySelector('[data-action="reset"]')?.addEventListener('click', () => {
    if (busy || !confirm('振り分け結果と選択中PDFの一覧をリセットします。元のPDFファイルは削除されません。よろしいですか？')) return;
    queuedFiles = []; result = undefined; downloaded = 0; outputName = ''; singleFolderExportChecked = false; stoppedGroupIds.clear(); clientStopDialogOpen = false; clientSearchTerm = ''; render();
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
    result?.groups.filter((group) => !isStoppedGroup(group)).forEach((group) => {
      if (group.providerNumber && !savedData.providerMaster.some((entry) => entry.providerNumber === group.providerNumber) && !missingEntries.has(group.providerNumber)) {
        missingEntries.set(group.providerNumber, { providerNumber: group.providerNumber, providerName: group.providerName, deliveryMethod: '', updatedAt: new Date().toISOString() });
      }
    });
    if (missingEntries.size) {
      savedData.providerMaster.unshift(...missingEntries.values());
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
    try { savedData = await importSavedData(file); initializeProviderMasterOrder(savedData); persist(); render(); alert('バックアップを読み込みました。'); }
    catch (error) { alert(error instanceof Error ? error.message : 'バックアップを読み込めませんでした。'); }
  });
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-master-field]').forEach((input) => input.addEventListener('change', () => {
    const number = input.closest('tr')?.dataset.master; const entry = savedData.providerMaster.find((item) => item.providerNumber === number); if (!entry) return;
    entry[input.dataset.masterField as 'providerName' | 'deliveryMethod'] = input.value as never; entry.updatedAt = new Date().toISOString(); persist(); refreshRoutingSafety();
    render();
  }));
  document.querySelectorAll<HTMLElement>('[data-action="delete-master"]').forEach((button) => button.addEventListener('click', async () => {
    if (deletingMasterNumber) return;
    const providerNumber = button.dataset.number!;
    const isInCurrentResult = Boolean(result?.groups.some((group) => group.providerNumber === providerNumber));
    const confirmation = isInCurrentResult
      ? 'この事業所のマスタ設定を解除しますか？現在の振り分け結果に含まれているため、未設定の事業所として一覧に残り、設定するまで保存できなくなります。過去のPDFは削除されません。'
      : 'この事業所をマスタから削除しますか？過去のPDFは削除されません。';
    if (!confirm(confirmation)) return;
    const activeGroup = result?.groups.find((group) => group.providerNumber === providerNumber);
    const savedMasterBefore = savedData.providerMaster.map((entry) => ({ ...entry }));
    const groupsBefore = result?.groups.map((group) => ({ ...group, issues: [...group.issues] }));
    deletingMasterNumber = providerNumber;
    masterActionError = '';
    render();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    let succeeded = false;
    try {
      const removedEntry = savedData.providerMaster.find((entry) => entry.providerNumber === providerNumber);
      if (activeGroup && removedEntry) {
        // 現在の振り分け結果で使っている行は消さず、未設定に戻して行を保ちます。
        removedEntry.deliveryMethod = '';
        removedEntry.updatedAt = new Date().toISOString();
      } else {
        savedData.providerMaster = savedData.providerMaster.filter((entry) => entry.providerNumber !== providerNumber);
        if (activeGroup) {
          savedData.providerMaster.unshift({
            providerNumber,
            providerName: activeGroup.providerName,
            deliveryMethod: '',
            updatedAt: new Date().toISOString(),
          });
        }
      }
      persist();
      refreshRoutingSafety();
      succeeded = true;
    } catch (error) {
      console.error('事業所マスタの削除に失敗しました', error);
      savedData.providerMaster = savedMasterBefore;
      if (result && groupsBefore) result.groups = groupsBefore;
      try { persist(); } catch { /* 元の内容を画面内で保持し、エラーを表示します */ }
      masterActionError = '事業所を削除できませんでした。マスタの内容は元に戻しました。再読み込み後にもう一度お試しください。';
    } finally {
      deletingMasterNumber = undefined;
      render();
    }
    if (succeeded && activeGroup) requestAnimationFrame(() => {
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
      item.previewAspectRatio = preview.aspectRatio;
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
  singleFolderExportChecked = false;
  stoppedGroupIds.clear();
  clientStopDialogOpen = false;
  clientSearchTerm = '';
  showIntakeProgress();
  busy = true; setProgress('PDFを読み込み中');
  try {
    const loaded = await loadPdfFiles(pdfs, setProgress); const analysis = await analysePdfs(loaded.sources, loaded.duplicateFiles, setProgress); result = analysis; queuedFiles = []; downloaded = 0; outputName = ''; sectionOpen.verification = false;
    let added = 0;
    let filledNames = 0;
    const newEntries: ProviderMasterEntry[] = [];
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
      newEntries.push({ providerNumber: group.providerNumber, providerName: group.providerName, deliveryMethod: '', updatedAt: new Date().toISOString() }); added++;
    }
    if (newEntries.length) savedData.providerMaster.unshift(...newEntries);
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
  const dialog = document.querySelector<HTMLDialogElement>('#previewDialog')!;
  const pageList = document.querySelector<HTMLDivElement>('#previewPages')!;
  document.querySelector('#previewTitle')!.textContent = `${group.clientName || '利用者名未判定'} — ${range(group)}（${group.pages.length}ページ）`;
  pageList.replaceChildren();
  dialog.showModal();
  document.querySelector<HTMLElement>('#previewTitle')?.focus({ preventScroll: true });

  for (const [index, ref] of group.pages.entries()) {
    const pageSection = document.createElement('section');
    pageSection.className = 'preview-page';
    const label = document.createElement('h4');
    label.textContent = `${index + 1}枚目：${ref.sourceName} の ${ref.pageIndex + 1}ページ目`;
    const canvas = document.createElement('canvas');
    const error = document.createElement('p');
    error.className = 'error';
    pageSection.append(label, canvas, error);
    pageList.append(pageSection);

    try {
      const source = result.sources.find((item) => item.id === ref.sourceId);
      if (!source) throw new Error('元PDFが見つかりません。');
      await renderPage(source, ref.pageIndex, canvas);
    } catch {
      error.textContent = 'このページを表示できませんでした。';
    }
  }
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
    savedData.providerMaster.unshift(master);
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

function providerGroups(groups: SlipGroup[] = result!.groups, includeDestination = true) {
  const values = new Map<string, SlipGroup[]>();
  // 似た名称でも番号が違えば、絶対に同じPDFへ結合しない。
  groups.forEach((group) => {
    const key = `${includeDestination ? `${destinationFor(group)}|` : ''}${group.providerNumber || `未判定-${group.id}`}`;
    values.set(key, [...(values.get(key) ?? []), group]);
  });
  return values;
}
async function createAllOutputs() {
  if (!result) return;
  const activeGroups = result.groups.filter((group) => !isStoppedGroup(group));
  const stoppedGroups = result.groups.filter(isStoppedGroup);
  const singleFolderExport = singleFolderExportChecked && activeGroups.some((group) => group.providerNumber && !masterFor(group)?.deliveryMethod);
  const month = result.uniqueMonths[0] || '提供年月未確定';
  const singleFolderTitle = monthlyFolderTitle(month);
  const mergedGroups = activeGroups.filter((group) => destinationFor(group) === 'PDF結合');
  const regularGroups = activeGroups.filter((group) => destinationFor(group) !== 'PDF結合');
  showIntakeProgress(); busy = true; downloaded = 0; outputName = '';
  setProgress('ZIPを作成中');
  try {
    const entries: { groups: SlipGroup[]; folder: string; mergeIntoOne: boolean }[] = [
      ...[...providerGroups(regularGroups).values()].map((groups) => ({ groups, folder: singleFolderExport ? '' : safeFilename(deliveryFolderNameFor(destinationFor(groups[0]))), mergeIntoOne: false })),
      ...(mergedGroups.length ? [{ groups: mergedGroups, folder: safeFilename(deliveryFolderNameFor('PDF結合')), mergeIntoOne: true }] : []),
      ...[...providerGroups(stoppedGroups, false).values()].map((groups) => ({ groups, folder: '送付停止・確認用', mergeIntoOne: false })),
    ];
    const outputs = [];
    for (const [index, entry] of entries.entries()) {
      setProgress(`${index + 1} / ${entries.length}件のPDFを準備中`);
      let output: { name: string; bytes: Uint8Array };
      if (entry.mergeIntoOne) {
        setProgress('PDFの余白を整えて結合中');
        output = await createMergedProviderPdf(month, entry.groups, result.sources);
      } else {
        output = await createProviderPdf(providerNameFor(entry.groups[0]), entry.groups[0].serviceMonth, entry.groups, result.sources);
      }
      outputs.push({ ...output, folder: entry.folder });
    }
    setProgress('ZIPファイルをまとめています');
    const zip = await createZip(outputs, month, singleFolderTitle);
    download(zip.blob, zip.name);
    outputName = zip.name;
    downloaded = outputs.length;
  } catch (error) {
    const detail = error instanceof Error ? error.message : '不明なエラー';
    alert(`ZIPの作成に失敗しました：${detail}`);
  } finally { busy = false; render(); }
}

void loadSavedData().then((data) => {
  // 起動時だけ未設定を先頭に集める。以降は配列順を維持し、設定後も位置を変えない。
  savedData = data;
  if (initializeProviderMasterOrder(savedData)) persist();
  render();
});
render();
