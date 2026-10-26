import type { GeminiSuggestion } from './gemini-service.ts';
import {
  matchProviderMaster,
  normalizeProviderNumber,
  normalizeServiceCategory,
  PROVIDER_NAME_ISSUE,
  PROVIDER_NUMBER_ISSUE,
  type ProviderGroupLike,
  type ProviderMasterLike,
} from './provider-matching.ts';

type AssistedGroup = ProviderGroupLike & { geminiExcerpt: string; geminiUsed?: boolean };
const failurePrefix = '事業所情報の補助確認：';

export function fillEmptyProviderMasterNames(entries: ProviderMasterLike[], providerNumber: string, providerName: string) {
  const number = normalizeProviderNumber(providerNumber);
  const name = providerName.trim();
  if (!number || !name) return 0;
  let filled = 0;
  for (const entry of entries) {
    if (normalizeProviderNumber(entry.providerNumber) !== number || entry.providerName.trim()) continue;
    entry.providerName = name;
    entry.updatedAt = new Date().toISOString();
    filled++;
  }
  return filled;
}

/** 同じ番号の別ページ・別提供票で読めた名称を使い、入力済みの名称は維持します。 */
export function completeMissingProviderNames(groups: ProviderGroupLike[], entries: ProviderMasterLike[]) {
  const namedGroups = groups.filter((group) => group.providerNumber.trim() && group.providerName.trim());
  // 種類別に読めた名前を先に補い、残った空欄には同じ番号の名称を使います。
  for (const group of namedGroups) {
    const exact = entries.filter((entry) => normalizeServiceCategory(entry.serviceCategory) === normalizeServiceCategory(group.serviceCategory));
    fillEmptyProviderMasterNames(exact, group.providerNumber, group.providerName);
  }
  for (const group of namedGroups) fillEmptyProviderMasterNames(entries, group.providerNumber, group.providerName);
  for (const group of groups) {
    if (!group.providerName.trim() && group.providerNumber.trim()) {
      const peers = namedGroups.filter((peer) => normalizeProviderNumber(peer.providerNumber) === normalizeProviderNumber(group.providerNumber));
      const sameCategoryPeer = peers.find((candidate) => normalizeServiceCategory(candidate.serviceCategory) === normalizeServiceCategory(group.serviceCategory));
      const match = matchProviderMaster(entries, group.providerNumber, group.serviceCategory);
      const masterName = match.kind === 'matched' ? match.entry.providerName.trim() : '';
      group.providerName = sameCategoryPeer?.providerName.trim() || masterName || peers[0]?.providerName.trim() || '';
    }
    if (group.providerName.trim()) group.issues = group.issues.filter((issue) => issue !== PROVIDER_NAME_ISSUE);
    if (group.providerName.trim() && group.providerNumber.trim()) {
      group.issues = group.issues.filter((issue) => !issue.startsWith(failurePrefix));
    }
    group.needsReview = group.issues.length > 0;
  }
}

type ApplicationOptions<T extends ProviderMasterLike> = {
  createEntry: (number: string, name: string, category: string) => T;
  findMaster?: (number: string, category: string) => T | undefined;
  onMasterAdded?: () => void;
};

export function applyAutomaticGeminiSuggestion<T extends ProviderMasterLike>(
  group: AssistedGroup,
  suggestion: GeminiSuggestion,
  entries: T[],
  options: ApplicationOptions<T>,
) {
  const number = normalizeProviderNumber(group.providerNumber);
  const suggestedNumber = normalizeProviderNumber(suggestion.providerNumber ?? '');
  const suggestedName = suggestion.providerName?.trim() ?? '';
  if (number && suggestedNumber && number !== suggestedNumber) return false;

  // 名前補完は確信度・サービス種類の照合から独立させます。番号の推測はしません。
  if (number && suggestedName && (number === suggestedNumber || (!suggestedNumber && suggestion.confidence >= 0.9))) {
    fillEmptyProviderMasterNames(entries, number, suggestedName);
    if (!group.providerName.trim()) group.providerName = suggestedName;
    group.geminiUsed = true;
  }
  if (suggestion.confidence < 0.9) return false;

  const suggestedCategory = suggestion.isHomeMedicalCare === true ? '居宅療養管理指導' : '';
  if (group.serviceCategory && suggestedCategory
    && normalizeServiceCategory(group.serviceCategory) !== normalizeServiceCategory(suggestedCategory)) return false;
  if (!group.serviceCategory && suggestedCategory) group.serviceCategory = suggestedCategory;

  const candidateNumber = number || suggestedNumber;
  const match = matchProviderMaster(entries, candidateNumber, group.serviceCategory);
  let master = options.findMaster
    ? options.findMaster(candidateNumber, group.serviceCategory)
    : match.kind === 'matched' ? match.entry : undefined;
  if (master) {
    if (!master.providerName.trim() && suggestedName) master.providerName = suggestedName;
  } else {
    if (!suggestedNumber || suggestion.confidence < 0.95 || number) return false;
    const name = suggestedName || group.providerName.trim();
    const normalizeName = (value: string) => value.normalize('NFKC').toLocaleLowerCase('ja').replace(/[\s・,，.。\-－‐()（）]/gu, '');
    const currentName = normalizeName(group.providerName);
    const candidateName = normalizeName(name);
    if (!name || (currentName && candidateName && !currentName.includes(candidateName) && !candidateName.includes(currentName))) return false;
    master = options.createEntry(suggestedNumber, name, group.serviceCategory);
    entries.unshift(master);
    options.onMasterAdded?.();
  }

  group.providerNumber = master.providerNumber;
  group.providerName ||= master.providerName.trim() || suggestedName;
  group.issues = group.issues.filter((issue) => (issue !== PROVIDER_NAME_ISSUE || !group.providerName.trim())
    && (issue !== PROVIDER_NUMBER_ISSUE || !group.providerNumber.trim()));
  group.needsReview = group.issues.length > 0;
  group.geminiUsed = true;
  return true;
}

function addGeminiCandidateForReview(group: AssistedGroup, suggestion: GeminiSuggestion) {
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

export function providerAssistanceFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (/文字情報/u.test(message)) {
    return 'PDFから事業所名を読み取れず、補助確認に必要な文字も不足しています。事業所マスタに名前を入力してください。';
  }
  if (/ログイン|ポータル|\b40[13]\b/u.test(message)) {
    return 'ポータルのログインを確認できません。ポータルからアプリを開き直すか、事業所マスタに名前を入力してください。';
  }
  if (/通信|接続|タイムアウト|network|fetch|timeout/iu.test(message)) {
    return '通信できず、事業所名を確認できませんでした。通信環境を確認して再度読み込むか、事業所マスタに名前を入力してください。';
  }
  if (/APIキー|設定/u.test(message)) {
    return '事業所名の補助確認の設定が完了していません。管理者に確認するか、事業所マスタに名前を入力してください。';
  }
  return '補助確認サービスを利用できませんでした。事業所マスタに名前を入力してください。';
}

/** 通信処理を注入し、実APIを使わずに補助確認の一連の流れを検証します。 */
export async function assistUnresolvedProviderNames<T extends ProviderMasterLike>(
  groups: AssistedGroup[],
  entries: T[],
  options: ApplicationOptions<T> & {
    requestSuggestion: (input: { excerpt: string; providerName: string; providerNumber: string; missing: string[] }) => Promise<GeminiSuggestion>;
    onProgress?: (text: string) => void;
  },
) {
  completeMissingProviderNames(groups, entries);
  const targets = groups.filter((group) => !group.providerName.trim() || !group.providerNumber.trim());
  const cachedSuggestions = new Map<string, GeminiSuggestion>();
  for (const [index, group] of targets.entries()) {
    completeMissingProviderNames(groups, entries);
    if (group.providerName.trim() && group.providerNumber.trim()) continue;
    options.onProgress?.(`${index + 1} / ${targets.length}件　事業所情報を補助確認中`);
    try {
      if (!group.geminiExcerpt.trim()) throw new Error('PDFの文字情報が不足しています');
      const cacheKey = `${group.providerName}|${group.providerNumber}|${group.geminiExcerpt}`;
      let suggestion = cachedSuggestions.get(cacheKey);
      if (!suggestion) {
        suggestion = await options.requestSuggestion({ excerpt: group.geminiExcerpt, providerName: group.providerName, providerNumber: group.providerNumber, missing: group.issues });
        cachedSuggestions.set(cacheKey, suggestion);
      }
      if (!applyAutomaticGeminiSuggestion(group, suggestion, entries, options)) addGeminiCandidateForReview(group, suggestion);
    } catch (error) {
      completeMissingProviderNames(groups, entries);
      if (group.providerName.trim() && group.providerNumber.trim()) continue;
      group.issues = group.issues.filter((issue) => !issue.startsWith(failurePrefix));
      group.issues.push(`${failurePrefix}${providerAssistanceFailureMessage(error)}`);
      group.needsReview = true;
      group.reviewed = false;
    }
  }
  completeMissingProviderNames(groups, entries);
}
