export default function Home() {
  return (
    <main className="page-shell">
      <section className="assessment-card" aria-labelledby="page-title">
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
          <p>ASSESSMENT SHEET</p>
        </div>
        <div className="content">
          <p className="eyebrow">準備中</p>
          <h1 id="page-title">アセスメントシート</h1>
          <p className="lead">利用者様の状況や支援方針を、見やすく整理するためのシートです。</p>
          <div className="notice" role="status">
            <div className="notice-icon" aria-hidden="true">✓</div>
            <div><strong>これから内容を整えていきます</strong><p>必要な入力項目・印刷形式・共有方法を決めてから作成を始めます。</p></div>
          </div>
          <div className="future-list" aria-label="今後追加する予定の機能">
            <div><span className="list-number">01</span><span>基本情報の記入</span></div>
            <div><span className="list-number">02</span><span>支援ニーズの整理</span></div>
            <div><span className="list-number">03</span><span>印刷・PDF保存</span></div>
          </div>
        </div>
        <footer><span className="status-dot" aria-hidden="true" /><span>作成準備中</span></footer>
      </section>
    </main>
  );
}
