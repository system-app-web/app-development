import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractServiceCategory, shouldStartNewSlip } from './analysis-rules.ts';
import {
  matchProviderMaster,
  reconcileProviderMaster,
  refreshRoutingSafetyForGroups,
  SERVICE_MATCH_ISSUE,
} from './provider-matching.ts';
import { loadSavedData } from './storage.ts';

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

  it('重複した旧行で送付方法が一種類なら、その設定を残して一行にする', () => {
    const rows = [
      { id: 'a', providerNumber: '1234567890', providerName: '正式名', deliveryMethod: 'FAX' },
      { id: 'b', providerNumber: '1234567890', providerName: '短い略称', deliveryMethod: 'FAX' },
    ];
    const normalized = reconcileProviderMaster(rows);
    assert.equal(normalized.entries.length, 1);
    assert.equal(normalized.entries[0].deliveryMethod, 'FAX');
    assert.equal(normalized.entries[0].serviceCategory, undefined);
  });

  it('PDFテキストにサービス種類があれば取得し、複数種類なら推測しない', () => {
    assert.equal(extractServiceCategory('訪問リハビリテーション'), '訪問リハビリテーション');
    assert.equal(extractServiceCategory('居宅療養管理指導'), '居宅療養管理指導');
    assert.equal(extractServiceCategory('訪問リハビリテーション 居宅療養管理指導'), '');
  });

  it('同じ利用者・番号でも明示されたサービス種類が変われば別グループにする', () => {
    const current = { clientName: '利用者A', providerNumber: '1234567890', providerName: '事業所', serviceCategory: '訪問リハビリテーション', isAppendix: false, isSlipHeading: true };
    const next = { ...current, serviceCategory: '居宅療養管理指導' };
    assert.equal(shouldStartNewSlip(current, next), true);
  });
});
