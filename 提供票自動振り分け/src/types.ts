export type PageRef = { sourceId: string; sourceName: string; pageIndex: number; serial: number };

export type SlipGroup = {
  id: string;
  clientName: string;
  providerName: string;
  /** PDFに記載された10桁の事業所番号。名称ではなく、これを主キーにします。 */
  providerNumber: string;
  /** 帳票から分かる場合だけ設定するサービス区分。送付先フォルダの判定には使いません。 */
  serviceCategory: '居宅療養' | '';
  /** Gemini補助判定へ送る場合だけ使う、事業所関連行のローカル断片。保存はしない。 */
  geminiExcerpt: string;
  geminiUsed: boolean;
  serviceMonth: string;
  pages: PageRef[];
  needsReview: boolean;
  reviewed: boolean;
  issues: string[];
};

export type DeliveryMethod = string;

export type DeliveryMethodOption = {
  /** 保存済み事業所マスタから参照する固定値。表示名変更では変えません。 */
  value: string;
  name: string;
  folderName: string;
};

export const DEFAULT_DELIVERY_METHODS: DeliveryMethodOption[] = [
  { value: 'LINE', name: 'LINE', folderName: 'LINE' },
  { value: 'FAX', name: 'FAX', folderName: 'FAX' },
  { value: 'メール', name: 'メール', folderName: 'メール' },
  { value: '手渡し', name: '手渡し', folderName: '手渡し' },
  { value: '居宅療養', name: '居宅療養', folderName: '居宅療養' },
  { value: 'その他', name: 'その他', folderName: 'その他' },
];

export type ProviderMasterEntry = {
  providerNumber: string;
  providerName: string;
  deliveryMethod: DeliveryMethod;
  updatedAt: string;
};

/** 個人名やPDF本体は保存しない。マスタと利用者が入力した設定だけを日次バックアップする。 */
export type AppSavedData = {
  version: 1;
  providerMaster: ProviderMasterEntry[];
  geminiEnabled: boolean;
  deliveryMethods?: DeliveryMethodOption[];
};

export type SourcePdf = {
  id: string;
  name: string;
  bytes: ArrayBuffer;
  pageCount: number;
  hash: string;
};

export type AnalysisResult = {
  groups: SlipGroup[];
  sources: SourcePdf[];
  totalPages: number;
  duplicateFiles: string[];
  uniqueMonths: string[];
};
