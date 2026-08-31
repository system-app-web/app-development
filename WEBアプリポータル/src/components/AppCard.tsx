import type { PortalApp } from '../data/appData';

type AppCardProps = {
  app: PortalApp;
};

export function AppCard({ app }: AppCardProps) {
  const isAdjusting = app.availability === 'adjusting';
  const isTrial = app.availability === 'trial';

  return (
    <article className="app-card">
      <div className="app-card-top">
        {app.iconImage ? (
          <img className="app-icon-image" src={`${import.meta.env.BASE_URL}${app.iconImage}`} alt={`${app.name}のアイコン`} loading="lazy" />
        ) : (
          <div className={`app-icon ${app.icon}`} aria-hidden="true">
            <span className="icon-mark" />
          </div>
        )}
        <h3>{app.name}</h3>
      </div>

      <p className="app-description">{app.description}</p>
      {isTrial ? <p className="app-availability trial">試作公開中</p> : null}

      {isAdjusting ? (
        <button className="button disabled" type="button" aria-label={`${app.name}は調整中`} disabled>
          調整中
        </button>
      ) : (
        <a className="button primary" href={app.url} target="_blank" rel="noopener noreferrer" aria-label={`${app.name}を新しいタブで開く`}>
          このアプリを開く
        </a>
      )}
    </article>
  );
}
