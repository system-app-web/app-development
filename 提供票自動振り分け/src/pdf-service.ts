import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { extractPageFacts, providerEvidence, shouldStartNewSlip, type PageFacts } from './analysis-rules';
import type { AnalysisResult, PageRef, SlipGroup, SourcePdf } from './types';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const sleepFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const sourceId = (index: number) => `source-${index}-${crypto.randomUUID()}`;

/**
 * PDF.js は Worker へデータを渡す際に、受け取った Uint8Array の ArrayBuffer を
 * transfer して切り離すことがあります。保管用の source.bytes は絶対に渡さず、
 * 毎回この関数で複製した一時データだけを PDF.js に渡します。
 */
function copyPdfData(bytes: ArrayBuffer): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(new Uint8Array(bytes));
  return copy;
}

async function digest(file: File) {
  const bytes = await file.arrayBuffer();
  const value = await crypto.subtle.digest('SHA-256', bytes);
  return { bytes, hash: [...new Uint8Array(value)].map((v) => v.toString(16).padStart(2, '0')).join('') };
}

export async function loadPdfFiles(files: File[], onProgress: (text: string) => void): Promise<{ sources: SourcePdf[]; duplicateFiles: string[] }> {
  const sources: SourcePdf[] = [];
  const duplicateFiles: string[] = [];
  const knownHashes = new Set<string>();
  for (const [index, file] of files.entries()) {
    onProgress(`${index + 1} / ${files.length} ファイルを確認中`);
    const { bytes, hash } = await digest(file);
    if (knownHashes.has(hash)) { duplicateFiles.push(file.name); continue; }
    knownHashes.add(hash);
    // ここで PDF.js がデータを detach しても、保存する bytes は影響を受けない。
    const loadingTask = pdfjsLib.getDocument({ data: copyPdfData(bytes) });
    const document = await loadingTask.promise;
    const pageCount = document.numPages;
    await document.destroy();
    sources.push({ id: sourceId(index), name: file.name, bytes, pageCount, hash });
    await sleepFrame();
  }
  return { sources, duplicateFiles };
}

function cropPreviewCanvas(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) {
  const { width, height } = canvas;
  let pixels: Uint8ClampedArray;
  try { pixels = context.getImageData(0, 0, width, height).data; }
  catch { return { canvas, aspectRatio: width / height }; }
  const rowHits = new Uint32Array(height);
  const columnHits = new Uint32Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = (y * width + x) * 4;
      if (pixels[pixel + 3] && (pixels[pixel] < 248 || pixels[pixel + 1] < 248 || pixels[pixel + 2] < 248)) {
        rowHits[y]++;
        columnHits[x]++;
      }
    }
  }

  const minRowHits = Math.max(2, Math.ceil(width * 0.001));
  const minColumnHits = Math.max(2, Math.ceil(height * 0.001));
  let top = -1;
  let bottom = -1;
  let left = -1;
  let right = -1;
  for (let y = 0; y < height; y++) {
    if (rowHits[y] < minRowHits) continue;
    if (top < 0) top = y;
    bottom = y;
  }
  for (let x = 0; x < width; x++) {
    if (columnHits[x] < minColumnHits) continue;
    if (left < 0) left = x;
    right = x;
  }
  if (top < 0 || bottom < top || left < 0 || right < left) return { canvas, aspectRatio: width / height };

  const padding = 4;
  left = Math.max(0, left - padding);
  right = Math.min(width - 1, right + padding);
  top = Math.max(0, top - padding);
  bottom = Math.min(height - 1, bottom + padding);
  const cropped = document.createElement('canvas');
  cropped.width = right - left + 1;
  cropped.height = bottom - top + 1;
  const croppedContext = cropped.getContext('2d');
  if (!croppedContext) return { canvas, aspectRatio: width / height };
  croppedContext.drawImage(canvas, left, top, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
  return { canvas: cropped, aspectRatio: cropped.width / cropped.height };
}

export async function createFilePreview(file: File): Promise<{ thumbnail: string; pageCount: number; aspectRatio: number }> {
  const bytes = await file.arrayBuffer();
  const pdfDocument = await pdfjsLib.getDocument({ data: copyPdfData(bytes) }).promise;
  try {
    const page = await pdfDocument.getPage(1);
    const initialViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(360 / initialViewport.width, 440 / initialViewport.height);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('PDFのプレビューを作成できません。');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const preview = cropPreviewCanvas(canvas, context);
    return { thumbnail: preview.canvas.toDataURL('image/jpeg', 0.82), pageCount: pdfDocument.numPages, aspectRatio: preview.aspectRatio };
  } finally {
    await pdfDocument.destroy();
  }
}

export async function analysePdfs(sources: SourcePdf[], duplicateFiles: string[], onProgress: (text: string) => void): Promise<AnalysisResult> {
  const groups: SlipGroup[] = [];
  let serial = 0;
  let current: SlipGroup | undefined;
  let currentFacts: PageFacts | undefined;
  let lastSourceId: string | undefined;
  const months = new Set<string>();
  const totalPages = sources.reduce((sum, source) => sum + source.pageCount, 0);

  for (const source of sources) {
    const document = await pdfjsLib.getDocument({ data: copyPdfData(source.bytes) }).promise;
    try {
      for (let pageIndex = 0; pageIndex < document.numPages; pageIndex++) {
        serial++;
        onProgress(`${serial} / ${totalPages} ページ解析中`);
        const page = await document.getPage(pageIndex + 1);
        const content = await page.getTextContent();
        const items = content.items
          .filter((item): item is typeof item & { str: string; transform: number[] } => 'str' in item && typeof item.str === 'string')
          .map((item) => ({ text: item.str, x: item.transform[4], y: item.transform[5] }));
        const facts = extractPageFacts(items);
        if (facts.serviceMonth) months.add(facts.serviceMonth);
        const pageRef: PageRef = { sourceId: source.id, sourceName: source.name, pageIndex, serial };
        const start = lastSourceId !== source.id || shouldStartNewSlip(currentFacts, facts);
        if (start) {
          current = {
            id: crypto.randomUUID(), clientName: facts.clientName ?? '', providerName: facts.providerName ?? '',
            providerNumber: facts.providerNumber ?? '', serviceCategory: facts.serviceCategory, geminiExcerpt: '', geminiUsed: false,
            serviceMonth: facts.serviceMonth ?? '', pages: [], needsReview: false, reviewed: false, issues: [],
          };
          groups.push(current);
        }
        if (!current) continue;
        current.pages.push(pageRef);
        current.clientName ||= facts.clientName ?? '';
        if (facts.isAppendix && facts.providerName) {
          // 別表の「事業所名」列は主票上部の省略表示より優先します。
          current.providerName = facts.providerName;
        } else {
          current.providerName ||= facts.providerName ?? '';
        }
        current.providerNumber ||= facts.providerNumber ?? '';
        current.serviceCategory ||= facts.serviceCategory;
        // API候補は事業所関連の行だけ。氏名などを含むページ全文は蓄積・送信しない。
        const evidence = providerEvidence(items);
        if (evidence) current.geminiExcerpt = `${current.geminiExcerpt}\n${evidence}`.slice(0, 1600);
        current.serviceMonth ||= facts.serviceMonth ?? '';
        if (!facts.textFound) current.issues.push(`P${serial}: 文字情報を取得できませんでした`);
        currentFacts = start
          ? facts
          : {
            ...currentFacts,
            ...Object.fromEntries(Object.entries(facts).filter(([key, value]) => key !== 'isAppendix' && Boolean(value))),
            isAppendix: facts.isAppendix,
          } as PageFacts;
        lastSourceId = source.id;
        await sleepFrame();
      }
    } finally {
      await document.destroy();
    }
    current = undefined;
    currentFacts = undefined;
  }

  const seen = new Map<string, SlipGroup>();
  for (const group of groups) {
    if (!group.clientName) group.issues.push('利用者名を判定できません');
    if (!group.providerName) group.issues.push('事業所名を判定できません');
    if (!group.providerNumber) group.issues.push('10桁の事業所番号を判定できません');
    if (!group.serviceMonth) group.issues.push('提供年月を判定できません');
    const key = `${group.clientName}|${group.providerNumber || group.providerName}|${group.serviceMonth}`;
    if (group.clientName && group.providerName && seen.has(key)) {
      group.issues.push('同一利用者・同一事業所の重複の可能性');
      seen.get(key)?.issues.push('同一利用者・同一事業所の重複の可能性');
    }
    seen.set(key, group);
    group.needsReview = group.issues.length > 0;
  }
  if (months.size > 1) groups.forEach((group) => { group.issues.push('提供年月が混在しています'); group.needsReview = true; });
  return { groups, sources, totalPages, duplicateFiles, uniqueMonths: [...months] };
}

export async function renderPage(source: SourcePdf, pageIndex: number, canvas: HTMLCanvasElement) {
  const document = await pdfjsLib.getDocument({ data: copyPdfData(source.bytes) }).promise;
  try {
    const page = await document.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale: 1.35 });
    const context = canvas.getContext('2d');
    if (!context) throw new Error('プレビューを表示できません。');
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
  } finally {
    await document.destroy();
  }
}

export const safeFilename = (name: string) => name.replace(/[\\/:*?"<>|]/g, '＿').replace(/\s+/g, ' ').trim() || '名称未設定';
const safeFolderName = (name: string) => name.replace(/[\\/:*?"<>|]/g, '＿').trim() || '名称未設定';
const safeZipFolderPath = (path: string) => path.split('/').filter(Boolean).map(safeFolderName).join('/');

async function combineProviderGroups(groups: SlipGroup[], sources: SourcePdf[]) {
  const output = await PDFDocument.create();
  const byId = new Map(sources.map((source) => [source.id, source]));
  const cache = new Map<string, PDFDocument>();
  for (const group of groups) for (const ref of group.pages) {
    const source = byId.get(ref.sourceId); if (!source) continue;
    let input = cache.get(source.id);
    if (!input) { input = await PDFDocument.load(source.bytes.slice(0)); cache.set(source.id, input); }
    const [page] = await output.copyPages(input, [ref.pageIndex]); output.addPage(page);
  }
  return output;
}

export async function createProviderPdf(provider: string, month: string, groups: SlipGroup[], sources: SourcePdf[]) {
  const output = await combineProviderGroups(groups, sources);
  const bytes = await output.save();
  const familyNames = [...new Set(groups.map((group) => group.clientName.trim().split(/[ 　]/)[0]).filter(Boolean))].map((name) => `${name}様`).join('、');
  return { name: `${safeFilename(month)}　${safeFilename(provider)}提供票（${safeFilename(familyNames || '利用者名未判定')}）.pdf`, bytes };
}

export async function createMergedProviderPdf(month: string, groups: SlipGroup[], sources: SourcePdf[]) {
  const output = await combineProviderGroups(groups, sources);
  const monthNumber = month.match(/([0-9]{1,2})月/u)?.[1];
  const title = `${monthNumber ? `${Number(monthNumber)}月` : '提供年月未確定'}分提供票　一括FAX送信用`;
  output.setTitle(title);
  return { name: `${title}.pdf`, bytes: await output.save() };
}

export async function createZip(files: { name: string; bytes: Uint8Array; folder?: string }[], month: string, archiveBaseName?: string) {
  const zip = new JSZip();
  const usedPaths = new Set<string>();
  files.forEach((file) => {
    const folderName = file.folder ? (archiveBaseName ? safeZipFolderPath(file.folder) : safeFilename(file.folder)) : '';
    const folder = folderName ? `${folderName}/` : '';
    const extension = file.name.toLowerCase().endsWith('.pdf') ? '.pdf' : '';
    const stem = extension ? file.name.slice(0, -extension.length) : file.name;
    let name = file.name;
    if (archiveBaseName) for (let suffix = 2; usedPaths.has(`${folder}${name}`); suffix++) name = `${stem} (${suffix})${extension}`;
    const path = `${folder}${name}`;
    if (archiveBaseName) usedPaths.add(path);
    zip.file(path, file.bytes);
  });
  const name = archiveBaseName ? `${safeFolderName(archiveBaseName)}.zip` : `${safeFilename(month)}_提供票_事業所別.zip`;
  return { name, blob: await zip.generateAsync({ type: 'blob' }) };
}
