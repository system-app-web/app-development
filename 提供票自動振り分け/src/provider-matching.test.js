import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractServiceCategory, shouldStartNewSlip } from './analysis-rules.ts';
import {
  canAutoAssignServiceCategory,
  getProviderMasterWarningNumbers,
  hasIndependentGroupReview,
  matchProviderMaster,
  reconcileProviderMaster,
  refreshRoutingSafetyForGroups,
  SERVICE_MATCH_ISSUE,
} from './provider-matching.ts';
import { loadSavedData } from './storage.ts';
import { SERVICE_CATEGORY_GROUPS, SERVICE_CATEGORY_OPTIONS, serviceCategoryForCodePrefix } from './service-categories.ts';

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

describe('サービス種類を使った事業所マスタ照合', () => {
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
    assert.equal(extractServiceCategory('サービスコード A2 1001'), '訪問型サービス（独自）');
    assert.equal(extractServiceCategory('サービスコード AG 1001'), '訪問型短期集中予防サービス（定率）');
    assert.equal(extractServiceCategory('サービスコード 68 1001'), '小規模多機能型居宅介護（短期利用型）');
    assert.equal(extractServiceCategory('サービスコード 41 1001'), '特定福祉用具販売');
    assert.equal(extractServiceCategory('訪問リハ サービスコード 13 3111'), '');
    assert.equal(extractServiceCategory('サービスコード 13 3111\nサービスコード 14 1001'), '');
    assert.equal(extractServiceCategory('サービスコード 13 3111\n事業所番号 1234567890'), '訪問看護');
    assert.equal(extractServiceCategory('訪問リハビリテーション 居宅療養管理指導'), '');
  });

  it('同じ利用者・番号でも明示されたサービス種類が変われば別グループにする', () => {
    const current = { clientName: '利用者A', providerNumber: '1234567890', providerName: '事業所', serviceCategory: '訪問リハビリテーション', isAppendix: false, isSlipHeading: true };
    const next = { ...current, serviceCategory: '居宅療養管理指導' };
    assert.equal(shouldStartNewSlip(current, next), true);
  });
});
