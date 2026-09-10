import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { DEVICE_ID_KEY, getDeviceId, getStoredSession, SESSION_KEY, type DeviceSession } from '../lib/portalAccess';

const AUTH_SERVICE_URL = 'https://script.google.com/macros/s/AKfycbyBLa2UzLgaxu7wb6GKqIJ_uiEbet4fW1QjCGGh83_Yb1JdJrq0ygF2ai6O5oJencw-/exec';

const EMPLOYEES = [
  '都外川　洋介', '岡　喜久美', '白石　貴弘', '宮地　淳', '池田　淳', '井上　真澄',
  '竹山　亮子', '楠　悦子', '佐藤　和夫', '石田　由美子', '岩田　明日香', '谷川　義和',
  '藤嶋　孝信', '深井　貴将', '藤井　由美', '浦越　拓哉', '永野　暢俊', '松尾　修',
  '和田　真由美', '山川　篤徳', '三橋　彩佳', '名守　佑香',
];

type PendingRequest = {
  requestId: string;
  employeeName: string;
};

type AuthResponse = {
  ok: boolean;
  message?: string;
  requestId?: string;
  accessToken?: string;
  employeeName?: string;
  valid?: boolean;
};

const APP_ORIGINS = new Set([
  'https://easy-genogram-app.vercel.app',
  'https://easy-floor-plan.vercel.app',
  'https://assessment-sheet-app.vercel.app',
  'https://pdf-converter-app-six.vercel.app',
  'https://riyosha-check-app.vercel.app',
  'https://fax-address-book.vercel.app',
  'https://template-memo.vercel.app',
  'https://shortcut-list.vercel.app',
  'https://service-slip-sorter.vercel.app',
]);

function getReturnUrl() {
  const value = new URLSearchParams(window.location.search).get('returnTo');
  if (!value) return null;
  try {
    const url = new URL(value);
    return APP_ORIGINS.has(url.origin) ? url : null;
  } catch {
    return null;
  }
}

function sendToRequestedApp(session: DeviceSession) {
  const returnUrl = getReturnUrl();
  if (!returnUrl) return false;
  returnUrl.searchParams.set('ktmDeviceId', getDeviceId());
  returnUrl.searchParams.set('ktmAccessToken', session.accessToken);
  window.location.replace(returnUrl.toString());
  return true;
}

async function callAuthService(action: string, payload: Record<string, string>): Promise<AuthResponse> {
  const response = await fetch(AUTH_SERVICE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, payload }),
    redirect: 'follow',
  });
  const data = await response.json() as AuthResponse;
  if (!data.ok) throw new Error(data.message || '認証処理に失敗しました。');
  return data;
}

export function LoginGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<DeviceSession | null>(() => getStoredSession());
  const [checkingSession, setCheckingSession] = useState(() => Boolean(getStoredSession()));
  const [employeeName, setEmployeeName] = useState(() => getStoredSession()?.employeeName || '');
  const [employeePin, setEmployeePin] = useState('');
  const [oneTimePassword, setOneTimePassword] = useState('');
  const [pendingRequest, setPendingRequest] = useState<PendingRequest | null>(null);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const stored = getStoredSession();
    if (!stored) return;

    void callAuthService('validateDeviceSession', {
      deviceId: getDeviceId(),
      accessToken: stored.accessToken,
    }).then((result) => {
      if (!result.valid) {
        localStorage.removeItem(SESSION_KEY);
        setSession(null);
      }
    }).catch(() => {
      localStorage.removeItem(SESSION_KEY);
      setSession(null);
    }).finally(() => setCheckingSession(false));
  }, []);

  useEffect(() => {
    if (session && !checkingSession) sendToRequestedApp(session);
  }, [checkingSession, session]);

  async function requestApproval() {
    if (!employeeName || !/^\d{3}$/.test(employeePin)) {
      setMessage('社員名と3桁の社員PINを入力してください。');
      setIsError(true);
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await callAuthService('requestDeviceApproval', {
        employeeName,
        employeePin,
        deviceId: getDeviceId(),
        deviceName: `${navigator.platform || '端末'} / ${navigator.language}`,
        browser: navigator.userAgent,
      });
      if (!result.requestId) throw new Error('認証申請を確認できませんでした。');
      setPendingRequest({ requestId: result.requestId, employeeName });
      setOneTimePassword('');
      setMessage('管理者へ認証コードを送信しました。届いた6桁のコードを入力してください。');
      setIsError(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '端末認証の申請に失敗しました。');
      setIsError(true);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function verifyApproval(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingRequest || !/^\d{6}$/.test(oneTimePassword)) {
      setMessage('管理者から届いた6桁の認証コードを入力してください。');
      setIsError(true);
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await callAuthService('verifyOneTimePassword', {
        requestId: pendingRequest.requestId,
        code: oneTimePassword,
        deviceId: getDeviceId(),
      });
      if (!result.accessToken || !result.employeeName) throw new Error('端末認証を確認できませんでした。');
      const approvedSession = { accessToken: result.accessToken, employeeName: result.employeeName };
      localStorage.setItem(SESSION_KEY, JSON.stringify(approvedSession));
      setSession(approvedSession);
      setIsError(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '端末認証に失敗しました。');
      setIsError(true);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (session && !checkingSession) return <>{children}</>;

  return (
    <main className="login-shell">
      <section className="login-content" aria-labelledby="login-title">
        <img className="login-riho-logo" src={`${import.meta.env.BASE_URL}riho-title.png`} alt="リーホ 介護業務効率化ポータルアプリ" />
        <form className="login-form" onSubmit={verifyApproval}>
          <h1 id="login-title">アプリ一覧へログイン</h1>
          <p>社員名と社員PINを入力し、端末認証を行ってください。</p>

          <label htmlFor="employee-name">社員名</label>
          <select id="employee-name" value={employeeName} onChange={(event) => setEmployeeName(event.target.value)} required>
            <option value="">社員名を選択</option>
            {EMPLOYEES.map((employee) => <option key={employee} value={employee}>{employee}</option>)}
          </select>

          <label htmlFor="employee-pin">社員PIN</label>
          <input id="employee-pin" value={employeePin} onChange={(event) => setEmployeePin(event.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" autoComplete="off" type="password" placeholder="3桁のPINを入力" required />

          <button className="login-request" type="button" onClick={requestApproval} disabled={isSubmitting}>
            {isSubmitting ? '送信中...' : '端末認証を申請'}
          </button>

          <label htmlFor="one-time-password">認証ワンタイムパスワード</label>
          <input id="one-time-password" value={oneTimePassword} onChange={(event) => setOneTimePassword(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="6桁の認証コード" disabled={!pendingRequest} required />

          <button className="login-verify" type="submit" disabled={!pendingRequest || isSubmitting}>
            認証してアプリ一覧へ
          </button>
          {message && <p className={`login-status${isError ? ' is-error' : ''}`} aria-live="polite">{message}</p>}
        </form>
      </section>
      <img className="login-ktm-logo" src={`${import.meta.env.BASE_URL}ktm-logo.png`} alt="KTM Keep Trust Meaning" />
    </main>
  );
}
