import { siteInfo } from '../data/appData';

export function Footer() {
  return (
    <footer className="site-footer" id="footer">
      <div>
        <strong>{siteInfo.companyName}</strong>
        <p>{siteInfo.officeName}</p>
        <p>最終更新日 {siteInfo.lastUpdated} / サイトVersion {siteInfo.version}</p>
      </div>
      <nav aria-label="フッターメニュー">
        <a href={siteInfo.websiteUrl} target="_blank" rel="noopener noreferrer">会社概要</a>
        <a href="#footer">プライバシーポリシー</a>
        <a href={siteInfo.websiteUrl} target="_blank" rel="noopener noreferrer">お問い合わせ</a>
      </nav>
      <p className="copyright">Copyright © {siteInfo.companyName}. All rights reserved.</p>
    </footer>
  );
}
