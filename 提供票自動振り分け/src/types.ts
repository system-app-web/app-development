export type PageRef = { sourceId: string; sourceName: string; pageIndex: number; serial: number };

export type SlipGroup = {
  id: string;
  clientName: string;
  providerName: string;
  serviceMonth: string;
  pages: PageRef[];
  needsReview: boolean;
  reviewed: boolean;
  issues: string[];
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
