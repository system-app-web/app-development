export type AppStatus = 'stable' | 'preview';
export type AppAvailability = 'trial' | 'adjusting';

export type PortalApp = {
  id: string;
  name: string;
  url?: string;
  installUrl?: string;
  manualUrl?: string;
  icon: string;
  iconImage?: string;
  description: string;
  version: string;
  status: AppStatus;
  availability?: AppAvailability;
};

export const appData: PortalApp[] = [
  {
    id: 'simple-genogram',
    name: 'かんたんジェノグラム',
    url: 'https://easy-genogram-app.vercel.app',
    installUrl: 'https://easy-genogram-app.vercel.app/app.html?install=1',
    manualUrl: '',
    icon: 'genogram',
    iconImage: 'app-icons/genogram.png',
    description: '家族関係を図で整理',
    version: 'v1.0.0',
    status: 'stable',
  },
  {
    id: 'simple-floor-plan',
    name: 'シンプル見取り図',
    url: 'https://easy-floor-plan.vercel.app',
    installUrl: 'https://easy-floor-plan.vercel.app/app.html?install=1',
    manualUrl: '',
    icon: 'floorplan',
    iconImage: 'app-icons/floor-plan.png',
    description: '施設・住居の見取り図を作成',
    version: 'v1.0.0',
    status: 'preview',
    availability: 'trial',
  },
  {
    id: 'assessment-sheet',
    name: 'アセスメントシート',
    url: 'https://assessment-sheet-app.uragoshi.chatgpt.site/assessment.html',
    manualUrl: '',
    icon: 'assessment',
    iconImage: 'app-icons/assessment.svg',
    description: '利用者支援のアセスメントを整理（試作版）',
    version: 'v0.2.0',
    status: 'preview',
    availability: 'trial',
  },
  {
    id: 'pdf-converter',
    name: 'PDF変換アプリ',
    url: 'https://pdf-converter-app-six.vercel.app',
    installUrl: 'https://pdf-converter-app-six.vercel.app/app.html?install=1',
    manualUrl: '',
    icon: 'pdf',
    iconImage: 'app-icons/pdf-converter.png',
    description: '証書PDFの変換・結合',
    version: 'v1.0.0',
    status: 'stable',
  },
  {
    id: 'user-checklist',
    name: '利用者チェック表',
    url: 'https://riyosha-check-app.vercel.app',
    installUrl: 'https://riyosha-check-app.vercel.app/%E5%88%A9%E7%94%A8%E8%80%85%E3%83%81%E3%82%A7%E3%83%83%E3%82%AF%E8%A1%A8.html?install=1',
    manualUrl: '',
    icon: 'check',
    iconImage: 'app-icons/user-checklist.png',
    description: '利用者状況を確認・記録',
    version: 'v1.2.0',
    status: 'stable',
  },
  {
    id: 'fax-address-book',
    name: 'FAXアドレス帳',
    url: 'https://fax-address-book.vercel.app',
    installUrl: 'https://fax-address-book.vercel.app/app.html?install=1',
    manualUrl: '',
    icon: 'fax',
    iconImage: 'app-icons/fax-address-book.png',
    description: 'FAX送信先管理',
    version: 'v1.1.3',
    status: 'stable',
  },
  {
    id: 'template-notes',
    name: 'テンプレートメモ帳',
    url: 'https://template-memo.vercel.app',
    installUrl: 'https://template-memo.vercel.app/app.html?install=1',
    manualUrl: '',
    icon: 'memo',
    iconImage: 'app-icons/template-notes.png',
    description: '文例管理',
    version: 'v0.8.0',
    status: 'preview',
    availability: 'trial',
  },
  {
    id: 'shortcut-memo',
    name: 'ショートカットメモ',
    url: 'https://shortcut-list.vercel.app',
    installUrl: 'https://shortcut-list.vercel.app/?install=1',
    manualUrl: '',
    icon: 'shortcut',
    iconImage: 'app-icons/shortcut-memo.svg',
    description: 'よく使うキーボード操作を管理',
    version: 'v1.0.0',
    status: 'stable',
  },
  {
    id: 'service-slip-sorter',
    name: '提供票自動振り分け',
    url: 'https://service-slip-sorter.vercel.app',
    manualUrl: '',
    icon: 'pdf',
    description: '提供票PDFを事業所別に振り分け',
    version: 'v1.0.0',
    status: 'stable',
    availability: 'adjusting',
  },
];

export const siteInfo = {
  companyName: '株式会社K.T.M',
  officeName: 'リーフケアプランニング',
  catchCopy: 'リーフケアプランニング 社内WEBアプリポータル',
  websiteUrl: 'https://leaf.ktm-care.com',
  version: 'v1.0.0',
  lastUpdated: '2026-08-12',
};
