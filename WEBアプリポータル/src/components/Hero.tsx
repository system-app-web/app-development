export function Hero() {
  return (
    <section className="hero" id="home">
      <div className="hero-content">
        <p className="eyebrow">WEBアプリケーション</p>
        <h1>オンラインで、<br />もっとつながるケアへ。</h1>
        <p className="hero-lead">ダウンロード不要で、ブラウザからすぐ利用できます。</p>

        <ul className="feature-list" aria-label="ポータルの特徴">
          <li>ダウンロード不要</li>
          <li>データは各端末へ保存</li>
          <li>常に最新版を利用可能</li>
        </ul>

        <div className="how-to-card" aria-label="使い方">
          <h2>使い方はとても簡単！</h2>
          <ol>
            <li>アプリをクリック</li>
            <li>WEBサイトが開く</li>
            <li>ホーム画面へ追加</li>
            <li>アプリのように利用できます</li>
          </ol>
        </div>
      </div>

      <div className="device-preview" aria-label="PC、iPad、スマホでWEBアプリを表示しているイメージ">
        <div className="device desktop">
          <div className="device-bar" />
          <div className="device-screen">
            <span>WEB App Portal</span>
            <div className="screen-grid">
              <i />
              <i />
              <i />
              <i />
            </div>
          </div>
        </div>
        <div className="device tablet">
          <div className="device-screen">
            <span>Care App</span>
            <div className="screen-lines">
              <i />
              <i />
              <i />
            </div>
          </div>
        </div>
        <div className="device phone">
          <div className="device-screen">
            <span>Mobile</span>
            <div className="screen-lines compact">
              <i />
              <i />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
