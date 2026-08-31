type AccessGateProps = {
  onAccess: () => void;
};

export function AccessGate({ onAccess }: AccessGateProps) {
  return (
    <main className="access-gate">
      <header className="access-gate-header">
        <a className="access-gate-brand" href="/" aria-label="KTM CARE APPLICATIONS">
          <span className="access-gate-mark">KTM</span>
          <span>KTM CARE APPLICATIONS</span>
        </a>
        <span className="access-gate-session">SECURE SESSION REQUIRED</span>
      </header>

      <div className="access-gate-layout">
        <section className="access-gate-notice" aria-labelledby="access-gate-title">
          <p className="access-gate-eyebrow">
            <span aria-hidden="true" />
            AUTHORIZED PERSONNEL ONLY
          </p>
          <h1 id="access-gate-title">RESTRICTED<br />SYSTEM ACCESS</h1>
          <div className="access-gate-divider" />
          <p className="access-gate-intro">
            This internal application portal is protected under administrator control. Access attempts may be monitored and verified against registered security information.
          </p>
          <ul className="access-gate-list">
            <li>ACCESS LOGGING ENABLED</li>
            <li>SECURITY CREDENTIAL CHECK</li>
            <li>ADMINISTRATOR CONTROLLED</li>
            <li>UNAUTHORIZED USE PROHIBITED</li>
          </ul>
        </section>

        <section className="access-gate-panel" aria-label="Access verification">
          <p>KTM INTERNAL PORTAL</p>
          <h2>VERIFY ACCESS</h2>
          <label htmlFor="administrator-id">ADMINISTRATOR ID</label>
          <input id="administrator-id" type="text" placeholder="Enter your ID" autoComplete="username" />
          <label htmlFor="security-key">SECURITY KEY</label>
          <input id="security-key" type="password" placeholder="Enter your password" autoComplete="current-password" />
          <label htmlFor="one-time-password">
            ONE-TIME PASSWORD <span>(optional)</span>
          </label>
          <input id="one-time-password" type="text" placeholder="Enter code" inputMode="numeric" />
          <button className="access-gate-verify" type="button" onClick={onAccess}>
            VERIFY ACCESS
          </button>
          <button className="access-gate-install" type="button" onClick={onAccess}>
            INSTALL APPLICATIONS
          </button>
          <p className="access-gate-panel-foot">By proceeding, you confirm that you are an authorized user.</p>
        </section>
      </div>

      <footer className="access-gate-footer">
        <span>ACCESS CONTROL ACTIVE</span>
        <span>KTM CARE · INTERNAL USE ONLY</span>
      </footer>
    </main>
  );
}
