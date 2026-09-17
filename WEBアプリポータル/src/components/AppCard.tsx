import type { PortalApp } from '../data/appData';
import { createAppAccessUrl } from '../lib/portalAccess';

type AppCardProps = {
  app: PortalApp;
  isReordering?: boolean;
  isSelectedForSwap?: boolean;
  onSelectForSwap?: () => void;
};

export function AppCard({ app, isReordering = false, isSelectedForSwap = false, onSelectForSwap }: AppCardProps) {
  const isAdjusting = app.availability === 'adjusting';
  const isTrial = app.availability === 'trial';

  return (
    <article className={`app-card${isReordering ? ' is-reordering' : ''}${isSelectedForSwap ? ' is-selected-for-swap' : ''}`}>
      {isReordering ? (
        <button
          type="button"
          className="app-swap-button"
          onClick={onSelectForSwap}
          aria-pressed={isSelectedForSwap}
          aria-label={isSelectedForSwap ? `${app.name}を選択解除` : `${app.name}を入れ替える対象にする`}
          title={isSelectedForSwap ? '選択解除' : '入れ替える'}
        >
          {isSelectedForSwap ? '選択中' : '入替'}
        </button>
      ) : null}
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
    </article>
  );
}
