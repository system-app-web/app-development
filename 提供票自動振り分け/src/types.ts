export type PageRef = { sourceId: string; sourceName: string; pageIndex: number; serial: number };

export type SlipGroup = {
  id: string;
  clientName: string;
  providerName: string;
  /** PDFに記載された10桁の事業所番号。名称ではなく、これを主キーにします。 */
  providerNumber: string;
  /** 帳票から分かる場合だけ設定。居宅療養は送付方法より優先して分けます。 */
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

export type DeliveryMethod = 'LINE' | 'FAX' | 'メール' | '手渡し' | '';

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
