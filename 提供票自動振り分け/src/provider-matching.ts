export const DELIVERY_METHOD_ISSUE = '送付方法が未設定です';
export const SERVICE_MATCH_ISSUE = '同じ事業所番号の送付方法をサービス種類で特定できません';
export const SERVICE_MASTER_MISSING_ISSUE = '該当するサービス種類の事業所マスタがありません';
export const MASTER_ROUTE_REVIEW_ISSUE = '事業所マスタの送付方法を再確認してください';
export const PROVIDER_NAME_ISSUE = '事業所名を判定できません';
export const PROVIDER_NUMBER_ISSUE = '10桁の事業所番号を判定できません';
export const CLIENT_NAME_ISSUE = '利用者名を判定できません';
export const SERVICE_MONTH_ISSUE = '提供年月を判定できません';

export type ProviderMasterLike = {
  id?: string;
  providerNumber: string;
  providerName: string;
  serviceCategory?: string;
  deliveryMethod: string;
  updatedAt?: string;
  needsServiceReview?: boolean;
};

export type ProviderGroupLike = {
  clientName: string;
  providerNumber: string;
  providerName: string;
  serviceCategory: string;
  serviceMonth: string;
  deliveryMethod?: string;
  issues: string[];
  needsReview: boolean;
  reviewed: boolean;
};

export type ProviderMasterMatch<T extends ProviderMasterLike> =
  | { kind: 'matched'; entry: T }
  | { kind: 'missing' }
  | { kind: 'ambiguous'; candidates: T[] };

export const normalizeProviderNumber = (value: string) => value.normalize('NFKC').trim();

export function normalizeServiceCategory(value?: string | null) {
  const category = (value ?? '').normalize('NFKC').replace(/\s+/gu, '').trim();
  if (category === '居宅療養') return '居宅療養管理指導';
  if (category === '訪問リハ' || category === '訪問リハビリ') return '訪問リハビリテーション';
  return category;
}

export function providerIdentityKey(providerNumber: string, serviceCategory?: string) {
  return JSON.stringify([normalizeProviderNumber(providerNumber), normalizeServiceCategory(serviceCategory)]);
}

/** 事業所名は帳票ファイル名用の別名なので、照合には使いません。 */
export function matchProviderMaster<T extends ProviderMasterLike>(
  entries: T[],
  providerNumber: string,
  serviceCategory?: string,
): ProviderMasterMatch<T> {
  const numberKey = normalizeProviderNumber(providerNumber);
  if (!numberKey) return { kind: 'missing' };

  const candidates = entries.filter((entry) => normalizeProviderNumber(entry.providerNumber) === numberKey);
  if (!candidates.length) return { kind: 'missing' };

  const categoryKey = normalizeServiceCategory(serviceCategory);
  if (candidates.length === 1) return { kind: 'matched', entry: candidates[0] };

  if (!categoryKey) return { kind: 'ambiguous', candidates };
  const matching = candidates.filter((entry) => normalizeServiceCategory(entry.serviceCategory) === categoryKey);
  if (matching.length === 1) return { kind: 'matched', entry: matching[0] };
  if (matching.length > 1 || candidates.some((entry) => !normalizeServiceCategory(entry.serviceCategory))) return { kind: 'ambiguous', candidates };
  return { kind: 'missing' };
}

export function reconcileProviderMaster<T extends ProviderMasterLike>(entries: T[], preferredId?: string) {
  const grouped = new Map<string, T[]>();
  for (const entry of entries) {
    const key = providerIdentityKey(entry.providerNumber, entry.serviceCategory);
    grouped.set(key, [...(grouped.get(key) ?? []), entry]);
  }

  const reconciled: T[] = [];
  const warningNumbers = new Set<string>();
  let mergedCount = 0;

  for (const rows of grouped.values()) {
    if (rows.length === 1) {
      reconciled.push({ ...rows[0], serviceCategory: normalizeServiceCategory(rows[0].serviceCategory) || rows[0].serviceCategory });
      if (rows[0].needsServiceReview) warningNumbers.add(normalizeProviderNumber(rows[0].providerNumber));
      continue;
    }

    const category = normalizeServiceCategory(rows[0].serviceCategory);
    const deliveryMethods = [...new Set(rows.map((row) => row.deliveryMethod).filter(Boolean))];
    if (deliveryMethods.length > 1) {
      rows.forEach((row) => {
        reconciled.push({ ...row, needsServiceReview: true });
      });
      warningNumbers.add(normalizeProviderNumber(rows[0].providerNumber));
      continue;
    }

    const preferred = rows.find((row) => row.id === preferredId)
      ?? [...rows].sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''))[0];
    const first = rows[0];
    const merged = {
      ...first,
      ...preferred,
      id: preferredId && rows.some((row) => row.id === preferredId) ? preferredId : first.id,
      serviceCategory: category || first.serviceCategory,
      deliveryMethod: deliveryMethods.length === 1 ? deliveryMethods[0] : '',
      needsServiceReview: false,
    } as T;
    reconciled.push(merged);
    mergedCount += rows.length - 1;
    if (merged.needsServiceReview) warningNumbers.add(normalizeProviderNumber(first.providerNumber));
  }

  for (const number of getProviderMasterWarningNumbers(reconciled)) warningNumbers.add(number);
  return { entries: reconciled, mergedCount, warningNumbers: [...warningNumbers] };
}

export function getProviderMasterWarningNumbers(entries: ProviderMasterLike[]) {
  const byNumber = new Map<string, ProviderMasterLike[]>();
  entries.forEach((entry) => {
    const number = normalizeProviderNumber(entry.providerNumber);
    byNumber.set(number, [...(byNumber.get(number) ?? []), entry]);
  });

  const warnings = new Set<string>();
  byNumber.forEach((rows, number) => {
    const untypedRows = rows.filter((row) => !normalizeServiceCategory(row.serviceCategory));
    if (rows.some((row) => row.needsServiceReview) || untypedRows.length > 1 || (untypedRows.length > 0 && rows.length > 1)) {
      warnings.add(number);
    }
  });
  return [...warnings];
}

export function refreshProviderGroupRouting<T extends ProviderGroupLike, M extends ProviderMasterLike>(group: T, entries: M[]) {
  const match = matchProviderMaster(entries, group.providerNumber, group.serviceCategory);
  const dynamicIssues = new Set([
    DELIVERY_METHOD_ISSUE, SERVICE_MATCH_ISSUE, SERVICE_MASTER_MISSING_ISSUE, MASTER_ROUTE_REVIEW_ISSUE,
    PROVIDER_NAME_ISSUE, PROVIDER_NUMBER_ISSUE, CLIENT_NAME_ISSUE, SERVICE_MONTH_ISSUE,
  ]);
  group.issues = group.issues.filter((issue) => !dynamicIssues.has(issue));

  if (match.kind === 'ambiguous') {
    group.issues.push(SERVICE_MATCH_ISSUE);
    group.reviewed = false;
  } else if (match.kind === 'matched') {
    const entry = match.entry;
    const serviceCategory = normalizeServiceCategory(group.serviceCategory);
    if (!normalizeServiceCategory(entry.serviceCategory) && serviceCategory) entry.serviceCategory = serviceCategory;
    if (!group.providerName.trim() && entry.providerName.trim()) {
      group.providerName = entry.providerName.trim();
      group.issues = group.issues.filter((issue) => issue !== '事業所名を判定できません');
    }
    if (entry.needsServiceReview) group.issues.push(MASTER_ROUTE_REVIEW_ISSUE);
    if (!entry.deliveryMethod) group.issues.push(DELIVERY_METHOD_ISSUE);
    if (entry.needsServiceReview || !entry.deliveryMethod) group.reviewed = false;
  } else {
    const sameNumberRows = entries.filter((entry) => normalizeProviderNumber(entry.providerNumber) === normalizeProviderNumber(group.providerNumber));
    if (sameNumberRows.length) group.issues.push(SERVICE_MASTER_MISSING_ISSUE);
    else group.issues.push(DELIVERY_METHOD_ISSUE);
    group.reviewed = false;
  }

  if (!group.providerName.trim()) group.issues.push(PROVIDER_NAME_ISSUE);
  if (!group.providerNumber.trim()) group.issues.push(PROVIDER_NUMBER_ISSUE);
  if (!group.clientName.trim()) group.issues.push(CLIENT_NAME_ISSUE);
  if (!group.serviceMonth.trim()) group.issues.push(SERVICE_MONTH_ISSUE);

  group.needsReview = group.issues.length > 0;
  return match;
}

export function refreshRoutingSafetyForGroups<T extends ProviderGroupLike, M extends ProviderMasterLike>(groups: T[], entries: M[]) {
  groups.forEach((group) => refreshProviderGroupRouting(group, entries));
  return groups;
}
