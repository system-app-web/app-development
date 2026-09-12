import { createContext, useContext } from 'react';

export const PortalLogoutContext = createContext<(() => void) | null>(null);

export function usePortalLogout() {
  const logout = useContext(PortalLogoutContext);
  if (!logout) throw new Error('ログアウト機能はログイン後にのみ利用できます。');
  return logout;
}
