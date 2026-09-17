import type { PortalApp } from '../data/appData';
import { createAppAccessUrl } from '../lib/portalAccess';

type AppCardProps = {
  app: PortalApp;
  isReordering?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
};

export function AppCard({ app, isReordering = false, onMoveUp, onMoveDown, canMoveUp = false, canMoveDown = false }: AppCardProps) {
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

      {isAdjusting && !app.adjustmentLinkAvailable ? (
        <button className="button disabled" type="button" aria-label={`${app.name}は調整中`} disabled>
          調整中
        </button>
      ) : (
        <div className="app-card-actions">
          <a className={`button ${isAdjusting ? 'disabled adjustment-link' : 'primary'}`} href={createAppAccessUrl(app.url)} aria-label={`${app.name}を開く${isAdjusting ? '（調整中）' : ''}`}>
            {isAdjusting ? '調整中' : 'このアプリを開く'}
          </a>
          {app.installUrl ? (
            <a className="button install" href={app.installUrl} target="_blank" rel="noopener noreferrer" aria-label={`${app.name}をアプリとしてインストールする`}>
              アプリとしてインストール
            </a>
          ) : null}
        </div>
      )}

      {isReordering ? (
        <div className="app-order-controls" aria-label={`${app.name}の表示順`}>
          <button type="button" className="app-order-button" onClick={onMoveUp} disabled={!canMoveUp} aria-label={`${app.name}を前へ移動`} title="前へ移動">
            ↑
          </button>
          <button type="button" className="app-order-button" onClick={onMoveDown} disabled={!canMoveDown} aria-label={`${app.name}を後へ移動`} title="後へ移動">
            ↓
          </button>
        </div>
      ) : null}
    </article>
  );
}
