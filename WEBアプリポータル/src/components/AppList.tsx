import { memo } from 'react';
import { appData } from '../data/appData';
import { AppCard } from './AppCard';

const MemoizedAppCard = memo(AppCard);

export function AppList() {
  return (
    <section className="app-section" id="apps">
      <div className="section-heading">
        <h1>アプリ一覧</h1>
      </div>

      <div className="app-grid">
        {appData.filter((app) => app.url).map((app) => (
          <MemoizedAppCard key={app.id} app={app} />
        ))}
      </div>
    </section>
  );
}
