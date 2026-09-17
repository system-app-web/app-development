import { memo, useEffect, useState } from 'react';
import { appData, type PortalApp } from '../data/appData';
import { AppCard } from './AppCard';
import { getStoredSession } from '../lib/portalAccess';

const MemoizedAppCard = memo(AppCard);
const APP_ORDER_KEY_PREFIX = 'ktm-portal:app-order:';

function getAppOrder(employeeName: string) {
  if (!employeeName) return appData;

  try {
    const savedOrder = JSON.parse(localStorage.getItem(`${APP_ORDER_KEY_PREFIX}${employeeName}`) || '[]') as unknown;
    if (!Array.isArray(savedOrder)) return appData;

    const appsById = new Map(appData.map((app) => [app.id, app]));
    const seenIds = new Set<string>();
    const orderedApps = savedOrder
      .filter((id): id is string => typeof id === 'string' && appsById.has(id) && !seenIds.has(id) && (seenIds.add(id), true))
      .map((id) => appsById.get(id) as PortalApp);
    const remainingApps = appData.filter((app) => !orderedApps.some((orderedApp) => orderedApp.id === app.id));
    return [...orderedApps, ...remainingApps];
  } catch {
    return appData;
  }
}

function saveAppOrder(employeeName: string, apps: PortalApp[]) {
  if (!employeeName) return;
  localStorage.setItem(`${APP_ORDER_KEY_PREFIX}${employeeName}`, JSON.stringify(apps.map((app) => app.id)));
}

export function AppList() {
  const employeeName = getStoredSession()?.employeeName || '';
  const [apps, setApps] = useState(() => getAppOrder(employeeName));
  const [isReordering, setIsReordering] = useState(false);

  useEffect(() => {
    setApps(getAppOrder(employeeName));
  }, [employeeName]);

  function moveApp(index: number, direction: -1 | 1) {
    const destinationIndex = index + direction;
    if (destinationIndex < 0 || destinationIndex >= apps.length) return;

    const nextApps = [...apps];
    [nextApps[index], nextApps[destinationIndex]] = [nextApps[destinationIndex], nextApps[index]];
    setApps(nextApps);
    saveAppOrder(employeeName, nextApps);
  }

  function resetOrder() {
    setApps(appData);
    saveAppOrder(employeeName, appData);
  }

  return (
    <section className="app-section" id="apps">
      <div className="section-heading">
        <h1>アプリ一覧</h1>
        <div className="section-heading-actions">
          {isReordering ? (
            <>
              <button className="order-reset-button" type="button" onClick={resetOrder}>元に戻す</button>
              <button className="order-finish-button" type="button" onClick={() => setIsReordering(false)}>完了</button>
            </>
          ) : (
            <button className="order-edit-button" type="button" onClick={() => setIsReordering(true)}>並べ替え</button>
          )}
        </div>
      </div>

      <div className="app-grid">
        {apps.map((app, index) => (
          <MemoizedAppCard
            key={app.id}
            app={app}
            isReordering={isReordering}
            canMoveUp={index > 0}
            canMoveDown={index < apps.length - 1}
            onMoveUp={() => moveApp(index, -1)}
            onMoveDown={() => moveApp(index, 1)}
          />
        ))}
      </div>
    </section>
  );
}
