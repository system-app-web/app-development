import type { PortalApp } from '../data/appData';

type AppCardProps = {
  app: PortalApp;
};

export function AppCard({ app }: AppCardProps) {
  if (!app.url) {
    return null;
  }

  return (
    <article className="app-card">
      <div className="app-card-top">
        {app.iconImage ? (
          <img className="app-icon-image" src={app.iconImage} alt={`${app.name}のアイコン`} loading="lazy" />
        ) : (
          <div className={`app-icon ${app.icon}`} aria-hidden="true">
            <span className="icon-mark" />
          </div>
        )}
        <h3>{app.name}</h3>
      </div>

      <p className="app-description">{app.description}</p>

      <a className="button primary" href={app.url} target="_blank" rel="noopener noreferrer" aria-label={`${app.name}を新しいタブで開く`}>
        このアプリを開く
      </a>
    </article>
  );
}
