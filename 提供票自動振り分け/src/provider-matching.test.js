import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractServiceCategory, mergePageFacts, shouldStartNewSlip } from './analysis-rules.ts';
import {
  applyProviderMasterChoice,
  canAutoAssignServiceCategory,
  createProviderRouteIdentityFingerprint,
  createProviderRoutePageFingerprints,
  DELIVERY_METHOD_ISSUE,
  ensureProviderMasterEntries,
  findProviderServiceRoute,
  getProviderMasterWarningNumbers,
  hasIndependentGroupReview,
  matchProviderMaster,
  reconcileProviderMaster,
  refreshRoutingSafetyForGroups,
  PROVIDER_NUMBER_ISSUE,
  saveProviderGroupRouteChoice,
  SERVICE_MATCH_ISSUE,
  upsertProviderServiceRoute,
} from './provider-matching.ts';
import { canCreateOutputs, canToggleForceDownload } from './output-policy.ts';
import { loadSavedData } from './storage.ts';
import { SERVICE_CATEGORY_GROUPS, SERVICE_CATEGORY_OPTIONS, serviceCategoryForCodePrefix } from './service-categories.ts';
import { applyAutomaticGeminiSuggestion, assistUnresolvedProviderNames } from './provider-assistance.ts';

const baseGroup = (overrides = {}) => ({
  clientName: '利用者A',
  providerNumber: '1234567890',
  providerName: 'PDFに記載された正式名称',
  serviceCategory: '訪問リハビリテーション',
  serviceMonth: '令和8年10月',
  deliveryMethod: '',
  issues: [],
  needsReview: false,
  reviewed: false,
  ...overrides,
});

let fakeMasterId = 0;
const makeFakeMasterEntry = (providerNumber, providerName, serviceCategory = '') => ({
  id: `fake-master-${++fakeMasterId}`,
  providerNumber,
  providerName,
  serviceCategory,
  deliveryMethod: '',
  updatedAt: '2026-10-01T00:00:00.000Z',
});

function confirmGroupChoice(group, entries, routes = []) {
  const savedRoutes = saveProviderGroupRouteChoice(group, routes);
  refreshRoutingSafetyForGroups([group], entries, savedRoutes);
  group.reviewed = true;
  return savedRoutes;
}

const unresolvedOffice = (overrides = {}) => baseGroup({
  providerNumber: '9999900021', providerName: '', serviceCategory: '訪問看護',
  geminiExcerpt: '事業所番号 9999900021', geminiUsed: false,
  issues: ['事業所名を判定できません'], needsReview: true,
  ...overrides,
});
const officeSuggestion = (overrides = {}) => ({
  providerNumber: '9999900021', providerName: '架空の補助確認事業所', confidence: 0.96,
  isHomeMedicalCare: false, reason: '架空の回答', requiresReview: true, ...overrides,
});

describe('事業所名の補助確認と再補完', () => {
  it('PDFに名前がなく高確信度の回答があると、保存対象の空欄を補い、補助確認後も維持する', async () => {
    const group = unresolvedOffice();
    const masters = ensureProviderMasterEntries([], [group], [], makeFakeMasterEntry).entries;
    // 保存済みルール経由の照合では、表示用の一時マスタが返る場合もあります。
    await assistUnresolvedProviderNames([group], masters, {
      createEntry: makeFakeMasterEntry,
      findMaster: () => ({ ...masters[0] }),
      requestSuggestion: async () => officeSuggestion(),
    });
    const after = ensureProviderMasterEntries(masters, [group], [], makeFakeMasterEntry);
    assert.equal(after.entries[0].providerName, '架空の補助確認事業所');
    assert.equal(group.providerName, '架空の補助確認事業所');
    assert.ok(!JSON.stringify(after.entries).includes(group.clientName));
    assert.ok(!('clientName' in after.entries[0]));
  });

  it('同じ番号の種類違い・種類なし・複数行でも、空の名前をすべて補う', async () => {
    const group = unresolvedOffice();
    const masters = [
      makeFakeMasterEntry(group.providerNumber, '', '居宅療養管理指導'),
      makeFakeMasterEntry(group.providerNumber, '', ''),
      makeFakeMasterEntry(group.providerNumber, '', ''),
    ];
    await assistUnresolvedProviderNames([group], masters, {
      createEntry: makeFakeMasterEntry, requestSuggestion: async () => officeSuggestion({ isHomeMedicalCare: true }),
    });
    assert.ok(masters.every((entry) => entry.providerName === '架空の補助確認事業所'));
    assert.deepEqual(masters.map((entry) => entry.serviceCategory), ['居宅療養管理指導', '', '']);
    assert.equal(group.serviceCategory, '訪問看護');
    assert.equal(masters.length, 3);
  });

  it('確信度が0.9未満でも番号一致なら空欄を補い、確認表示は残す', async () => {
    const group = unresolvedOffice();
    const masters = [makeFakeMasterEntry(group.providerNumber, '', '')];
    await assistUnresolvedProviderNames([group], masters, {
      createEntry: makeFakeMasterEntry, requestSuggestion: async () => officeSuggestion({ confidence: 0.6 }),
    });
    assert.equal(masters[0].providerName, '架空の補助確認事業所');
    assert.equal(masters[0].serviceCategory, '');
    assert.equal(masters[0].deliveryMethod, '');
    assert.equal(group.needsReview, true);
    assert.ok(group.issues.some((issue) => issue.startsWith('自動確認候補：')));
  });

  it('1ページ目に名前がなく別ページで読めた名前を、Geminiを呼ばずに登録する', async () => {
    const firstPage = { providerNumber: '9999900021', serviceCategory: '訪問看護', providerName: '', isAppendix: false };
    const continued = mergePageFacts(firstPage, { providerName: '架空の続きページ事業所', serviceCategory: '', isAppendix: true });
    const group = unresolvedOffice({ ...continued, pages: [0, 1, 2].map((pageIndex) => ({ sourceId: 'fake-pdf', pageIndex })) });
    const masters = [makeFakeMasterEntry(group.providerNumber, '', '')];
    let requests = 0;
    await assistUnresolvedProviderNames([group], masters, {
      createEntry: makeFakeMasterEntry, requestSuggestion: async () => { requests++; throw new Error('呼び出さない'); },
    });
    assert.equal(masters[0].providerName, '架空の続きページ事業所');
    assert.equal(requests, 0);
  });

  it('同じ番号の別提供票で読めた名前は、種類にかかわらず空欄を補う', async () => {
    const missing = unresolvedOffice();
    const named = unresolvedOffice({ providerName: '架空の別提供票事業所', serviceCategory: '居宅療養管理指導' });
    const masters = [makeFakeMasterEntry(missing.providerNumber, '', '訪問看護')];
    let requests = 0;
    await assistUnresolvedProviderNames([missing, named], masters, {
      createEntry: makeFakeMasterEntry, requestSuggestion: async () => { requests++; throw new Error('通信エラー'); },
    });
    assert.equal(masters[0].providerName, '架空の別提供票事業所');
    assert.equal(missing.providerName, '架空の別提供票事業所');
    assert.equal(requests, 0);
    assert.ok(!missing.issues.some((issue) => issue.startsWith('事業所情報の補助確認：')));
  });

  it('Gemini失敗時にPDFにも名前がなければ空欄を維持し、ログイン・通信の理由を表示する', async () => {
    for (const [error, expected] of [
      [new Error('スタッフポータルのログインを確認できません'), 'ポータルからアプリを開き直す'],
      [new TypeError('Failed to fetch'), '通信できず'],
      [new Error('Gemini APIキーが設定されていません'), '補助確認の設定が完了していません'],
      [new Error('server internal secret-detail'), '補助確認サービスを利用できません'],
    ]) {
      const group = unresolvedOffice();
      const masters = [makeFakeMasterEntry(group.providerNumber, '', '')];
      await assistUnresolvedProviderNames([group], masters, {
        createEntry: makeFakeMasterEntry, requestSuggestion: async () => { throw error; },
      });
      refreshRoutingSafetyForGroups([group], masters);
      assert.equal(masters[0].providerName, '');
      assert.equal(group.needsReview, true);
      assert.ok(group.issues.some((issue) => issue.includes(expected)));
      assert.ok(!group.issues.join('').includes('secret-detail'));
    }
  });

  it('1件の通信失敗で後続の補助確認を打ち切らない', async () => {
    const groups = [unresolvedOffice(), unresolvedOffice({ providerNumber: '9999900022', geminiExcerpt: '事業所番号 9999900022' })];
    const masters = groups.map((group) => makeFakeMasterEntry(group.providerNumber, '', ''));
    let requests = 0;
    await assistUnresolvedProviderNames(groups, masters, {
      createEntry: makeFakeMasterEntry,
      requestSuggestion: async (input) => {
        requests++;
        if (input.providerNumber === '9999900021') throw new Error('通信エラー');
        return officeSuggestion({ providerNumber: input.providerNumber });
      },
    });
    assert.equal(requests, 2);
    assert.equal(masters[0].providerName, '');
    assert.equal(masters[1].providerName, '架空の補助確認事業所');
  });

  it('Geminiが名前を答えても入力済みの略称・送り先は上書きしない', () => {
    const group = unresolvedOffice();
    const masters = [{ ...makeFakeMasterEntry(group.providerNumber, 'スタッフ入力済み略称', '訪問看護'), deliveryMethod: 'FAX' }];
    applyAutomaticGeminiSuggestion(group, officeSuggestion(), masters, { createEntry: makeFakeMasterEntry });
    assert.equal(masters[0].providerName, 'スタッフ入力済み略称');
    assert.equal(masters[0].deliveryMethod, 'FAX');
  });

  it('補助確認の失敗後に同じ番号の別提供票で名前が分かれば、空欄と失敗表示を補う', async () => {
    const groups = [unresolvedOffice(), unresolvedOffice({ geminiExcerpt: '同じ番号の別提供票 9999900021' })];
    const masters = [makeFakeMasterEntry(groups[0].providerNumber, '', '')];
    let requests = 0;
    await assistUnresolvedProviderNames(groups, masters, {
      createEntry: makeFakeMasterEntry,
      requestSuggestion: async () => {
        if (++requests === 1) throw new Error('通信エラー');
        return officeSuggestion();
      },
    });
    assert.equal(requests, 2);
    assert.equal(masters[0].providerName, '架空の補助確認事業所');
    assert.ok(groups.every((group) => group.providerName === '架空の補助確認事業所'));
    assert.ok(groups.every((group) => !group.issues.some((issue) => issue.startsWith('事業所情報の補助確認：'))));
  });

  it('Geminiの番号がPDFの番号と違うときは名前を書き込まない', async () => {
    const group = unresolvedOffice();
    const masters = [makeFakeMasterEntry(group.providerNumber, '', '')];
    await assistUnresolvedProviderNames([group], masters, {
      createEntry: makeFakeMasterEntry, requestSuggestion: async () => officeSuggestion({ providerNumber: '9999900099' }),
    });
    assert.equal(masters[0].providerName, '');
    assert.equal(group.providerNumber, '9999900021');
    assert.equal(group.needsReview, true);
  });
});

describe('サービス種類を使った事業所マスタ照合', () => {
  it('空のマスタへ2ページの提供票を読み込むと事業所名を登録する', () => {
    const result = ensureProviderMasterEntries([], [baseGroup({
      providerNumber: '9999900011',
      providerName: '架空の二ページ事業所',
      serviceCategory: '訪問看護',
      pages: [{ sourceId: 'fake-pdf', pageIndex: 0 }, { sourceId: 'fake-pdf', pageIndex: 1 }],
    })], [], makeFakeMasterEntry);
    assert.equal(result.added, 1);
    assert.equal(result.entries[0].providerName, '架空の二ページ事業所');
  });

  it('3ページ以上の提供票でも事業所名を登録する', () => {
    const result = ensureProviderMasterEntries([], [baseGroup({
      providerNumber: '9999900012',
      providerName: '架空の複数ページ事業所',
      serviceCategory: '訪問リハビリテーション',
      pages: [0, 1, 2, 3].map((pageIndex) => ({ sourceId: 'fake-pdf', pageIndex })),
    })], [], makeFakeMasterEntry);
    assert.equal(result.added, 1);
    assert.equal(result.entries[0].providerName, '架空の複数ページ事業所');
  });

  it('同じ番号・種類の先行グループが空名でも、後続で読めた名前を新規行へ反映する', () => {
    const result = ensureProviderMasterEntries([], [
      baseGroup({ providerNumber: '9999900015', providerName: '', serviceCategory: '訪問看護' }),
      baseGroup({ providerNumber: '9999900015', providerName: '架空の後続ページ事業所', serviceCategory: '訪問看護' }),
    ], [], makeFakeMasterEntry);
    assert.equal(result.added, 1);
    assert.equal(result.entries[0].providerName, '架空の後続ページ事業所');
  });

  it('同じ事業所番号の複数提供票を種類別に登録し、同種類の重複行も空名を補う', () => {
    const groups = [
      baseGroup({ providerNumber: '9999900013', providerName: '架空の訪問看護事業所', serviceCategory: '訪問看護' }),
      baseGroup({ providerNumber: '9999900013', providerName: '架空の居宅療養事業所', serviceCategory: '居宅療養管理指導' }),
    ];
    const added = ensureProviderMasterEntries([], groups, [], makeFakeMasterEntry);
    assert.equal(added.entries.length, 2);
    assert.deepEqual(added.entries.map((entry) => entry.providerName), ['架空の訪問看護事業所', '架空の居宅療養事業所']);

    const duplicateRows = [
      makeFakeMasterEntry('9999900013', '', '訪問看護'),
      { ...makeFakeMasterEntry('9999900013', '', '訪問看護'), deliveryMethod: 'FAX' },
    ];
    const filled = ensureProviderMasterEntries(duplicateRows, [groups[0]], [], makeFakeMasterEntry);
    assert.deepEqual(filled.entries.map((entry) => entry.providerName), ['架空の訪問看護事業所', '架空の訪問看護事業所']);
  });

  it('入力済みの事業所名は提供票の名称で上書きしない', () => {
    const existing = makeFakeMasterEntry('9999900014', '手入力した略称', '訪問看護');
    const result = ensureProviderMasterEntries([existing], [baseGroup({
      providerNumber: '9999900014',
      providerName: '提供票に記載の別名称',
      serviceCategory: '訪問看護',
    })], [], makeFakeMasterEntry);
    assert.equal(result.entries[0].providerName, '手入力した略称');
    assert.equal(result.added, 0);
  });

  it('マスタ名を略称にしても、番号とサービス種類で一致する', () => {
    const master = { providerNumber: '1234567890', providerName: '訪リハ', serviceCategory: '訪問リハビリテーション', deliveryMethod: 'FAX' };
    const match = matchProviderMaster([master], '1234567890', '訪問リハビリテーション');
    assert.equal(match.kind, 'matched');
    assert.equal(match.entry.providerName, '訪リハ');
    assert.equal(match.entry.deliveryMethod, 'FAX');
  });

  it('同じ番号の訪問リハビリと居宅療養管理指導を別々の送付方法へ振り分ける', () => {
    const masters = [
      { providerNumber: '1234567890', providerName: '訪リハ', serviceCategory: '訪問リハビリテーション', deliveryMethod: 'メール' },
      { providerNumber: '1234567890', providerName: '居宅療養', serviceCategory: '居宅療養管理指導', deliveryMethod: 'FAX' },
    ];
    const rehab = matchProviderMaster(masters, '1234567890', '訪問リハビリテーション');
    const homeCare = matchProviderMaster(masters, '1234567890', '居宅療養管理指導');
    assert.equal(rehab.kind, 'matched');
    assert.equal(rehab.entry.deliveryMethod, 'メール');
    assert.equal(homeCare.kind, 'matched');
    assert.equal(homeCare.entry.deliveryMethod, 'FAX');
  });

  it('種類が決められない場合は要確認にして推測で選ばない', () => {
    const masters = [
      { providerNumber: '1234567890', providerName: '訪リハ', serviceCategory: '訪問リハビリテーション', deliveryMethod: 'メール' },
      { providerNumber: '1234567890', providerName: '居宅療養', serviceCategory: '居宅療養管理指導', deliveryMethod: 'FAX' },
    ];
    const group = baseGroup({ serviceCategory: '' });
    refreshRoutingSafetyForGroups([group], masters);
    assert.equal(group.needsReview, true);
    assert.ok(group.issues.includes(SERVICE_MATCH_ISSUE));
    assert.equal(group.deliveryMethod, '');
  });

  it('種類が一致しても送り先の異なる未判定行が残る場合は推測しない', () => {
    const masters = [
      { providerNumber: '1234567890', providerName: '事業所A', serviceCategory: '訪問介護', deliveryMethod: 'FAX' },
      { providerNumber: '1234567890', providerName: '事業所B', serviceCategory: '', deliveryMethod: 'メール' },
    ];
    const match = matchProviderMaster(masters, '1234567890', '訪問介護');
    assert.equal(match.kind, 'ambiguous');
  });

  it('同じ番号のマスタが1行なら、サービス種類が空でもその送り先に振り分ける', () => {
    const master = { providerNumber: '1234567890', providerName: '事業所A', serviceCategory: '', deliveryMethod: 'FAX', needsServiceReview: true };
    const group = baseGroup({ serviceCategory: '' });
    refreshRoutingSafetyForGroups([group], [master]);
    assert.equal(group.needsReview, false);
    assert.equal(group.deliveryMethod, 'FAX');
    assert.ok(!group.issues.includes(SERVICE_MATCH_ISSUE));
  });

  it('同じ番号の2件を種類・送り先で決めると、その場で要確認が消え、次回も自動振り分けする', () => {
    const masters = [
      { providerNumber: '1234567890', providerName: '事業所A', serviceCategory: '', deliveryMethod: 'メール' },
      { providerNumber: '1234567890', providerName: '事業所B', serviceCategory: '', deliveryMethod: 'FAX' },
    ];
    const first = baseGroup({ id: 'group-a', serviceCategory: '' });
    const second = baseGroup({ id: 'group-b', serviceCategory: '' });
    refreshRoutingSafetyForGroups([first, second], masters);
    assert.ok([first, second].every((group) => group.needsReview && group.issues.includes(SERVICE_MATCH_ISSUE)));
    first.issues.push('送付方法が未設定です', '事業所マスタの送付方法を再確認してください', '該当するサービス種類の事業所マスタがありません');

    first.serviceCategory = '訪問介護';
    first.deliveryMethod = 'FAX';
    let savedRoutes = upsertProviderServiceRoute([], first.providerNumber, first.serviceCategory, first.deliveryMethod);
    second.serviceCategory = '訪問看護';
    second.deliveryMethod = 'メール';
    savedRoutes = upsertProviderServiceRoute(savedRoutes, second.providerNumber, second.serviceCategory, second.deliveryMethod);
    refreshRoutingSafetyForGroups([first, second], masters, savedRoutes);
    assert.ok([first, second].every((group) => group.needsReview === false && !group.issues.includes(SERVICE_MATCH_ISSUE)));
    assert.deepEqual(first.issues, []);
    assert.equal(first.deliveryMethod, 'FAX');
    assert.equal(second.deliveryMethod, 'メール');
    assert.equal(masters.length, 2);
    assert.equal(findProviderServiceRoute(savedRoutes, first.providerNumber, first.serviceCategory)?.deliveryMethod, 'FAX');

    const nextFirst = baseGroup({ serviceCategory: '訪問介護' });
    const nextSecond = baseGroup({ serviceCategory: '訪問看護' });
    refreshRoutingSafetyForGroups([nextFirst, nextSecond], masters, savedRoutes);
    assert.equal(nextFirst.needsReview, false);
    assert.equal(nextFirst.deliveryMethod, 'FAX');
    assert.equal(nextSecond.needsReview, false);
    assert.equal(nextSecond.deliveryMethod, 'メール');
  });

  it('要確認で選んだ送り先はリセット後の同じPDFにも適用し、種類未判定を復元する', () => {
    const masters = [
      { providerNumber: '1234567890', providerName: '事業所A', serviceCategory: '訪問リハビリテーション', deliveryMethod: 'メール' },
      { providerNumber: '1234567890', providerName: '事業所A', serviceCategory: '居宅療養管理指導', deliveryMethod: 'FAX' },
    ];
    const identityFingerprint = 'a'.repeat(64);
    const first = baseGroup({
      id: 'group-before-reset',
      serviceCategory: '',
      routeIdentityFingerprint: identityFingerprint,
    });
    refreshRoutingSafetyForGroups([first], masters);
    assert.equal(first.needsReview, true);
    assert.ok(first.issues.includes(SERVICE_MATCH_ISSUE));

    first.serviceCategory = '訪問リハビリテーション';
    first.deliveryMethod = 'メール';
    const savedData = {
      providerServiceRoutes: upsertProviderServiceRoute(
        [], first.providerNumber, first.serviceCategory, first.deliveryMethod, identityFingerprint,
      ),
    };
    refreshRoutingSafetyForGroups([first], masters, savedData.providerServiceRoutes);
    assert.equal(first.needsReview, false);
    assert.equal(first.deliveryMethod, 'メール');

    // アプリの「リセット」は今回の結果だけを空にし、保存済みルールには触れない。
    let currentResult = { groups: [first] };
    currentResult = undefined;
    assert.equal(currentResult, undefined);
    assert.equal(savedData.providerServiceRoutes.length, 1);

    const reuploaded = baseGroup({
      id: 'group-after-reset',
      serviceCategory: '',
      routeIdentityFingerprint: identityFingerprint,
    });
    refreshRoutingSafetyForGroups([reuploaded], masters, savedData.providerServiceRoutes);
    assert.equal(reuploaded.needsReview, false);
    assert.equal(reuploaded.serviceCategory, '訪問リハビリテーション');
    assert.equal(reuploaded.deliveryMethod, 'メール');
    assert.ok(!reuploaded.issues.includes(SERVICE_MATCH_ISSUE));

    const differentSlip = baseGroup({ serviceCategory: '', routeIdentityFingerprint: 'b'.repeat(64) });
    refreshRoutingSafetyForGroups([differentSlip], masters, savedData.providerServiceRoutes);
    assert.equal(differentSlip.needsReview, true);
    assert.ok(differentSlip.issues.includes(SERVICE_MATCH_ISSUE));
  });

  it('提供票の照合指紋は同じ読み取り内容とPDFページから再現できる', async () => {
    const group = baseGroup({
      providerName: ' 事業所 A ',
      clientName: '利用者 A',
      serviceMonth: '令和8年10月',
      pages: [{ sourceId: 'source-a', pageIndex: 16 }, { sourceId: 'source-a', pageIndex: 17 }],
    });
    const sources = [{ id: 'source-a', hash: 'fake-pdf-hash' }];
    const first = await createProviderRouteIdentityFingerprint(group, sources);
    const reuploaded = await createProviderRouteIdentityFingerprint({
      ...group,
      providerName: '事業所A',
      clientName: '利用者A',
    }, sources);
    assert.match(first, /^[0-9a-f]{64}$/u);
    assert.equal(reuploaded, first);
    assert.notEqual(await createProviderRouteIdentityFingerprint({ ...group, clientName: '別の利用者' }, sources), first);
  });

  it('番号なしページで確認済みにした事業所・種類・送り先をリセット後に復元する', () => {
    const masters = [
      { id: 'fake-office-a', providerNumber: '9999900001', providerName: '架空の訪問看護事業所', serviceCategory: '訪問看護', deliveryMethod: '' },
    ];
    const selected = baseGroup({
      providerNumber: '9999900001',
      serviceCategory: '訪問看護',
      deliveryMethod: 'FAX',
      routeIdentityFingerprint: 'fingerprint-before-confirm',
      routePageFingerprints: ['page-without-number'],
      issues: [PROVIDER_NUMBER_ISSUE, DELIVERY_METHOD_ISSUE],
      needsReview: true,
      reviewed: false,
    });
    const settings = { providerServiceRoutes: confirmGroupChoice(selected, masters) };
    assert.equal(selected.needsReview, false);
    assert.equal(selected.reviewed, true);
    assert.equal(settings.providerServiceRoutes.length, 1);

    let currentResult = { groups: [selected] };
    currentResult = undefined; // 実際のリセットも結果だけを消し、保存設定には触れません。
    assert.equal(currentResult, undefined);
    assert.equal(settings.providerServiceRoutes.length, 1);

    const reuploaded = baseGroup({
      providerNumber: '',
      serviceCategory: '',
      routeIdentityFingerprint: 'fingerprint-changed-after-ocr',
      routePageFingerprints: ['page-without-number'],
      issues: [PROVIDER_NUMBER_ISSUE, DELIVERY_METHOD_ISSUE],
      needsReview: true,
    });
    refreshRoutingSafetyForGroups([reuploaded], masters, settings.providerServiceRoutes);
    assert.equal(reuploaded.providerNumber, '9999900001');
    assert.equal(reuploaded.serviceCategory, '訪問看護');
    assert.equal(reuploaded.deliveryMethod, 'FAX');
    assert.equal(reuploaded.needsReview, false);
    assert.equal([reuploaded].filter((group) => group.needsReview).length, 0);
  });

  it('続きページだけに分かれて再読込されても、共有するPDFページ指紋から復元する', () => {
    const masters = [
      { providerNumber: '9999900002', providerName: '架空の訪問リハ事業所', serviceCategory: '訪問リハビリテーション', deliveryMethod: '' },
    ];
    const selected = baseGroup({
      providerNumber: '9999900002',
      serviceCategory: '訪問リハビリテーション',
      deliveryMethod: 'メール',
      routeIdentityFingerprint: 'old-name-month-fingerprint',
      routePageFingerprints: ['page-10', 'page-11', 'page-12'],
    });
    const savedRoutes = confirmGroupChoice(selected, masters);
    assert.equal(selected.needsReview, false);

    const reuploadedContinuation = baseGroup({
      providerNumber: '',
      providerName: '読み取りが少し変わった事業所表記',
      clientName: '利用者A（読み取り差）',
      serviceMonth: '令和8年11月',
      serviceCategory: '',
      routeIdentityFingerprint: 'new-name-month-fingerprint',
      routePageFingerprints: ['page-12'],
      issues: [PROVIDER_NUMBER_ISSUE, DELIVERY_METHOD_ISSUE],
      needsReview: true,
    });
    refreshRoutingSafetyForGroups([reuploadedContinuation], masters, savedRoutes);
    assert.equal(reuploadedContinuation.providerNumber, '9999900002');
    assert.equal(reuploadedContinuation.serviceCategory, '訪問リハビリテーション');
    assert.equal(reuploadedContinuation.deliveryMethod, 'メール');
    assert.equal(reuploadedContinuation.needsReview, false);
    assert.equal([reuploadedContinuation].filter((group) => group.needsReview).length, 0);
  });

  it('同じ事業所番号が複数ある場合も、確認済みの選択だけを同じPDFに適用する', () => {
    const masters = [
      { providerNumber: '9999900003', providerName: '架空事業所A', serviceCategory: '訪問リハビリテーション', deliveryMethod: '' },
      { providerNumber: '9999900003', providerName: '架空事業所B', serviceCategory: '居宅療養管理指導', deliveryMethod: '' },
    ];
    const selected = baseGroup({
      providerNumber: '9999900003',
      serviceCategory: '',
      deliveryMethod: '',
      routeIdentityFingerprint: 'old-fingerprint',
      routePageFingerprints: ['duplicate-number-page'],
    });
    refreshRoutingSafetyForGroups([selected], masters);
    assert.equal(selected.needsReview, true);
    assert.ok(selected.issues.includes(SERVICE_MATCH_ISSUE));

    selected.serviceCategory = '居宅療養管理指導';
    selected.deliveryMethod = 'FAX';
    const savedRoutes = confirmGroupChoice(selected, masters);
    assert.equal(selected.needsReview, false);
    assert.equal(selected.reviewed, true);

    const reuploaded = baseGroup({
      providerNumber: '9999900003',
      serviceCategory: '',
      routeIdentityFingerprint: 'new-fingerprint',
      routePageFingerprints: ['duplicate-number-page'],
    });
    refreshRoutingSafetyForGroups([reuploaded], masters, savedRoutes);
    assert.equal(reuploaded.serviceCategory, '居宅療養管理指導');
    assert.equal(reuploaded.deliveryMethod, 'FAX');
    assert.equal(reuploaded.needsReview, false);
    assert.equal([reuploaded].filter((group) => group.needsReview).length, 0);

    const differentPage = baseGroup({
      providerNumber: '9999900003',
      serviceCategory: '',
      routePageFingerprints: ['another-provider-slip-page'],
    });
    refreshRoutingSafetyForGroups([differentPage], masters, savedRoutes);
    assert.equal(differentPage.needsReview, true);
    assert.ok(differentPage.issues.includes(SERVICE_MATCH_ISSUE));
  });

  it('ページ指紋は名前・年月の読み取り差に影響されず、同じPDFページで一致する', async () => {
    const source = [{ id: 'source-a', hash: 'fictional-pdf-content-hash' }];
    const original = await createProviderRoutePageFingerprints({ pages: [{ sourceId: 'source-a', pageIndex: 16 }] }, source);
    const changedRecognition = await createProviderRoutePageFingerprints({ pages: [{ sourceId: 'source-a', pageIndex: 16 }] }, source);
    const nextPage = await createProviderRoutePageFingerprints({ pages: [{ sourceId: 'source-a', pageIndex: 17 }] }, source);
    assert.equal(original.length, 1);
    assert.deepEqual(changedRecognition, original);
    assert.notDeepEqual(nextPage, original);
  });

  it('確認表の編集後に安全判定を再計算すると状態が更新される', () => {
    const group = baseGroup({ clientName: '', issues: ['利用者名を判定できません'] });
    const masters = [{ providerNumber: '1234567890', providerName: '訪リハ', serviceCategory: '訪問リハビリテーション', deliveryMethod: 'FAX' }];
    refreshRoutingSafetyForGroups([group], masters);
    assert.equal(group.needsReview, true);
    group.clientName = '利用者A'; // 確認表で入力した状態
    refreshRoutingSafetyForGroups([group], masters); // main.ts の refreshRoutingSafety が呼ぶ純粋処理
    assert.equal(group.needsReview, false);
    assert.ok(!group.issues.includes('利用者名を判定できません'));
  });

  it('旧保存データはサービス種類がなくてもそのまま読み込める', async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const legacy = {
      version: 1,
      providerMaster: [{ id: 'old', providerNumber: '1234567890', providerName: '略称', deliveryMethod: 'FAX', updatedAt: '2026-10-01T00:00:00.000Z' }],
      geminiEnabled: false,
    };
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: () => JSON.stringify(legacy), setItem: () => {} },
    });
    try {
      const loaded = await loadSavedData();
      assert.equal(loaded.providerMaster[0].providerName, '略称');
      assert.equal(loaded.providerMaster[0].deliveryMethod, 'FAX');
      assert.equal(loaded.providerMaster[0].serviceCategory, undefined);
    } finally {
      if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
      else delete globalThis.localStorage;
    }
  });

  it('保存済みサービス種類は残し、新しい送り先設定がなくても旧データとして読み込める', async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const legacy = {
      version: 1,
      providerMaster: [{ id: 'old', providerNumber: '1234567890', providerName: '略称', serviceCategory: '居宅療養管理指導', deliveryMethod: 'FAX', updatedAt: '2026-10-01T00:00:00.000Z' }],
      geminiEnabled: false,
    };
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: () => JSON.stringify(legacy), setItem: () => {} },
    });
    try {
      const loaded = await loadSavedData();
      assert.equal(loaded.providerMaster[0].serviceCategory, '居宅療養管理指導');
      assert.equal(loaded.providerServiceRoutes, undefined);
    } finally {
      if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
      else delete globalThis.localStorage;
    }
  });

  it('保存済みの番号＋種類の送り先ルールを読み込める', async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const route = { providerNumber: '1234567890', serviceCategory: '訪問介護', deliveryMethod: 'FAX' };
    const data = { version: 1, providerMaster: [], geminiEnabled: false, providerServiceRoutes: [route] };
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: () => JSON.stringify(data), setItem: () => {} },
    });
    try {
      const loaded = await loadSavedData();
      assert.deepEqual(loaded.providerServiceRoutes, [route]);
    } finally {
      if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
      else delete globalThis.localStorage;
    }
  });

  it('識別指紋付きの保存済み送り先ルールを読み込める', async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const route = { providerNumber: '1234567890', serviceCategory: '訪問介護', deliveryMethod: 'FAX', identityFingerprint: 'a'.repeat(64), pageFingerprints: ['b'.repeat(64)] };
    const data = { version: 1, providerMaster: [], geminiEnabled: false, providerServiceRoutes: [route] };
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: () => JSON.stringify(data), setItem: () => {} },
    });
    try {
      const loaded = await loadSavedData();
      assert.deepEqual(loaded.providerServiceRoutes, [route]);
    } finally {
      if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
      else delete globalThis.localStorage;
    }
  });

  it('種類が空の3行は送付方法がばらばらでも残し、要確認にする', () => {
    const rows = [
      { id: 'a', providerNumber: '1234567890', providerName: '事業所A', serviceCategory: '', deliveryMethod: 'FAX' },
      { id: 'b', providerNumber: '1234567890', providerName: '事業所B', serviceCategory: '', deliveryMethod: 'メール' },
      { id: 'c', providerNumber: '1234567890', providerName: '事業所C', serviceCategory: '', deliveryMethod: 'LINE' },
    ];
    const normalized = reconcileProviderMaster(rows);
    assert.equal(normalized.entries.length, 3);
    assert.equal(normalized.mergedCount, 0);
    assert.ok(normalized.entries.every((entry) => entry.needsServiceReview));
    assert.deepEqual(normalized.warningNumbers, ['1234567890']);
  });

  it('種類が空の行は送付方法が同じでも自動でまとめない', () => {
    const rows = [
      { id: 'a', providerNumber: '1234567890', providerName: '事業所A', serviceCategory: '', deliveryMethod: 'FAX' },
      { id: 'b', providerNumber: '1234567890', providerName: '事業所B', serviceCategory: '', deliveryMethod: 'FAX' },
      { id: 'c', providerNumber: '1234567890', providerName: '事業所C', serviceCategory: '', deliveryMethod: 'FAX' },
    ];
    const normalized = reconcileProviderMaster(rows);
    assert.equal(normalized.entries.length, 3);
    assert.equal(normalized.mergedCount, 0);
    assert.ok(normalized.entries.every((entry) => entry.deliveryMethod === 'FAX'));
    assert.ok(normalized.entries.every((entry) => entry.needsServiceReview));
  });

  it('サービス種類を手動設定すると番号＋種類が一意になり、確認状態を解除する', () => {
    const rows = [
      { id: 'a', providerNumber: '1234567890', providerName: '事業所A', serviceCategory: '訪問リハビリテーション', deliveryMethod: 'FAX', needsServiceReview: true },
      { id: 'b', providerNumber: '1234567890', providerName: '事業所B', serviceCategory: '', deliveryMethod: 'メール', needsServiceReview: true },
    ];
    const normalized = reconcileProviderMaster(rows);
    assert.equal(normalized.entries.find((entry) => entry.id === 'a')?.needsServiceReview, false);
    assert.equal(normalized.entries.find((entry) => entry.id === 'b')?.needsServiceReview, false);
  });

  it('送付方法を決めている既存行へPDFのサービス種類を自動設定しない', () => {
    const row = { providerNumber: '1234567890', providerName: '略称', serviceCategory: '', deliveryMethod: '居宅療養', needsServiceReview: false };
    assert.equal(canAutoAssignServiceCategory(row, 1, 1), false);
    assert.equal(canAutoAssignServiceCategory({ ...row, deliveryMethod: '' }, 1, 1), true);
  });

  it('マスタと提供票の要確認を二重に数えず、別の不足情報は残す', () => {
    assert.equal(hasIndependentGroupReview([SERVICE_MATCH_ISSUE, '送付方法が未設定です'], false, true), false);
    assert.equal(hasIndependentGroupReview([SERVICE_MATCH_ISSUE, '利用者名を判定できません'], false, true), true);
    assert.equal(getProviderMasterWarningNumbers([
      { providerNumber: '1234567890', providerName: 'A', serviceCategory: '', deliveryMethod: 'FAX' },
      { providerNumber: '1234567890', providerName: 'B', serviceCategory: '', deliveryMethod: 'メール' },
    ]).length, 1);
  });

  it('介護サービス種類の定数一覧に公式コードを登録している', () => {
    assert.ok(SERVICE_CATEGORY_GROUPS.length > 1);
    assert.ok(SERVICE_CATEGORY_OPTIONS.some((option) => option.value === '訪問介護'));
    assert.ok(SERVICE_CATEGORY_OPTIONS.some((option) => option.value === '訪問型サービス（独自）'));
    assert.ok(SERVICE_CATEGORY_OPTIONS.some((option) => option.value === 'その他'));
    const serviceTypeCodes = SERVICE_CATEGORY_OPTIONS.flatMap((option) => option.codes ?? []);
    assert.equal(new Set(serviceTypeCodes).size, serviceTypeCodes.length);
    assert.equal(serviceCategoryForCodePrefix('41'), '特定福祉用具販売');
    assert.equal(serviceCategoryForCodePrefix('42'), '住宅改修');
    assert.equal(serviceCategoryForCodePrefix('13'), '訪問看護');
    assert.equal(serviceCategoryForCodePrefix('14'), '訪問リハビリテーション');
    assert.equal(serviceCategoryForCodePrefix('31'), '居宅療養管理指導');
    assert.equal(serviceCategoryForCodePrefix('2A'), '短期入所療養介護（介護医療院）');
    assert.equal(serviceCategoryForCodePrefix('A2'), '訪問型サービス（独自）');
    assert.equal(serviceCategoryForCodePrefix('A3'), '訪問型サービス（独自／定率）');
    assert.equal(serviceCategoryForCodePrefix('AG'), '訪問型短期集中予防サービス（定率）');
    assert.equal(serviceCategoryForCodePrefix('AF'), '介護予防ケアマネジメント');
    assert.equal(serviceCategoryForCodePrefix('68'), '小規模多機能型居宅介護（短期利用型）');
    assert.equal(serviceCategoryForCodePrefix('79'), '看護小規模多機能型居宅介護（短期利用型）');
  });

  it('PDFテキストのサービス名・略称・サービスコードから種類を取得し、複数種類なら推測しない', () => {
    assert.equal(extractServiceCategory('訪問リハビリテーション'), '訪問リハビリテーション');
    assert.equal(extractServiceCategory('サービス種類：訪問リハ'), '訪問リハビリテーション');
    assert.equal(extractServiceCategory('居宅療養管理指導'), '居宅療養管理指導');
    assert.equal(extractServiceCategory('サービスコード 13 3111'), '訪問看護');
    assert.equal(extractServiceCategory('サービスコード 14'), '訪問リハビリテーション');
    assert.equal(extractServiceCategory('サービスコード 31'), '居宅療養管理指導');
    assert.equal(extractServiceCategory('サービスコード 43'), '居宅介護支援');
    assert.equal(extractServiceCategory('サービスコード 46'), '介護予防支援');
    assert.equal(extractServiceCategory('サービスコード AF'), '介護予防ケアマネジメント');
    assert.equal(extractServiceCategory('サービスコード 431111'), '居宅介護支援');
    assert.equal(extractServiceCategory('サービスコード A2 1001'), '訪問型サービス（独自）');
    assert.equal(extractServiceCategory('サービスコード AG 1001'), '訪問型短期集中予防サービス（定率）');
    assert.equal(extractServiceCategory('サービスコード 68 1001'), '小規模多機能型居宅介護（短期利用型）');
    assert.equal(extractServiceCategory('サービスコード 41 1001'), '特定福祉用具販売');
    assert.equal(extractServiceCategory('訪問リハ サービスコード 13 3111'), '');
    assert.equal(extractServiceCategory('サービスコード 13 3111\nサービスコード 14 1001'), '');
    assert.equal(extractServiceCategory('サービスコード 13 3111\n事業所番号 1234567890'), '訪問看護');
    assert.equal(extractServiceCategory('訪問リハビリテーション 居宅療養管理指導'), '');
  });

  it('提供票の支援事業者見出しを除外し、サービス内容から種類を判定する', () => {
    const homeCareHeader = '居宅介護支援事業者→サービス事業者';
    const preventiveHeader = '介護予防支援事業者→サービス事業者';
    assert.equal(extractServiceCategory(`${homeCareHeader}\n訪問看護 131111`), '訪問看護');
    assert.equal(extractServiceCategory(`${homeCareHeader}\n居宅療養管理指導`), '居宅療養管理指導');
    assert.equal(extractServiceCategory(`${homeCareHeader}\n訪問リハビリテーション`), '訪問リハビリテーション');
    assert.equal(extractServiceCategory(`${preventiveHeader}\n訪問看護 131111`), '訪問看護');
    assert.equal(extractServiceCategory(`${preventiveHeader}\n居宅療養管理指導`), '居宅療養管理指導');
    assert.equal(extractServiceCategory(`${preventiveHeader}\n訪問リハビリテーション`), '訪問リハビリテーション');
    assert.equal(extractServiceCategory(homeCareHeader), '');
    assert.equal(extractServiceCategory(preventiveHeader), '');
    assert.equal(extractServiceCategory('居宅介護支援'), '');
    assert.equal(extractServiceCategory('介護予防支援'), '');
    assert.equal(extractServiceCategory('介護予防ケアマネジメント'), '');
    assert.equal(extractServiceCategory('訪問看護事業所'), '');
    assert.equal(extractServiceCategory('訪問看護事業者'), '');
  });

  it('サービス名のないカンマなし6桁金額をコードとして読まず、サービス名判定にも混ぜない', () => {
    assert.equal(extractServiceCategory('167650'), '');
    assert.equal(extractServiceCategory('サービス内容 167650'), '');
    assert.equal(extractServiceCategory('訪問リハビリテーション 167650'), '訪問リハビリテーション');
  });

  it('支援事業者見出しだけのページで、前後の提供票を別種類として分断しない', () => {
    const nextHeader = {
      serviceCategory: extractServiceCategory('居宅介護支援事業者→サービス事業者'),
      isSlipHeading: true,
      isAppendix: false,
    };
    const currentSlip = {
      serviceCategory: '訪問看護',
      isSlipHeading: true,
      isAppendix: false,
    };
    assert.equal(shouldStartNewSlip(currentSlip, nextHeader), false);
  });

  it('同じ利用者・番号でも明示されたサービス種類が変われば別グループにする', () => {
    const current = { clientName: '利用者A', providerNumber: '1234567890', providerName: '事業所', serviceCategory: '訪問リハビリテーション', isAppendix: false, isSlipHeading: true };
    const next = { ...current, serviceCategory: '居宅療養管理指導' };
    assert.equal(shouldStartNewSlip(current, next), true);
  });

  it('番号がある最初のページに続く3ページを一つにまとめ、同じ送り先へ振り分ける', () => {
    const pages = [
      { clientName: '利用者A', providerName: '事業所A', providerNumber: '9999900001', serviceCategory: '訪問リハビリテーション', serviceMonth: '令和8年10月', isSlipHeading: true, isAppendix: false, textFound: true },
      { clientName: '利用者A', providerName: '事業所A', serviceCategory: '居宅療養管理指導', serviceMonth: '令和8年10月', isSlipHeading: true, isAppendix: true, textFound: true },
      { clientName: '利用者A', providerName: '別の名称表記', serviceCategory: '通所介護', serviceMonth: '令和8年10月', isSlipHeading: true, isAppendix: true, textFound: true },
    ];
    const pageGroups = [];
    let currentFacts;
    pages.forEach((facts) => {
      if (shouldStartNewSlip(currentFacts, facts)) pageGroups.push([facts]);
      else pageGroups.at(-1).push(facts);
      currentFacts = currentFacts ? mergePageFacts(currentFacts, facts) : facts;
    });
    assert.equal(pageGroups.length, 1);
    assert.equal(pageGroups[0].length, 3);
    assert.equal(currentFacts.providerNumber, '9999900001');

    const group = baseGroup({ providerNumber: currentFacts.providerNumber, pages: [1, 2, 3] });
    refreshRoutingSafetyForGroups([group], [
      { id: 'master-a', providerNumber: '9999900001', providerName: '事業所A', serviceCategory: '訪問リハビリテーション', deliveryMethod: 'FAX' },
    ]);
    assert.equal(group.needsReview, false);
    assert.equal(group.deliveryMethod, 'FAX');
  });

  it('従来どおり2ページの提供票も一つにまとめる', () => {
    const first = { clientName: '利用者A', providerName: '事業所A', providerNumber: '9999900002', serviceCategory: '訪問看護', serviceMonth: '令和8年10月', isSlipHeading: true, isAppendix: false, textFound: true };
    const second = { clientName: '利用者A', providerName: '事業所A', serviceCategory: '訪問看護', serviceMonth: '令和8年10月', isSlipHeading: true, isAppendix: true, textFound: true };
    assert.equal(shouldStartNewSlip(first, second), false);
    assert.equal(mergePageFacts(first, second).providerNumber, '9999900002');
  });

  it('事業所マスタを選ぶと番号と送り先を反映し、要確認を解除して次回用ルールを保存する', () => {
    const group = baseGroup({
      providerNumber: '', providerName: 'PDFの候補名', serviceCategory: '', deliveryMethod: '',
      issues: ['10桁の事業所番号を判定できません', '送付方法が未設定です'], needsReview: true,
    });
    const master = { id: 'master-a', providerNumber: '9999900003', providerName: '架空の事業所', serviceCategory: '', deliveryMethod: 'FAX' };
    const routes = applyProviderMasterChoice(group, 'master-a', [master]);
    refreshRoutingSafetyForGroups([group], [master], routes);
    assert.equal(group.providerNumber, '9999900003');
    assert.equal(group.providerName, '架空の事業所');
    assert.equal(group.deliveryMethod, 'FAX');
    assert.equal(group.needsReview, false);
    assert.deepEqual(routes, [{ providerNumber: '9999900003', serviceCategory: '', deliveryMethod: 'FAX' }]);
  });

  it('要確認が残っていても強制出力でき、通常時は確認を省略しない', () => {
    const state = {
      hasResult: true, busy: false, queuedFileCount: 0, reviewCount: 1, blockedCount: 1,
      mixedMonths: false, assignedPageCount: 3, totalPageCount: 3, groupCount: 1,
    };
    assert.equal(canToggleForceDownload(true, false), true);
    assert.equal(canCreateOutputs({ ...state, forceDownload: false }), false);
    assert.equal(canCreateOutputs({ ...state, forceDownload: true }), true);
    assert.equal(canCreateOutputs({ ...state, forceDownload: true, mixedMonths: true }), false);
    assert.equal(canCreateOutputs({ ...state, forceDownload: true, assignedPageCount: 2 }), false);
  });
});
