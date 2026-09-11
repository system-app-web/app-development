export const DEVICE_ID_KEY = 'ktm-portal:device-id';
export const SESSION_KEY = 'ktm-portal:device-session';
const SESSION_COOKIE = 'ktm_portal_session';
const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400;

export type DeviceSession = {
  accessToken: string;
  employeeName: string;
};

export function getDeviceId() {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(DEVICE_ID_KEY, created);
  return created;
}

export function getStoredSession(): DeviceSession | null {
  const localSession = readStoredSession();
  if (localSession) {
    writeSessionCookie(localSession);
    return localSession;
  }

  const cookieSession = readSessionCookie();
  if (cookieSession) localStorage.setItem(SESSION_KEY, JSON.stringify(cookieSession));
  return cookieSession;
}

export function saveStoredSession(session: DeviceSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  writeSessionCookie(session);
}

export function clearStoredSession() {
  localStorage.removeItem(SESSION_KEY);
  document.cookie = `${SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure`;
}

function readStoredSession(): DeviceSession | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    return parsed && typeof parsed.accessToken === 'string' && typeof parsed.employeeName === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function readSessionCookie(): DeviceSession | null {
  try {
    const value = document.cookie.split('; ').find((item) => item.startsWith(`${SESSION_COOKIE}=`))?.split('=').slice(1).join('=');
    if (!value) return null;
    const parsed = JSON.parse(decodeURIComponent(value));
    return parsed && typeof parsed.accessToken === 'string' && typeof parsed.employeeName === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function writeSessionCookie(session: DeviceSession) {
  const value = encodeURIComponent(JSON.stringify(session));
  document.cookie = `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax; Secure`;
}

export function createAppAccessUrl(appUrl: string) {
  const session = getStoredSession();
  if (!session) return appUrl;
  const url = new URL(appUrl);
  url.searchParams.set('ktmDeviceId', getDeviceId());
  url.searchParams.set('ktmAccessToken', session.accessToken);
  return url.toString();
}
