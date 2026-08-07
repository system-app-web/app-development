export type AppStatus = 'stable' | 'preview';

export type PortalApp = {
  id: string;
  name: string;
  url?: string;
  manualUrl?: string;
  icon: string;
  description: string;
  version: string;
  status: AppStatus;
};

export const appData: PortalApp[] = [
  {
    id: 'user-checklist',
    name: '利用者チェック表',
    url: 'https://riyosha-check-app.vercel.app',
    manualUrl: '',
    icon: 'check',
    description: '利用者状況を確認・記録',
    version: 'v1.2.0',
    status: 'stable',
  },
  {
    id: 'fax-address-book',
    name: 'FAXアドレス帳',
    url: 'https://fax-address-book.vercel.app',
    manualUrl: '',
    icon: 'fax',
    description: 'FAX送信先管理',
    version: 'v1.1.3',
    status: 'stable',
  },
  {
    id: 'template-notes',
    name: 'テンプレートメモ帳',
    url: 'https://template-memo-system-app-webs-projects.vercel.app',
    manualUrl: '',
    icon: 'memo',
    description: '文例管理',
    version: 'v0.8.0',
    status: 'preview',
  },
  {
    id: 'pdf-converter',
    name: 'PDF変換アプリ',
    url: 'https://riyosha-pdf-converter.vercel.app/',
    manualUrl: '',
    icon: 'pdf',
    description: '証書PDFの変換・結合',
    version: 'v1.0.0',
    status: 'stable',
  },
  {
    id: 'staff-shared-notes',
    name: 'スタッフ共有メモ',
    url: '',
    manualUrl: '',
    icon: 'people',
    description: 'スタッフ間メモ',
    version: 'v0.5.0',
    status: 'preview',
  },
  {
    id: 'shortcut-memo',
    name: 'ショートカットメモ',
    url: '',
    manualUrl: '',
    icon: 'shortcut',
    description: 'よく使うキーボード操作を管理',
    version: 'v1.0.0',
    status: 'stable',
  },
  {
    id: 'simple-floor-plan',
    name: 'かんたん見取り図',
    url: '',
    manualUrl: '',
    icon: 'floorplan',
    description: '施設・住居の見取り図を作成',
    version: 'v1.0.0',
    status: 'stable',
  },
  {
    id: 'simple-genogram',
    name: 'かんたんジェノグラム',
    url: '',
    manualUrl: '',
    icon: 'genogram',
    description: '家族関係を図で整理',
    version: 'v1.0.0',
    status: 'stable',
  },
  {
    id: 'assessment-sheet',
    name: 'アセスメントシート',
    url: '',
    manualUrl: '',
    icon: 'assessment',
    description: '利用者支援のアセスメントを整理',
    version: 'v0.1.0',
    status: 'preview',
  },
];

export const siteInfo = {
  companyName: '株式会社K.T.M',
  officeName: 'リーフケアプランニング',
  catchCopy: 'リーフケアプランニング 社内WEBアプリポータル',
  websiteUrl: 'https://leaf.ktm-care.com',
  version: 'v1.0.0',
  lastUpdated: '2026-08-07',
};
