export const DEVICE_ID_KEY = 'ktm-portal:device-id';
export const SESSION_KEY = 'ktm-portal:device-session';

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
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    return parsed && typeof parsed.accessToken === 'string' && typeof parsed.employeeName === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export function createAppAccessUrl(appUrl: string) {
  const session = getStoredSession();
  if (!session) return appUrl;
  const url = new URL(appUrl);
  url.searchParams.set('ktmDeviceId', getDeviceId());
  url.searchParams.set('ktmAccessToken', session.accessToken);
  return url.toString();
}
