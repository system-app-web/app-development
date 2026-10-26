export type PageRef = { sourceId: string; sourceName: string; pageIndex: number; serial: number };

export type SlipGroup = {
  id: string;
  clientName: string;
  providerName: string;
  /** PDFに記載された10桁の事業所番号。同じ番号でも事業所名が違えば別の事業所として扱います。 */
  providerNumber: string;
  /** 帳票から分かるサービス種類。番号が重複した事業所の照合に使います。 */
  serviceCategory: string;
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
  { value: 'PDF結合', name: 'PDF結合', folderName: 'PDF結合' },
  { value: 'その他', name: 'その他', folderName: 'その他' },
];

export type ProviderMasterEntry = {
  /** マスタ行を番号の重複があっても個別に編集・削除するためのID。 */
  id?: string;
  providerNumber: string;
  /** PDFから判定したサービス種類。古い保存データでは未設定です。 */
  serviceCategory?: string;
  providerName: string;
  deliveryMethod: DeliveryMethod;
  updatedAt: string;
  /** 同一番号・サービス種類の重複行で送付方法を決められない場合に表示します。 */
  needsServiceReview?: boolean;
};

/** 利用者が要確認画面で決めた、番号＋サービス種類ごとの送付先。 */
export type ProviderServiceRoute = {
  providerNumber: string;
  serviceCategory: string;
  deliveryMethod: DeliveryMethod;
};

/** 個人名やPDF本体は保存しない。マスタと利用者が入力した設定だけを日次バックアップする。 */
export type AppSavedData = {
  version: 1;
  providerMaster: ProviderMasterEntry[];
  /** 未設定を先頭へ移す初回整理を完了したか。以降は配列順を維持します。 */
  providerMasterOrderInitialized?: boolean;
  geminiEnabled: boolean;
  deliveryMethods?: DeliveryMethodOption[];
  /** 旧保存データでは未定義。既存マスタを変更せず、曖昧な振り分けだけを補う。 */
  providerServiceRoutes?: ProviderServiceRoute[];
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
