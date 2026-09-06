export function Header() {
  return (
    <header className="site-header">
      <a className="portal-title" href="#apps" aria-label="アプリ一覧へ移動">
        <img className="portal-title-logo" src={`${import.meta.env.BASE_URL}riho-title.png`} alt="リーホ 介護業務効率化ポータルアプリ" />
      </a>
      <a className="brand" href="#apps" aria-label="アプリ一覧へ移動">
        <img className="brand-logo" src={`${import.meta.env.BASE_URL}ktm-logo.png`} alt="KTM Keep Trust Meaning ロゴ" />
      </a>
    </header>
  );
}
