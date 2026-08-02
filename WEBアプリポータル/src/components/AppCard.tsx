import type { PortalApp } from '../data/appData';

type AppCardProps = {
  app: PortalApp;
};

const iconLabels: Record<string, string> = {
  check: '✓',
  fax: 'FAX',
  memo: '文',
  people: '共',
};

export function AppCard({ app }: AppCardProps) {
  const appReady = Boolean(app.url);
  const manualReady = Boolean(app.manualUrl);

  return (
    <article className="app-card">
      <div className="app-card-top">
        <div className={`app-icon ${app.icon}`} aria-hidden="true">
          {iconLabels[app.icon] ?? 'APP'}
        </div>
        <div>
          <h3>{app.name}</h3>
          <p className="version-line">
            <span>{app.version}</span>
            {app.status === 'preview' ? <strong>preview</strong> : <span className="stable">正式版</span>}
          </p>
        </div>
      </div>

      <div className="card-preview" aria-label={`${app.name}のプレビュー`}>
        <span>{app.status === 'preview' ? 'preview' : '正式版'}</span>
      </div>

      <p className="app-description">{app.description}</p>

      <div className="card-actions">
        {appReady ? (
          <a className="button primary" href={app.url} target="_blank" rel="noopener noreferrer" aria-label={`${app.name}を新しいタブで開く`}>
            このアプリを開く
          </a>
        ) : (
          <button className="button primary disabled" type="button" aria-label={`${app.name}は準備中`} disabled>
            準備中
          </button>
        )}

        {manualReady ? (
          <a className="button secondary" href={app.manualUrl} target="_blank" rel="noopener noreferrer" aria-label={`${app.name}のマニュアルを新しいタブで開く`}>
            マニュアルを見る
          </a>
        ) : (
          <button className="button secondary disabled" type="button" aria-label={`${app.name}のマニュアルは準備中`} disabled>
            準備中
          </button>
        )}
      </div>
    </article>
  );
}
