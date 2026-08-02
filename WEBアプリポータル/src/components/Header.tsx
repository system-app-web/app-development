import { siteInfo } from '../data/appData';

const navItems = ['ホーム', 'アプリ', 'マニュアル', 'お知らせ', 'サポート'];

export function Header() {
  return (
    <header className="site-header">
      <a className="brand" href="#home" aria-label="ホームへ移動">
        <span className="brand-logo" aria-hidden="true">SC</span>
        <span>
          <span className="brand-name">{siteInfo.companyName}</span>
          <span className="brand-copy">{siteInfo.catchCopy}</span>
        </span>
      </a>

      <input className="nav-toggle" id="nav-toggle" type="checkbox" aria-label="メニューを開閉" />
      <label className="hamburger" htmlFor="nav-toggle" aria-hidden="true">
        <span />
        <span />
        <span />
      </label>

      <nav className="global-nav" aria-label="主要メニュー">
        {navItems.map((item) => (
          <a key={item} href={item === 'ホーム' ? '#home' : item === 'アプリ' ? '#apps' : '#footer'}>
            {item}
          </a>
        ))}
      </nav>
    </header>
  );
}
