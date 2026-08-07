const navItems = ['ホーム', 'アプリ', 'マニュアル', 'お知らせ', 'サポート'];

export function Header() {
  return (
    <header className="site-header">
      <a className="brand" href="#home" aria-label="ホームへ移動">
        <img className="brand-logo" src="/2207.jpg" alt="KTM Keep Trust Meaning ロゴ" />
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
