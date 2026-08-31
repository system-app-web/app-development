export type PortalNotice = {
  id: string;
  title: string;
  body: string;
};

// 注意事項を追加したい場合は、この配列に1件追加します。
export const portalNotices: PortalNotice[] = [
  {
    id: 'local-storage',
    title: 'データ保存について',
    body: 'このアプリで入力した内容は、操作した端末のブラウザ内に保存されます。ほかの端末や利用者に自動で共有・表示されることはありません。',
  },
];
