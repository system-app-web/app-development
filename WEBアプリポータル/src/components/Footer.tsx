import { siteInfo } from '../data/appData';

export function Footer() {
  return (
    <footer className="site-footer" id="footer">
      <div>
        <strong>{siteInfo.companyName}</strong>
        <p>最終更新日 {siteInfo.lastUpdated} / サイトVersion {siteInfo.version}</p>
      </div>
      <nav aria-label="フッターメニュー">
        <a href="#footer">プライバシーポリシー</a>
        <a href="#footer">お問い合わせ</a>
      </nav>
      <p className="copyright">Copyright © {siteInfo.companyName}. All rights reserved.</p>
    </footer>
  );
}
