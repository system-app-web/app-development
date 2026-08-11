import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { extractPageFacts, shouldStartNewSlip, type PageFacts } from './analysis-rules';
import type { AnalysisResult, PageRef, SlipGroup, SourcePdf } from './types';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const sleepFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const sourceId = (index: number) => `source-${index}-${crypto.randomUUID()}`;

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
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(bytes) });
    const document = await loadingTask.promise;
    sources.push({ id: sourceId(index), name: file.name, bytes, pageCount: document.numPages, hash });
    await sleepFrame();
  }
  return { sources, duplicateFiles };
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
    const document = await pdfjsLib.getDocument({ data: new Uint8Array(source.bytes) }).promise;
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
          serviceMonth: facts.serviceMonth ?? '', pages: [], needsReview: false, reviewed: false, issues: [],
        };
        groups.push(current);
      }
      if (!current) continue;
      current.pages.push(pageRef);
      current.clientName ||= facts.clientName ?? '';
      current.providerName ||= facts.providerName ?? '';
      current.serviceMonth ||= facts.serviceMonth ?? '';
      if (!facts.textFound) current.issues.push(`P${serial}: 文字情報を取得できませんでした`);
      currentFacts = { ...currentFacts, ...Object.fromEntries(Object.entries(facts).filter(([, value]) => value)) } as PageFacts;
      lastSourceId = source.id;
      await sleepFrame();
    }
    current = undefined;
    currentFacts = undefined;
  }

  const seen = new Map<string, SlipGroup>();
  for (const group of groups) {
    if (!group.clientName) group.issues.push('利用者名を判定できません');
    if (!group.providerName) group.issues.push('事業所名を判定できません');
    if (!group.serviceMonth) group.issues.push('提供年月を判定できません');
    const key = `${group.clientName}|${group.providerName}|${group.serviceMonth}`;
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
  const document = await pdfjsLib.getDocument({ data: new Uint8Array(source.bytes) }).promise;
  const page = await document.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: 1.35 });
  const context = canvas.getContext('2d');
  if (!context) throw new Error('プレビューを表示できません。');
  canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;
}

export const safeFilename = (name: string) => name.replace(/[\\/:*?"<>|]/g, '＿').replace(/\s+/g, ' ').trim() || '名称未設定';

export async function createProviderPdf(provider: string, month: string, groups: SlipGroup[], sources: SourcePdf[]) {
  const output = await PDFDocument.create();
  const byId = new Map(sources.map((source) => [source.id, source]));
  const cache = new Map<string, PDFDocument>();
  for (const group of groups) for (const ref of group.pages) {
    const source = byId.get(ref.sourceId); if (!source) continue;
    let input = cache.get(source.id);
    if (!input) { input = await PDFDocument.load(source.bytes.slice(0)); cache.set(source.id, input); }
    const [page] = await output.copyPages(input, [ref.pageIndex]); output.addPage(page);
  }
  const bytes = await output.save();
  return { name: `${safeFilename(provider)}_${safeFilename(month)}_提供票.pdf`, bytes };
}

export async function createZip(files: { name: string; bytes: Uint8Array }[], month: string) {
  const zip = new JSZip(); files.forEach((file) => zip.file(file.name, file.bytes));
  return { name: `${safeFilename(month)}_提供票_事業所別.zip`, blob: await zip.generateAsync({ type: 'blob' }) };
}
