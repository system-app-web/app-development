import { portalNotices } from '../data/portalNotices';

export function PortalNotices() {
  return (
    <aside className="portal-notices" aria-label="ご利用上の注意">
      {portalNotices.map((notice) => (
        <section className="portal-notice" key={notice.id}>
          <span className="portal-notice-mark" aria-hidden="true">i</span>
          <div>
            <h2>{notice.title}</h2>
            <p>{notice.body}</p>
          </div>
        </section>
      ))}
    </aside>
  );
}
