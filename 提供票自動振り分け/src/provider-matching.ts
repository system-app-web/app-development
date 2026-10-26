import { normalizeServiceCategoryValue } from './service-categories.ts';
import type { ProviderServiceRoute } from './types.ts';

export const DELIVERY_METHOD_ISSUE = '送付方法が未設定です';
export const SERVICE_MATCH_ISSUE = '同じ事業所番号の提供票が2つあります。サービス種類を選んでください';
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
  routeIdentityFingerprint?: string;
  routePageFingerprints?: string[];
  pages?: Array<{ sourceId: string; pageIndex: number }>;
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

export function canAutoAssignServiceCategory(entry: ProviderMasterLike, candidateCount: number, observedCategoryCount: number) {
  return candidateCount === 1
    && observedCategoryCount === 1
    && !normalizeServiceCategory(entry.serviceCategory)
    && !entry.deliveryMethod.trim()
    && !entry.needsServiceReview;
}

/** 同じマスタ要確認を提供票側でも重ねて数えないための判定。 */
export function hasIndependentGroupReview(issues: string[], hasMissingRequiredInfo: boolean, masterReviewCountedSeparately: boolean) {
  const masterReviewIssues = new Set([SERVICE_MATCH_ISSUE, SERVICE_MASTER_MISSING_ISSUE, MASTER_ROUTE_REVIEW_ISSUE]);
  return hasMissingRequiredInfo || issues.some((issue) => (
    issue !== DELIVERY_METHOD_ISSUE
    && (!masterReviewCountedSeparately || !masterReviewIssues.has(issue))
  ));
}

export function normalizeServiceCategory(value?: string | null) {
  return normalizeServiceCategoryValue(value);
}

/**
 * 手動選択を同じ提供票へ安全に結び付けるための指紋を作ります。
 * 利用者名・事業所名は保存せず、事業所番号、読み取れた名前、月、PDFページのSHA-256だけを入力にします。
 */
export async function createProviderRouteIdentityFingerprint(
  group: Pick<ProviderGroupLike, 'providerNumber' | 'providerName' | 'clientName' | 'serviceMonth' | 'pages'>,
  sources: Array<{ id: string; hash: string }> = [],
) {
  const number = normalizeProviderNumber(group.providerNumber);
  const providerName = normalizeRouteIdentityText(group.providerName);
  const clientName = normalizeRouteIdentityText(group.clientName);
  if (!number || (!providerName && !clientName)) return '';

  const hashesById = new Map(sources.map((source) => [source.id, source.hash]));
  const pages = (group.pages ?? []).map((page) => [hashesById.get(page.sourceId) ?? '', page.pageIndex])
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const facts = JSON.stringify([
    number,
    providerName,
    clientName,
    normalizeRouteIdentityText(group.serviceMonth),
    pages,
  ]);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(facts));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

/** OCRに依存しない、元PDFの各ページごとの識別指紋を作ります。 */
export async function createProviderRoutePageFingerprints(
  group: Pick<ProviderGroupLike, 'pages'>,
  sources: Array<{ id: string; hash: string }> = [],
) {
  const hashesById = new Map(sources.map((source) => [source.id, source.hash]));
  const pageKeys = [...new Set((group.pages ?? []).flatMap((page) => {
    const hash = hashesById.get(page.sourceId);
    return hash ? [`${hash}:${page.pageIndex}`] : [];
  }))];
  return Promise.all(pageKeys.map(async (pageKey) => {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(pageKey));
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  }));
}

function normalizeRouteIdentityText(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('ja').replace(/[\s・,，.。\-－‐()（）]/gu, '');
}

export function providerIdentityKey(providerNumber: string, serviceCategory?: string) {
  return JSON.stringify([normalizeProviderNumber(providerNumber), normalizeServiceCategory(serviceCategory)]);
}

export function findProviderServiceRoute(
  routes: ProviderServiceRoute[],
  providerNumber: string,
  serviceCategory?: string,
  identityFingerprint?: string,
  pageFingerprints: string[] = [],
) {
  const numberKey = normalizeProviderNumber(providerNumber);
  const categoryKey = normalizeServiceCategory(serviceCategory);
  const numberRoutes = numberKey ? routes.filter((route) => normalizeProviderNumber(route.providerNumber) === numberKey) : routes;
  const fingerprint = identityFingerprint?.trim() ?? '';
  const pageKeys = new Set(pageFingerprints.filter(Boolean));
  const overlappingPages = (route: ProviderServiceRoute) => route.pageFingerprints?.some((page) => pageKeys.has(page)) ?? false;

  const pickUniqueRoute = (matches: ProviderServiceRoute[], matchedByIdentity: boolean) => {
    const unique = new Map<string, ProviderServiceRoute>();
    matches.forEach((route) => {
      if (!route.deliveryMethod.trim() || !route.providerNumber.trim()) return;
      const key = JSON.stringify([
        normalizeProviderNumber(route.providerNumber),
        normalizeServiceCategory(route.serviceCategory),
        route.deliveryMethod.trim(),
      ]);
      unique.set(key, route);
    });
    if (unique.size !== 1) return undefined;
    const route = [...unique.values()][0];
    return {
      providerNumber: normalizeProviderNumber(route.providerNumber),
      serviceCategory: normalizeServiceCategory(route.serviceCategory),
      deliveryMethod: route.deliveryMethod.trim(),
      matchedByIdentity,
    };
  };

  if (pageKeys.size) {
    const pageMatches = routes.filter(overlappingPages);
    const route = pickUniqueRoute(pageMatches, true);
    if (route) return route;
    if (pageMatches.length) return undefined;
  }

  if (fingerprint) {
    const identityMatches = routes.filter((route) => route.identityFingerprint?.trim() === fingerprint);
    const route = pickUniqueRoute(identityMatches, true);
    if (route) return route;
    if (identityMatches.length) return undefined;
  }

  if (!numberKey) return undefined;
  if (categoryKey) {
    return pickUniqueRoute(numberRoutes.filter((route) => normalizeServiceCategory(route.serviceCategory) === categoryKey), false);
  }
  if (fingerprint || pageKeys.size) return undefined;
  return pickUniqueRoute(numberRoutes.filter((route) => !route.identityFingerprint?.trim() && !route.pageFingerprints?.length), false);
}

/** 同じ番号＋種類の古い設定は置き換え、明示的に選んだ送り先を一件だけ記憶します。 */
export function upsertProviderServiceRoute(
  routes: ProviderServiceRoute[],
  providerNumber: string,
  serviceCategory: string,
  deliveryMethod: string,
  identityFingerprint?: string,
  pageFingerprints: string[] = [],
) {
  const numberKey = normalizeProviderNumber(providerNumber);
  const categoryKey = normalizeServiceCategory(serviceCategory);
  const method = deliveryMethod.trim();
  if (!numberKey || !method) return routes;
  const fingerprint = identityFingerprint?.trim() ?? '';
  const pageKeys = [...new Set(pageFingerprints.filter(Boolean))];
  const hasIdentity = Boolean(fingerprint || pageKeys.length);
  const matchesExisting = (route: ProviderServiceRoute) => {
    if (normalizeProviderNumber(route.providerNumber) !== numberKey) return false;
    const sameCategory = normalizeServiceCategory(route.serviceCategory) === categoryKey;
    if (fingerprint && route.identityFingerprint?.trim() === fingerprint) return true;
    if (!pageKeys.length) return false;
    const existingPages = route.pageFingerprints ?? [];
    const overlaps = existingPages.some((page) => pageKeys.includes(page));
    const exactPageSet = existingPages.length === pageKeys.length && existingPages.every((page) => pageKeys.includes(page));
    return overlaps && (sameCategory || exactPageSet);
  };
  const existing = routes.filter(matchesExisting);
  const mergedPageKeys = [...new Set([...existing.flatMap((route) => route.pageFingerprints ?? []), ...pageKeys])];
  return [
    ...routes.filter((route) => normalizeProviderNumber(route.providerNumber) !== numberKey
      || normalizeServiceCategory(route.serviceCategory) !== categoryKey
      || (hasIdentity ? !matchesExisting(route) : Boolean(route.identityFingerprint?.trim() || route.pageFingerprints?.length))),
    {
      providerNumber: numberKey,
      serviceCategory: categoryKey,
      deliveryMethod: method,
      ...(fingerprint ? { identityFingerprint: fingerprint } : {}),
      ...(mergedPageKeys.length ? { pageFingerprints: mergedPageKeys } : {}),
    },
  ];
}

/** 確認済みにする操作でも、行で選ばれた事業所・種類・送り先を保存します。 */
export function saveProviderGroupRouteChoice<T extends ProviderGroupLike>(group: T, routes: ProviderServiceRoute[] = []) {
  if (!group.providerNumber.trim() || !group.deliveryMethod?.trim()) return routes;
  return upsertProviderServiceRoute(
    routes,
    group.providerNumber,
    group.serviceCategory,
    group.deliveryMethod,
    group.routeIdentityFingerprint,
    group.routePageFingerprints,
  );
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

  const sameConfiguredRoute = candidates.every((entry) => Boolean(entry.deliveryMethod.trim())
    && entry.deliveryMethod.trim() === candidates[0].deliveryMethod.trim());
  if (!categoryKey) return sameConfiguredRoute ? { kind: 'matched', entry: candidates[0] } : { kind: 'ambiguous', candidates };

  const matching = candidates.filter((entry) => normalizeServiceCategory(entry.serviceCategory) === categoryKey);
  const unclassified = candidates.filter((entry) => !normalizeServiceCategory(entry.serviceCategory));
  if (matching.length === 1) {
    const matchingRoute = matching[0].deliveryMethod.trim();
    const unclassifiedConflicts = unclassified.some((entry) => entry.deliveryMethod.trim() !== matchingRoute);
    return unclassifiedConflicts ? { kind: 'ambiguous', candidates: [...matching, ...unclassified] } : { kind: 'matched', entry: matching[0] };
  }
  if (matching.length > 1) {
    const sameMatchingRoute = matching.every((entry) => Boolean(entry.deliveryMethod.trim())
      && entry.deliveryMethod.trim() === matching[0].deliveryMethod.trim());
    const matchingRoute = matching[0].deliveryMethod.trim();
    const unclassifiedConflicts = unclassified.some((entry) => entry.deliveryMethod.trim() !== matchingRoute);
    return sameMatchingRoute && !unclassifiedConflicts ? { kind: 'matched', entry: matching[0] } : { kind: 'ambiguous', candidates: [...matching, ...unclassified] };
  }
  return { kind: 'ambiguous', candidates };
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
      reconciled.push({
        ...rows[0],
        serviceCategory: normalizeServiceCategory(rows[0].serviceCategory) || rows[0].serviceCategory,
        needsServiceReview: false,
      });
      continue;
    }

    const category = normalizeServiceCategory(rows[0].serviceCategory);
    if (!category) {
      // 古い未判定行は送付方法が同じでも意図を推測せず、個別のまま残す。
      rows.forEach((row) => {
        reconciled.push({ ...row, needsServiceReview: row.needsServiceReview ?? true });
      });
      warningNumbers.add(normalizeProviderNumber(rows[0].providerNumber));
      continue;
    }

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

export function refreshProviderGroupRouting<T extends ProviderGroupLike, M extends ProviderMasterLike>(group: T, entries: M[], serviceRoutes: ProviderServiceRoute[] = []) {
  const serviceRoute = findProviderServiceRoute(
    serviceRoutes,
    group.providerNumber,
    group.serviceCategory,
    group.routeIdentityFingerprint,
    group.routePageFingerprints,
  );
  const match = serviceRoute
    ? { kind: 'routed' as const, route: serviceRoute }
    : matchProviderMaster(entries, group.providerNumber, group.serviceCategory);
  const dynamicIssues = new Set([
    DELIVERY_METHOD_ISSUE, SERVICE_MATCH_ISSUE, SERVICE_MASTER_MISSING_ISSUE, MASTER_ROUTE_REVIEW_ISSUE,
    PROVIDER_NAME_ISSUE, PROVIDER_NUMBER_ISSUE, CLIENT_NAME_ISSUE, SERVICE_MONTH_ISSUE,
  ]);
  group.issues = group.issues.filter((issue) => !dynamicIssues.has(issue));

  if (match.kind === 'ambiguous') {
    group.issues.push(SERVICE_MATCH_ISSUE);
    group.deliveryMethod = '';
    group.reviewed = false;
  } else if (match.kind === 'routed') {
    group.deliveryMethod = match.route.deliveryMethod;
    group.providerNumber = match.route.providerNumber;
    if ((match.route.matchedByIdentity || !normalizeServiceCategory(group.serviceCategory)) && match.route.serviceCategory) {
      group.serviceCategory = match.route.serviceCategory;
    }
    if (!group.providerName.trim()) {
      const masterMatch = matchProviderMaster(entries, group.providerNumber, group.serviceCategory);
      if (masterMatch.kind === 'matched' && masterMatch.entry.providerName.trim()) {
        group.providerName = masterMatch.entry.providerName.trim();
      }
    }
  } else if (match.kind === 'matched') {
    const entry = match.entry;
    group.deliveryMethod = entry.deliveryMethod;
    if (!group.providerName.trim() && entry.providerName.trim()) {
      group.providerName = entry.providerName.trim();
      group.issues = group.issues.filter((issue) => issue !== '事業所名を判定できません');
    }
    if (!entry.deliveryMethod) group.issues.push(DELIVERY_METHOD_ISSUE);
    if (!entry.deliveryMethod) group.reviewed = false;
  } else {
    group.deliveryMethod = '';
    group.issues.push(DELIVERY_METHOD_ISSUE);
    group.reviewed = false;
  }

  if (!group.providerName.trim()) group.issues.push(PROVIDER_NAME_ISSUE);
  if (!group.providerNumber.trim()) group.issues.push(PROVIDER_NUMBER_ISSUE);
  if (!group.clientName.trim()) group.issues.push(CLIENT_NAME_ISSUE);
  if (!group.serviceMonth.trim()) group.issues.push(SERVICE_MONTH_ISSUE);

  group.needsReview = group.issues.length > 0;
  return match;
}

export function refreshRoutingSafetyForGroups<T extends ProviderGroupLike, M extends ProviderMasterLike>(groups: T[], entries: M[], serviceRoutes: ProviderServiceRoute[] = []) {
  groups.forEach((group) => refreshProviderGroupRouting(group, entries, serviceRoutes));
  return groups;
}

/** 要確認画面で選んだマスタを、その場の振り分けと次回以降の番号＋種類ルールに反映します。 */
export function applyProviderMasterChoice<T extends ProviderGroupLike, M extends ProviderMasterLike>(
  group: T,
  masterId: string,
  entries: M[],
  serviceRoutes: ProviderServiceRoute[] = [],
) {
  const entry = entries.find((candidate) => candidate.id === masterId && candidate.deliveryMethod.trim());
  if (!entry) return serviceRoutes;

  group.providerNumber = entry.providerNumber;
  group.providerName = entry.providerName.trim() || group.providerName;
  if (!normalizeServiceCategory(group.serviceCategory) && normalizeServiceCategory(entry.serviceCategory)) {
    group.serviceCategory = normalizeServiceCategory(entry.serviceCategory);
  }
  const nextRoutes = upsertProviderServiceRoute(
    serviceRoutes,
    entry.providerNumber,
    group.serviceCategory,
    entry.deliveryMethod,
    group.routeIdentityFingerprint,
    group.routePageFingerprints,
  );
  refreshProviderGroupRouting(group, entries, nextRoutes);
  return nextRoutes;
}
