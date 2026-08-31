export function Header() {
  return (
    <header className="site-header">
      <a className="brand" href="#apps" aria-label="アプリ一覧へ移動">
        <img className="brand-logo" src={`${import.meta.env.BASE_URL}2207.jpg`} alt="KTM Keep Trust Meaning ロゴ" />
      </a>
    </header>
  );
}
