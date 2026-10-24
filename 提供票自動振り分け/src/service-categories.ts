/**
 * 提供票で使うサービス種類と、サービス種類コード。
 * 現行コードはWAM NET掲載の令和9年4月サービス分の一覧を基準にし、
 * 令和6年3月まで使われていた介護療養施設サービス（53）も旧帳票用に残します。
 * 総合事業のA系コードは種類コードまで国が定め、個別の単位数コード等は自治体が定めます。
 */
export type ServiceCategoryOption = {
  value: string;
  codes?: readonly string[];
  aliases?: readonly string[];
};

export type ServiceCategoryGroup = {
  label: string;
  options: readonly ServiceCategoryOption[];
};

export const SERVICE_CATEGORY_GROUPS: readonly ServiceCategoryGroup[] = [
  {
    label: '居宅サービス',
    options: [
      { value: '訪問介護', codes: ['11'], aliases: ['訪介'] },
      { value: '訪問入浴介護', codes: ['12'], aliases: ['訪問入浴'] },
      { value: '訪問看護', codes: ['13'], aliases: ['訪看'] },
      { value: '訪問リハビリテーション', codes: ['14'], aliases: ['訪問リハビリ', '訪問リハ', '訪リハ'] },
      { value: '居宅療養管理指導', codes: ['31'], aliases: ['居宅療養管理', '居宅療養'] },
      { value: '通所介護', codes: ['15'], aliases: ['デイサービス'] },
      { value: '通所リハビリテーション', codes: ['16'], aliases: ['通所リハ', 'デイケア'] },
      { value: '短期入所生活介護', codes: ['21'], aliases: ['短期入所生活'] },
      { value: '短期入所療養介護（介護老人保健施設）', codes: ['22'], aliases: ['短期入所療養（老健）'] },
      { value: '短期入所療養介護（病院等）', codes: ['23'], aliases: ['短期入所療養（病院）'] },
      { value: '短期入所療養介護（介護医療院）', codes: ['2A'], aliases: ['短期入所療養（介護医療院）'] },
      { value: '特定施設入居者生活介護', codes: ['33'], aliases: ['特定施設'] },
      { value: '特定施設入居者生活介護（短期利用型）', codes: ['27'], aliases: ['特定施設（短期利用）'] },
      { value: '福祉用具貸与', codes: ['17'], aliases: ['福祉用具レンタル'] },
      { value: '特定福祉用具販売', codes: ['41'], aliases: ['福祉用具販売'] },
      { value: '住宅改修', codes: ['42'] },
    ],
  },
  {
    label: '居宅介護支援',
    options: [
      { value: '居宅介護支援', codes: ['43'] },
    ],
  },
  {
    label: '地域密着型サービス',
    options: [
      { value: '定期巡回・随時対応型訪問介護看護', codes: ['76'], aliases: ['定期巡回訪問介護看護', '定期巡回・随時対応'] },
      { value: '夜間対応型訪問介護', codes: ['71'], aliases: ['夜間対応型'] },
      { value: '地域密着型通所介護', codes: ['78'], aliases: ['地域密着型デイサービス'] },
      { value: '認知症対応型通所介護', codes: ['72'], aliases: ['認知症デイサービス'] },
      { value: '小規模多機能型居宅介護', codes: ['73'], aliases: ['小規模多機能'] },
      { value: '小規模多機能型居宅介護（短期利用型）', codes: ['68'], aliases: ['小規模多機能（短期利用）'] },
      { value: '認知症対応型共同生活介護', codes: ['32'], aliases: ['認知症グループホーム'] },
      { value: '認知症対応型共同生活介護（短期利用型）', codes: ['38'], aliases: ['認知症グループホーム（短期利用）'] },
      { value: '地域密着型特定施設入居者生活介護', codes: ['36'], aliases: ['地域密着型特定施設'] },
      { value: '地域密着型特定施設入居者生活介護（短期利用型）', codes: ['28'], aliases: ['地域密着型特定施設（短期利用）'] },
      { value: '地域密着型介護老人福祉施設入所者生活介護', codes: ['54'], aliases: ['地域密着型介護老人福祉施設', '地域密着型介護福祉施設入所者生活介護'] },
      { value: '看護小規模多機能型居宅介護', codes: ['77'], aliases: ['複合型サービス（看護小規模多機能型居宅介護）', '看護小規模多機能', '看多機'] },
      { value: '看護小規模多機能型居宅介護（短期利用型）', codes: ['79'], aliases: ['複合型サービス（短期利用型）', '看護小規模多機能（短期利用）'] },
    ],
  },
  {
    label: '介護予防サービス',
    options: [
      { value: '介護予防訪問入浴介護', codes: ['62'], aliases: ['予防訪問入浴'] },
      { value: '介護予防訪問看護', codes: ['63'], aliases: ['予防訪問看護'] },
      { value: '介護予防訪問リハビリテーション', codes: ['64'], aliases: ['介護予防訪問リハ', '予防訪問リハ'] },
      { value: '介護予防居宅療養管理指導', codes: ['34'], aliases: ['予防居宅療養管理指導'] },
      { value: '介護予防通所リハビリテーション', codes: ['66'], aliases: ['介護予防通所リハ', '予防通所リハ'] },
      { value: '介護予防短期入所生活介護', codes: ['24'], aliases: ['予防短期入所生活'] },
      { value: '介護予防短期入所療養介護（介護老人保健施設）', codes: ['25'], aliases: ['予防短期入所療養（老健）'] },
      { value: '介護予防短期入所療養介護（病院等）', codes: ['26'], aliases: ['予防短期入所療養（病院）'] },
      { value: '介護予防短期入所療養介護（介護医療院）', codes: ['2B'], aliases: ['予防短期入所療養（介護医療院）'] },
      { value: '介護予防特定施設入居者生活介護', codes: ['35'], aliases: ['予防特定施設'] },
      { value: '介護予防福祉用具貸与', codes: ['67'], aliases: ['予防福祉用具貸与'] },
      { value: '特定介護予防福祉用具販売', codes: ['44'], aliases: ['介護予防福祉用具販売'] },
      { value: '介護予防住宅改修', codes: ['45'] },
      { value: '介護予防支援', codes: ['46'] },
    ],
  },
  {
    label: '地域密着型介護予防サービス',
    options: [
      { value: '介護予防認知症対応型通所介護', codes: ['74'], aliases: ['予防認知症対応型通所介護'] },
      { value: '介護予防小規模多機能型居宅介護', codes: ['75'], aliases: ['予防小規模多機能'] },
      { value: '介護予防小規模多機能型居宅介護（短期利用型）', codes: ['69'], aliases: ['予防小規模多機能（短期利用）'] },
      { value: '介護予防認知症対応型共同生活介護', codes: ['37'], aliases: ['予防認知症グループホーム'] },
      { value: '介護予防認知症対応型共同生活介護（短期利用型）', codes: ['39'], aliases: ['予防認知症グループホーム（短期利用）'] },
    ],
  },
  {
    label: '施設サービス',
    options: [
      { value: '介護福祉施設サービス', codes: ['51'] },
      { value: '介護保健施設サービス', codes: ['52'] },
      { value: '介護医療院サービス', codes: ['55'] },
      { value: '介護療養施設サービス（旧区分）', codes: ['53'] },
    ],
  },
  {
    label: '総合事業',
    options: [
      { value: '訪問型サービス（独自）', codes: ['A2'], aliases: ['介護予防訪問介護'] },
      { value: '訪問型サービス（独自／定率）', codes: ['A3'] },
      { value: '訪問型サービス（独自／定額）', codes: ['A4'] },
      { value: '訪問型短期集中予防サービス（定率）', codes: ['AG'] },
      { value: '訪問型短期集中予防サービス（定額）', codes: ['AH'] },
      { value: '通所型サービス（独自）', codes: ['A6'], aliases: ['介護予防通所介護'] },
      { value: '通所型サービス（独自／定率）', codes: ['A7'] },
      { value: '通所型サービス（独自／定額）', codes: ['A8'] },
      { value: '通所型短期集中予防サービス（定率）', codes: ['AJ'] },
      { value: '通所型短期集中予防サービス（定額）', codes: ['AK'] },
      { value: 'その他生活支援サービス（配食／定率）', codes: ['A9'], aliases: ['配食サービス（総合事業）'] },
      { value: 'その他生活支援サービス（配食／定額）', codes: ['AA'] },
      { value: 'その他生活支援サービス（見守り／定率）', codes: ['AB'], aliases: ['見守りサービス（総合事業）'] },
      { value: 'その他生活支援サービス（見守り／定額）', codes: ['AC'] },
      { value: 'その他生活支援サービス（その他／定率）', codes: ['AD'], aliases: ['その他生活支援サービス（総合事業）'] },
      { value: 'その他生活支援サービス（その他／定額）', codes: ['AE'] },
      { value: '介護予防ケアマネジメント', codes: ['AF'], aliases: ['予防ケアマネジメント'] },
      { value: '一般介護予防事業', aliases: ['一般介護予防'] },
    ],
  },
  {
    label: '共通給付',
    options: [
      { value: '特定入所者介護サービス等', codes: ['59'] },
      { value: '市町村特別給付', codes: ['81'] },
    ],
  },
  {
    label: 'その他',
    options: [
      { value: 'その他' },
    ],
  },
];

export const SERVICE_CATEGORY_OPTIONS = SERVICE_CATEGORY_GROUPS.flatMap((group) => group.options);

const normalizeLabel = (value: string) => value.normalize('NFKC').replace(/[\s　]+/gu, '').trim();
const categoryByCode = new Map(SERVICE_CATEGORY_OPTIONS.flatMap((option) => (option.codes ?? []).map((code) => [code, option.value] as const)));
const categoriesByLabel = new Map<string, Set<string>>();
SERVICE_CATEGORY_OPTIONS.forEach((option) => {
  [option.value, ...(option.aliases ?? [])].forEach((alias) => {
    const key = normalizeLabel(alias);
    categoriesByLabel.set(key, new Set([...(categoriesByLabel.get(key) ?? []), option.value]));
  });
});

export function normalizeServiceCategoryValue(value?: string | null) {
  const normalized = normalizeLabel(value ?? '');
  if (!normalized) return '';
  const matches = categoriesByLabel.get(normalized);
  return matches?.size === 1 ? [...matches][0] : normalized;
}

export function serviceCategoryForCodePrefix(value: string) {
  return categoryByCode.get(value.normalize('NFKC').toUpperCase());
}
