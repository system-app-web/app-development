(function () {
  'use strict';

  const PORTAL_URL = 'https://app-development-gray.vercel.app/';
  const AUTH_SERVICE_URL = 'https://script.google.com/macros/s/AKfycbyBLa2UzLgaxu7wb6GKqIJ_uiEbet4fW1QjCGGh83_Yb1JdJrq0ygF2ai6O5oJencw-/exec';
  const DEVICE_ID_KEY = 'ktm-portal:device-id';
  const SESSION_KEY = 'ktm-portal:device-session';

  document.documentElement.classList.add('ktm-auth-checking');
  const style = document.createElement('style');
  style.textContent = '.ktm-auth-checking body{visibility:hidden!important}';
  document.head.appendChild(style);

  function getDeviceId() {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, created);
    return created;
  }

  function getSession() {
    try {
      const session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      return session && typeof session.accessToken === 'string' ? session : null;
    } catch (_) {
      return null;
    }
  }

  function receivePortalSession() {
    const url = new URL(location.href);
    const deviceId = url.searchParams.get('ktmDeviceId');
    const accessToken = url.searchParams.get('ktmAccessToken');
    if (!deviceId || !accessToken) return;

    localStorage.setItem(DEVICE_ID_KEY, deviceId);
    localStorage.setItem(SESSION_KEY, JSON.stringify({ accessToken }));
    url.searchParams.delete('ktmDeviceId');
    url.searchParams.delete('ktmAccessToken');
    history.replaceState(null, '', url.toString());
  }

  async function callAuthService(action, payload) {
    const response = await fetch(AUTH_SERVICE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, payload }),
      redirect: 'follow',
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.message || '認証処理に失敗しました。');
    return data;
  }

  function returnToPortal() {
    location.replace(`${PORTAL_URL}?returnTo=${encodeURIComponent(location.href)}`);
  }

  function allowAccess() {
    document.documentElement.classList.remove('ktm-auth-checking');
    document.dispatchEvent(new Event('ktm-auth-ready'));
  }

  function validateAccess(session) {
    const deviceId = getDeviceId();
    void callAuthService('validateDeviceSession', { deviceId, accessToken: session.accessToken })
      .then((result) => {
        if (!result.valid) throw new Error('未承認の端末です。');
        return callAuthService('writeUsageLog', { deviceId, accessToken: session.accessToken, appName: document.title || '名称未取得' });
      })
      .catch(() => {
        localStorage.removeItem(SESSION_KEY);
        returnToPortal();
      });
  }

  function checkAccess() {
    receivePortalSession();
    const session = getSession();
    if (!session) {
      returnToPortal();
      return;
    }

    // Let approved devices open without waiting for the network. The validation still
    // runs immediately in the background and sends revoked devices back to the portal.
    // The small timer lets lightweight entry pages register their redirect handler
    // before the ready event is emitted.
    setTimeout(allowAccess, 0);
    validateAccess(session);
  }

  void checkAccess();
}());
